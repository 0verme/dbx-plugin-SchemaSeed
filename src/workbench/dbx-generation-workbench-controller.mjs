import { exportCsv } from "../export/csv-exporter.mjs";
import { createExportDataset, createExportFilename, ExportError } from "../export/export-dataset.mjs";
import { exportJson } from "../export/json-exporter.mjs";
import { makeDiagnostic } from "../diagnostics.mjs";
import { toColumnViewModel } from "./workbench-view-model.mjs";

export const DBX_WORKBENCH_DEFAULTS = Object.freeze({ rowCount: 20, seed: "demo", locale: "zh-CN" });
export const DBX_WORKBENCH_MAX_ROWS = 100;
const MAX_IDENTIFIER_LENGTH = 256;
const SAFE_SYNTHETIC_NOTICE = "Generated values are synthetic test data and are not sourced from real PII.";

/**
 * Production DBX Workbench state. The injected provider consumes the direct
 * TableContext contract; the injected preview runtime executes existing Core
 * planning/generation. This controller has no fixture or standalone-server
 * dependency.
 */
export class DbxGenerationWorkbenchController {
  /**
   * @param {{ provider: { getTableMetadata: (request: { tableContext: object }) => Promise<object> }, preview: (schema: object, options: object) => Promise<{ plan: object, generated: object }>, seedFactory?: () => string }} options
   */
  constructor(options) {
    if (typeof options?.provider?.getTableMetadata !== "function") {
      throw new TypeError("A production SchemaMetadataProvider is required");
    }
    if (typeof options.preview !== "function") throw new TypeError("A Generation Core preview runtime is required");
    this.provider = options.provider;
    this.preview = options.preview;
    this.seedFactory = options.seedFactory ?? defaultSeed;
    this.controls = { ...DBX_WORKBENCH_DEFAULTS };
    this.context = null;
    this.contextKey = null;
    this.contextRevision = 0;
    this.operationRevision = 0;
    this.listeners = new Set();
    this.status = "loading";
    this.stage = "context";
    this.schema = null;
    this.plan = null;
    this.currentDataset = null;
    this.rules = {};
    this.diagnostics = [];
    this.error = null;
    this.actionError = null;
    this.initialization = null;
  }

  /** @param {(viewModel: ReturnType<DbxGenerationWorkbenchController["getViewModel"]>) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @param {unknown} tableContext @param {{ force?: boolean }} [options] */
  async setContext(tableContext, options = {}) {
    const normalized = normalizeTableContext(tableContext);
    const key = normalized.ok ? JSON.stringify(normalized.context) : `invalid:${normalized.reason}`;
    if (!options.force && key === this.contextKey) return this.initialization ?? this.getViewModel();

    this.contextRevision += 1;
    this.operationRevision += 1;
    const revision = this.contextRevision;
    this.contextKey = key;
    this.context = normalized.ok ? normalized.context : null;
    this.schema = null;
    this.plan = null;
    this.currentDataset = null;
    this.rules = {};
    this.diagnostics = [];
    this.error = null;
    this.actionError = null;
    this.stage = normalized.ok ? "metadata" : "context";
    this.status = normalized.ok ? "loading" : "blocked";

    if (!normalized.ok) {
      this.diagnostics = [makeDiagnostic({
        severity: "error",
        code: "table_context_invalid",
        table: "<invalid-table-context>",
        rule: "table-context",
        reason: normalized.reason,
        blocking: true,
      })];
      this.emit();
      this.initialization = Promise.resolve(this.getViewModel());
      return this.initialization;
    }

    this.emit();
    this.initialization = this.loadContext(revision, normalized.context);
    return this.initialization;
  }

  /** @param {unknown} action */
  async dispatch(action) {
    this.actionError = null;
    try {
      switch (action?.type) {
        case "generate":
        case "regenerate-same-seed":
          await this.generateCurrent();
          break;
        case "update-controls":
          this.updateControls(action.controls);
          await this.generateCurrent();
          break;
        case "update-rule":
          await this.updateRule(action.column, action.rule);
          break;
        case "new-seed": {
          const seed = String(this.seedFactory());
          if (seed === this.controls.seed) throw new Error("New Seed must differ from the current seed");
          this.controls = { ...this.controls, seed };
          await this.generateCurrent();
          break;
        }
        case "retry":
          await this.setContext(this.context, { force: true });
          break;
        default:
          throw new Error(`Unsupported Workbench action: ${String(action?.type)}`);
      }
    } catch (error) {
      this.actionError = errorText(error);
      this.emit();
    }
    return this.getViewModel();
  }

  /** @param {string} columnName @param {unknown} rule */
  async updateRule(columnName, rule) {
    if (!this.context || !this.schema) throw new Error("Load a DBX table before editing generation rules");
    if (typeof columnName !== "string" || !this.schema.columns.some((column) => column.name === columnName)) {
      throw new Error("Generation rule column must exist in the current table schema");
    }
    if (!isRecord(rule)) throw new TypeError("Generation rule must be a tagged object");

    this.rules = { ...this.rules, [columnName]: structuredClone(rule) };
    const contextRevision = this.contextRevision;
    const operation = ++this.operationRevision;
    this.plan = null;
    this.currentDataset = null;
    this.diagnostics = [];
    this.error = null;
    this.actionError = null;
    this.stage = "rule-validation";
    this.status = "dirty";
    this.emit();

    try {
      const response = await this.preview(this.schema, {
        ...this.controls,
        mode: "safe_synthetic",
        rules: structuredClone(this.rules),
        validateOnly: true,
        semanticOverrides: {},
        semanticMappings: {},
      });
      if (contextRevision !== this.contextRevision || operation !== this.operationRevision) return this.getViewModel();
      if (!isRecord(response) || !isRecord(response.plan) || !isRecord(response.generated)) {
        throw new Error("Generation Core runtime returned an invalid rule validation response");
      }
      this.plan = response.plan;
      this.diagnostics = Array.isArray(response.plan.diagnostics)
        ? response.plan.diagnostics
        : Array.isArray(response.generated.diagnostics) ? response.generated.diagnostics : [];
      this.status = response.plan.status === "blocked" || response.generated.status === "blocked" ? "blocked" : "dirty";
      this.stage = "ready";
      this.currentDataset = null;
      this.emit();
    } catch (error) {
      if (contextRevision !== this.contextRevision || operation !== this.operationRevision) return this.getViewModel();
      this.fail(error, "generation");
    }
    return this.getViewModel();
  }

  /** @param {unknown} input */
  updateControls(input) {
    if (!isRecord(input)) throw new TypeError("Dataset controls must be an object");
    const rowCount = input.rowCount ?? this.controls.rowCount;
    const seed = input.seed ?? this.controls.seed;
    const locale = input.locale ?? this.controls.locale;
    if (!Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > DBX_WORKBENCH_MAX_ROWS) {
      throw new RangeError(`Rows must be an integer from 1 to ${DBX_WORKBENCH_MAX_ROWS}`);
    }
    if (typeof seed !== "string") throw new TypeError("Seed must be text");
    if (locale !== "zh-CN" && locale !== "en") throw new RangeError("Locale must be zh-CN or en");
    this.controls = { rowCount, seed, locale };
  }

  /** @returns {ReturnType<DbxGenerationWorkbenchController["getViewModel"]>} */
  getViewModel() {
    const plan = this.plan;
    return {
      status: this.status,
      stage: this.stage,
      context: this.context ? { ...this.context } : null,
      table: this.context ? {
        database: this.context.database ?? null,
        schema: this.context.schema ?? null,
        table: this.context.table,
      } : null,
      controls: { ...this.controls },
      columns: plan?.columns.map((column) => toColumnViewModel(column, this.diagnostics)) ?? [],
      diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      preview: {
        columns: plan?.table.columns.map((column) => column.name) ?? [],
        rows: this.currentDataset?.rows.map((row) => ({ ...row })) ?? [],
      },
      export: {
        enabled: Boolean(this.currentDataset && ["ready", "warning"].includes(this.status)),
        rowCount: this.currentDataset?.rows.length ?? 0,
      },
      plan: plan ? {
        status: plan.status,
        seed: plan.seed,
        rowCount: plan.rowCount,
        locale: plan.locale,
        mode: plan.mode,
        determinismProfile: plan.determinismProfile,
      } : null,
      ruleEditor: { issue: 32, scope: "current-table-session", state: this.status === "loading"
        ? (this.stage === "metadata" ? "loading" : "generating")
        : this.status === "dirty" ? (this.stage === "rule-validation" ? "validating" : "dirty")
          : this.status === "blocked" ? "blocked" : this.status === "warning" ? "warning"
            : this.status === "error" ? "error" : "ready" },
      safeSyntheticNotice: SAFE_SYNTHETIC_NOTICE,
      error: this.error,
      actionError: this.actionError,
    };
  }

  /** Return a descriptor for the same frozen dataset currently shown in Preview. @param {"csv" | "json"} format */
  prepareExport(format) {
    if (format !== "csv" && format !== "json") throw new TypeError("Export format must be csv or json");
    if (this.plan?.status === "blocked" || this.status === "blocked") {
      throw new ExportError("export_blocked_plan", "Blocked plans cannot be exported");
    }
    if (!this.currentDataset || !["ready", "warning"].includes(this.status) || this.currentDataset.rows.length === 0) {
      throw new ExportError("export_no_dataset", "A successfully generated current preview is required for export");
    }

    const content = format === "csv"
      ? exportCsv(this.currentDataset, { header: true, mode: "spreadsheet_safe", bom: true })
      : exportJson(this.currentDataset, { pretty: true });
    return {
      filename: createExportFilename(this.currentDataset.tableIdentity, this.currentDataset.rows.length, format),
      mimeType: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      content,
      summary: {
        rowCount: this.currentDataset.rows.length,
        format: format.toUpperCase(),
        encoding: "UTF-8",
        spreadsheetSafe: format === "csv",
      },
    };
  }

  /** @param {number} revision @param {{ connectionId: string, database?: string, schema?: string, table: string }} context */
  async loadContext(revision, context) {
    try {
      const schema = await this.provider.getTableMetadata({ tableContext: context });
      if (revision !== this.contextRevision) return this.getViewModel();
      this.schema = schema;
      this.stage = "generation";
      this.emit();
      return await this.generateCurrent(revision);
    } catch (error) {
      if (revision !== this.contextRevision) return this.getViewModel();
      this.fail(error, "metadata");
      return this.getViewModel();
    }
  }

  /** @param {number} [contextRevision] */
  async generateCurrent(contextRevision = this.contextRevision) {
    if (!this.context || !this.schema) {
      this.status = "blocked";
      this.stage = "context";
      this.emit();
      return this.getViewModel();
    }

    const operation = ++this.operationRevision;
    this.plan = null;
    this.currentDataset = null;
    this.diagnostics = [];
    this.error = null;
    this.stage = "generation";
    this.status = "loading";
    this.emit();

    try {
      const response = await this.preview(this.schema, {
        ...this.controls,
        mode: "safe_synthetic",
        rules: structuredClone(this.rules),
        semanticOverrides: {},
        semanticMappings: {},
      });
      if (contextRevision !== this.contextRevision || operation !== this.operationRevision) return this.getViewModel();
      if (!isRecord(response) || !isRecord(response.plan) || !isRecord(response.generated)) {
        throw new Error("Generation Core runtime returned an invalid preview response");
      }
      this.plan = response.plan;
      this.diagnostics = Array.isArray(response.generated.diagnostics)
        ? response.generated.diagnostics
        : Array.isArray(response.plan.diagnostics) ? response.plan.diagnostics : [];
      if (response.plan.status === "blocked" || response.generated.status === "blocked") {
        this.status = "blocked";
        this.currentDataset = null;
      } else {
        this.status = response.generated.status === "ready_with_warnings" || response.plan.status === "ready_with_warnings"
          ? "warning" : "ready";
        this.currentDataset = createExportDataset(response.plan, response.generated);
      }
      this.stage = "ready";
      this.emit();
    } catch (error) {
      if (contextRevision !== this.contextRevision || operation !== this.operationRevision) return this.getViewModel();
      this.fail(error, "generation");
    }
    return this.getViewModel();
  }

  /** @param {unknown} error @param {"metadata" | "generation"} stage */
  fail(error, stage) {
    this.plan = null;
    this.currentDataset = null;
    this.schema = stage === "metadata" ? null : this.schema;
    this.stage = stage;
    const providerDiagnostic = error && typeof error === "object" ? error.diagnostic : null;
    if (providerDiagnostic && typeof providerDiagnostic.code === "string") {
      this.diagnostics = [providerDiagnostic];
      this.status = providerDiagnostic.code === "metadata_capability_unavailable"
        || providerDiagnostic.code === "table_context_invalid" ? "blocked" : "error";
      this.error = providerDiagnostic.reason;
    } else {
      const reason = errorText(error);
      this.diagnostics = [makeDiagnostic({
        severity: "error",
        code: stage === "metadata" ? "metadata_request_failed" : "generation_runtime_failed",
        table: this.context?.table ?? "<unknown-table>",
        rule: stage === "metadata" ? "dbx-host-metadata" : "generation-runtime",
        reason,
        blocking: true,
      })];
      this.status = "error";
      this.error = reason;
    }
    this.emit();
  }

  emit() {
    const viewModel = this.getViewModel();
    for (const listener of this.listeners) listener(viewModel);
  }
}

/** @param {unknown} input */
function normalizeTableContext(input) {
  if (!isRecord(input)) return { ok: false, reason: "Workbench requires a direct DBX TableContext object." };
  const connectionId = requiredIdentifier(input.connectionId, "connectionId");
  if (!connectionId.ok) return connectionId;
  const table = requiredIdentifier(input.table, "table");
  if (!table.ok) return table;
  const context = { connectionId: connectionId.value };
  for (const key of ["database", "schema"]) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return { ok: false, reason: `TableContext ${key} must be text when provided.` };
    const normalized = value.trim();
    if (!normalized) continue;
    if (Array.from(normalized).length > MAX_IDENTIFIER_LENGTH) {
      return { ok: false, reason: `TableContext ${key} exceeds ${MAX_IDENTIFIER_LENGTH} characters.` };
    }
    context[key] = normalized;
  }
  context.table = table.value;
  return { ok: true, context: Object.freeze(context) };
}

/** @param {unknown} value @param {string} key */
function requiredIdentifier(value, key) {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, reason: `TableContext ${key} is required and must be non-empty text.` };
  }
  const normalized = value.trim();
  if (Array.from(normalized).length > MAX_IDENTIFIER_LENGTH) {
    return { ok: false, reason: `TableContext ${key} exceeds ${MAX_IDENTIFIER_LENGTH} characters.` };
  }
  return { ok: true, value: normalized };
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} error */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function defaultSeed() {
  return globalThis.crypto?.randomUUID?.() ?? `seed-${Date.now()}-${Math.floor(Math.random() * 0x1_0000_0000).toString(16)}`;
}
