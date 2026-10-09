import { exportCsv } from "../export/csv-exporter.mjs";
import { createExportDataset, createExportFilename, ExportError } from "../export/export-dataset.mjs";
import { exportJson } from "../export/json-exporter.mjs";
import { exportInsertSql } from "../export/sql-exporter.mjs";
import { makeDiagnostic } from "../diagnostics.mjs";
import { createI18n, DEFAULT_UI_LOCALE } from "../i18n/index.mjs";
import { toColumnViewModel } from "./workbench-view-model.mjs";
import { getSampleProbeCandidates } from "../host/dbx-data-sample-probe.mjs";
import { sanitizeSampleEvidence } from "../semantic/sample-evidence.mjs";
import { DEFAULT_GENERATION_ROW_COUNT, MAX_GENERATION_ROW_COUNT, MIN_GENERATION_ROW_COUNT } from "../generation/row-count.mjs";

export const DBX_WORKBENCH_DEFAULTS = Object.freeze({ rowCount: DEFAULT_GENERATION_ROW_COUNT, seed: "demo", locale: "zh-CN" });
export const DBX_WORKBENCH_MAX_ROWS = MAX_GENERATION_ROW_COUNT;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_TEMPORAL_METADATA_CACHE_ENTRIES = 32;

/**
 * Production DBX Workbench state. The injected provider consumes the direct
 * TableContext contract; the preview executor runs existing Core planning and
 * generation locally in the Workbench. This controller has no fixture,
 * sidecar, or standalone-server dependency.
 */
export class DbxGenerationWorkbenchController {
  /**
   * @param {{ provider: { getTableMetadata: (request: { tableContext: object }) => Promise<object> }, preview: (schema: object, options: object) => { plan: object, generated: object } | Promise<{ plan: object, generated: object }>, sampleProbe?: (request: { context: object, schema: object, candidates: Array<{ name: string, kind: string, privacy?: "standard" | "restricted", sampling: "direct" | "truncate" }> }) => Promise<unknown>, temporalMetadataResolver?: (request: { context: object, schema: object }) => Promise<unknown>, seedFactory?: () => string, translator?: import("../i18n/index.mjs").Translator }} options
   */
  constructor(options) {
    if (typeof options?.provider?.getTableMetadata !== "function") {
      throw new TypeError("A production SchemaMetadataProvider is required");
    }
    if (typeof options.preview !== "function") throw new TypeError("A Generation Core preview runtime is required");
    this.provider = options.provider;
    this.preview = options.preview;
    this.sampleProbe = typeof options.sampleProbe === "function" ? options.sampleProbe : null;
    this.temporalMetadataResolver = typeof options.temporalMetadataResolver === "function" ? options.temporalMetadataResolver : null;
    this.temporalMetadataCache = new Map();
    this.temporalPrecisionMetadata = {};
    this.sampleEvidenceCache = new Map();
    this.sampleEvidence = [];
    this.sampleUsed = false;
    this.sampleStatus = { state: "not_attempted", fields: [] };
    this.sampleEvidenceLoaded = false;
    this.generationPromise = null;
    this.seedFactory = options.seedFactory ?? defaultSeed;
    // UI language is presentation-only state: it never influences planning,
    // generation, diagnostics or blocking decisions.
    this.translator = typeof options.translator === "function" ? options.translator : createI18n(DEFAULT_UI_LOCALE);
    this.controls = { ...DBX_WORKBENCH_DEFAULTS };
    this.context = null;
    this.contextKey = null;
    this.invalidContext = false;
    this.contextRevision = 0;
    this.operationRevision = 0;
    this.listeners = new Set();
    this.status = "loading";
    this.stage = "context";
    this.schema = null;
    this.plan = null;
    this.currentDataset = null;
    this.rules = {};
    this.constraints = [];
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

  /**
   * Change the presentation language of derived view-model labels. Machine
   * state (plan, dataset, diagnostics, blocking) is not touched, so switching
   * the UI language cannot change what can be generated or exported.
   * @param {import("../i18n/index.mjs").Translator} translator
   */
  setTranslator(translator) {
    if (typeof translator !== "function") return this.translator;
    if (translator.locale === this.translator.locale) return this.translator;
    this.translator = translator;
    this.emit();
    return this.translator;
  }

  /** @param {unknown} tableContext @param {{ force?: boolean }} [options] */
  async setContext(tableContext, options = {}) {
    const normalized = normalizeTableContext(tableContext);
    const absentContext = isAbsentTableContext(tableContext);
    const key = normalized.ok ? JSON.stringify(normalized.context) : absentContext ? "empty" : `invalid:${normalized.reason}`;
    if (!options.force && key === this.contextKey) return this.initialization ?? this.getViewModel();

    this.contextRevision += 1;
    this.operationRevision += 1;
    this.generationPromise = null;
    const revision = this.contextRevision;
    this.contextKey = key;
    this.context = normalized.ok ? normalized.context : null;
    this.invalidContext = !normalized.ok && !absentContext;
    this.schema = null;
    this.temporalPrecisionMetadata = {};
    this.sampleEvidence = [];
    this.sampleUsed = false;
    this.sampleStatus = { state: normalized.ok ? "pending" : "not_attempted", fields: [] };
    this.sampleEvidenceLoaded = false;
    this.plan = null;
    this.currentDataset = null;
    this.rules = {};
    this.constraints = [];
    this.diagnostics = [];
    this.error = null;
    this.actionError = null;
    this.stage = normalized.ok ? "metadata" : "context";
    this.status = normalized.ok ? "loading" : absentContext ? "empty" : "blocked";

    if (!normalized.ok) {
      if (absentContext) {
        this.emit();
        this.initialization = Promise.resolve(this.getViewModel());
        return this.initialization;
      }
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
    if (this.status === "loading" && this.stage === "generation" && this.generationPromise) {
      if (action?.type === "generate") return this.generationPromise;
      return this.getViewModel();
    }
    this.actionError = null;
    try {
      switch (action?.type) {
        case "generate":
          await this.generateCurrent();
          break;
        case "generate-new-data":
          await this.generateNewData();
          break;
        case "update-controls":
          if (this.updateControls(action.controls)) {
            await this.validateCurrent({ stage: "controls-validation" });
          }
          break;
        case "update-rule":
          await this.updateRule(action.column, action.rule);
          break;
        case "add-constraint":
          await this.addConstraint(action.kind ?? "unique");
          break;
        case "update-constraint":
          await this.updateConstraint(action.constraint);
          break;
        case "delete-constraint":
          await this.deleteConstraint(action.id);
          break;
        case "retry":
          // Invalid inputs are deliberately not retained; the Host's onContext
          // notification is the authoritative path for a corrected context.
          // Retrying without a new Host value must preserve the real diagnosis.
          if (!this.invalidContext) await this.setContext(this.context, { force: true });
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
    return this.validateCurrent({ stage: "rule-validation" });
  }

  /** Add an editor draft; strict validation remains in the Core. @param {string} kind */
  async addConstraint(kind = "unique") {
    if (!this.context || !this.schema) throw new Error("Load a DBX table before editing constraints");
    let suffix = 1;
    while (this.constraints.some((constraint) => constraint.id === `manual-${suffix}`)) suffix += 1;
    const id = `manual-${suffix}`;
    const names = this.schema.columns.map((column) => column.name);
    const constraint = kind === "composite_unique"
      ? { id, kind, columns: names.slice(0, 2) }
      : { id, kind, column: names[0] ?? "" };
    return this.replaceConstraints([...this.constraints, constraint]);
  }

  /** @param {unknown} constraint */
  async updateConstraint(constraint) {
    if (!this.context || !this.schema) throw new Error("Load a DBX table before editing constraints");
    if (!isRecord(constraint) || typeof constraint.id !== "string") throw new TypeError("Constraint editor needs a constraint object with an id");
    const index = this.constraints.findIndex((entry) => entry.id === constraint.id);
    if (index < 0) throw new Error(`Unknown manual constraint ${constraint.id}`);
    const updated = [...this.constraints];
    updated[index] = structuredClone(constraint);
    return this.replaceConstraints(updated);
  }

  /** @param {string} id */
  async deleteConstraint(id) {
    if (typeof id !== "string") throw new TypeError("Constraint id must be text");
    if (!this.constraints.some((constraint) => constraint.id === id)) throw new Error(`Unknown manual constraint ${id}`);
    return this.replaceConstraints(this.constraints.filter((constraint) => constraint.id !== id));
  }

  async replaceConstraints(constraints) {
    this.constraints = structuredClone(constraints);
    return this.validateCurrent({ stage: "constraint-validation" });
  }

  /** @param {unknown} input */
  updateControls(input) {
    if (!isRecord(input)) throw new TypeError("Dataset controls must be an object");
    const rowCount = input.rowCount ?? this.controls.rowCount;
    const seed = input.seed ?? this.controls.seed;
    const locale = input.locale ?? this.controls.locale;
    if (!Number.isSafeInteger(rowCount)
      || rowCount < MIN_GENERATION_ROW_COUNT || rowCount > DBX_WORKBENCH_MAX_ROWS) {
      throw new RangeError(`Rows must be an integer from ${MIN_GENERATION_ROW_COUNT} to ${DBX_WORKBENCH_MAX_ROWS}`);
    }
    if (typeof seed !== "string") throw new TypeError("Seed must be text");
    if (locale !== "zh-CN" && locale !== "en") throw new RangeError("Locale must be zh-CN or en");
    const changed = rowCount !== this.controls.rowCount || seed !== this.controls.seed || locale !== this.controls.locale;
    this.controls = { rowCount, seed, locale };
    return changed;
  }

  async generateNewData() {
    if (!this.context || !this.schema || this.status === "loading") return this.getViewModel();
    const currentSeed = this.controls.seed;
    let seed = currentSeed;
    for (let attempt = 0; attempt < 3 && seed === currentSeed; attempt += 1) {
      seed = String(this.seedFactory());
    }
    if (seed === currentSeed) throw new Error("Seed generator did not produce a different seed");
    this.controls = { ...this.controls, seed };
    return this.generateCurrent();
  }

  /** @returns {ReturnType<DbxGenerationWorkbenchController["getViewModel"]>} */
  getViewModel() {
    const plan = this.plan;
    return {
      status: this.status,
      stage: this.stage,
      context: this.context ? { ...this.context } : null,
      canGenerate: Boolean(this.context && this.schema),
      table: this.context ? {
        database: this.context.database ?? null,
        schema: this.context.schema ?? null,
        table: this.context.table,
      } : null,
      controls: { ...this.controls },
      constraints: structuredClone(this.constraints),
      constraintPlan: plan?.constraintPlan ? {
        status: plan.constraintPlan.status,
        blocking: plan.constraintPlan.blocking,
        constraints: plan.constraintPlan.constraints.map((constraint) => ({
          id: constraint.id,
          kind: constraint.kind,
          columns: [...constraint.columns],
          capacity: { ...constraint.capacity },
          satisfiable: constraint.satisfiable,
          blocking: constraint.blocking,
          diagnostics: constraint.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        })),
      } : null,
      columns: plan?.columns.map((column) => toColumnViewModel(column, this.diagnostics, { translator: this.translator })) ?? [],
      sampleUsed: this.sampleUsed,
      sampleStatus: structuredClone(this.sampleStatus),
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
        ? (["metadata", "planning"].includes(this.stage) ? "loading" : "generating")
        : this.status === "dirty" ? (this.stage === "rule-validation" ? "validating" : "dirty")
          : this.status === "blocked" ? "blocked" : this.status === "warning" ? "warning"
            : this.status === "error" ? "error" : "ready" },
      constraintEditor: { scope: "current-table-session", state: this.status === "loading"
        ? (["metadata", "planning"].includes(this.stage) ? "loading" : "generating")
        : this.status === "dirty" ? (this.stage === "constraint-validation" ? "validating" : "dirty")
          : this.status === "blocked" ? "blocked" : this.status === "warning" ? "warning"
            : this.status === "error" ? "error" : "ready" },
      safeSyntheticNoticeKey: "safety.notice",
      error: this.error,
      actionError: this.actionError,
    };
  }

  /**
   * Return a descriptor for the same frozen dataset currently shown in Preview.
   * SQL consumes the same snapshot as CSV / JSON; it never regenerates rows.
   * @param {"csv" | "json" | "sql"} format
   */
  prepareExport(format) {
    if (format !== "csv" && format !== "json" && format !== "sql") throw new TypeError("Export format must be csv, json or sql");
    if (this.plan?.status === "blocked" || this.status === "blocked") {
      throw new ExportError("export_blocked_plan", "Blocked plans cannot be exported");
    }
    if (!this.currentDataset || !["ready", "warning"].includes(this.status) || this.currentDataset.rows.length === 0) {
      throw new ExportError("export_no_dataset", "A successfully generated current preview is required for export");
    }

    const content = format === "csv"
      ? exportCsv(this.currentDataset, { header: true, mode: "spreadsheet_safe", bom: true })
      : format === "json"
        ? exportJson(this.currentDataset, { pretty: true })
        : exportInsertSql(this.currentDataset, { header: true });
    const mimeTypes = {
      csv: "text/csv;charset=utf-8",
      json: "application/json;charset=utf-8",
      sql: "application/sql;charset=utf-8",
    };
    return {
      filename: createExportFilename(this.currentDataset.tableIdentity, this.currentDataset.rows.length, format),
      mimeType: mimeTypes[format],
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
      this.stage = "metadata";
      this.emit();
      await this.loadTemporalPrecisionMetadata(revision, context, schema);
      if (revision !== this.contextRevision) return this.getViewModel();
      return await this.validateCurrent({ contextRevision: revision, stage: "planning", initial: true });
    } catch (error) {
      if (revision !== this.contextRevision) return this.getViewModel();
      this.fail(error, "metadata");
      return this.getViewModel();
    }
  }

  /** @param {number} revision @param {object} context @param {object} schema */
  async loadTemporalPrecisionMetadata(revision, context, schema) {
    const schemaKey = schema.columns.map((column) => [column.name, column.dataType, column.precision]);
    const key = JSON.stringify([context, schema.tableIdentity, schemaKey]);
    let metadataPromise = this.temporalMetadataCache.get(key);
    if (metadataPromise) {
      this.temporalMetadataCache.delete(key);
      this.temporalMetadataCache.set(key, metadataPromise);
    } else {
      metadataPromise = this.temporalMetadataResolver
        ? Promise.resolve().then(() => this.temporalMetadataResolver({ context: { ...context }, schema }))
          .then((result) => sanitizeTemporalPrecisionMetadata(result, schema))
          .catch(() => ({}))
        : Promise.resolve({});
      this.temporalMetadataCache.set(key, metadataPromise);
      if (this.temporalMetadataCache.size > MAX_TEMPORAL_METADATA_CACHE_ENTRIES) {
        this.temporalMetadataCache.delete(this.temporalMetadataCache.keys().next().value);
      }
    }
    const metadata = await metadataPromise;
    if (revision === this.contextRevision) this.temporalPrecisionMetadata = metadata;
    return metadata;
  }

  /** @param {number} revision @param {object} context @param {object} schema */
  async loadSampleEvidence(revision, context, schema) {
    const key = JSON.stringify(context);
    let evidencePromise = this.sampleEvidenceCache.get(key);
    if (!evidencePromise) {
      const candidates = getSampleProbeCandidates(schema);
      evidencePromise = candidates.length === 0 || !this.sampleProbe
        ? Promise.resolve({
          sampleUsed: false,
          evidence: [],
          sampleStatus: createFallbackSampleStatus(schema, candidates, "not_attempted"),
        })
        : Promise.resolve()
          .then(() => this.sampleProbe({ context: { ...context }, schema, candidates }))
          .then((result) => {
            const entries = Array.isArray(result) ? result
              : isRecord(result) && Array.isArray(result.evidence) ? result.evidence : [];
            const evidence = sanitizeSampleEvidence(entries, new Set(schema.columns.map((column) => column.name)));
            const sampleUsed = evidence.length > 0 || (isRecord(result) && result.sampleUsed === true);
            return {
              sampleUsed,
              evidence,
              sampleStatus: normalizeSampleStatus(result?.sampleStatus, schema, candidates, evidence, sampleUsed),
            };
          })
          .catch(() => ({
            sampleUsed: false,
            evidence: [],
            sampleStatus: createFallbackSampleStatus(schema, candidates, "failed"),
          }));
      this.sampleEvidenceCache.set(key, evidencePromise);
    }
    const sampleResult = await evidencePromise;
    if (revision === this.contextRevision) {
      this.sampleEvidence = sampleResult.evidence;
      this.sampleUsed = sampleResult.sampleUsed;
      this.sampleStatus = sampleResult.sampleStatus;
      this.sampleEvidenceLoaded = true;
    }
    return sampleResult.evidence;
  }

  generationOptions(validateOnly = false) {
    return {
      ...this.controls,
      mode: "safe_synthetic",
      rules: structuredClone(this.rules),
      constraints: structuredClone(this.constraints),
      sampleEvidence: structuredClone(this.sampleEvidence),
      temporalPrecisionMetadata: structuredClone(this.temporalPrecisionMetadata),
      ...(validateOnly ? { validateOnly: true } : {}),
      semanticOverrides: {},
      semanticMappings: {},
    };
  }

  /** @param {{ contextRevision?: number, stage?: string, initial?: boolean }} [options] */
  async validateCurrent({ contextRevision = this.contextRevision, stage = "planning", initial = false } = {}) {
    if (!this.context || !this.schema || contextRevision !== this.contextRevision) return this.getViewModel();

    const operation = ++this.operationRevision;
    this.plan = null;
    this.currentDataset = null;
    this.diagnostics = [];
    this.error = null;
    this.actionError = null;
    this.stage = stage;
    this.status = initial ? "loading" : "dirty";
    this.emit();

    try {
      const response = await this.preview(this.schema, this.generationOptions(true));
      if (contextRevision !== this.contextRevision || operation !== this.operationRevision) return this.getViewModel();
      if (!isRecord(response) || !isRecord(response.plan) || !isRecord(response.generated)) {
        throw new Error("Generation Core runtime returned an invalid plan validation response");
      }
      this.plan = response.plan;
      this.diagnostics = Array.isArray(response.plan.diagnostics)
        ? response.plan.diagnostics
        : Array.isArray(response.generated.diagnostics) ? response.generated.diagnostics : [];
      const blocked = response.plan.status === "blocked" || response.generated.status === "blocked";
      this.status = blocked ? "blocked" : initial ? "idle" : "dirty";
      this.stage = "ready";
      this.emit();
    } catch (error) {
      if (contextRevision !== this.contextRevision || operation !== this.operationRevision) return this.getViewModel();
      this.fail(error, "generation");
    }
    return this.getViewModel();
  }

  /** @param {number} [contextRevision] */
  async generateCurrent(contextRevision = this.contextRevision) {
    if (!this.context || !this.schema) {
      if (!(this.status === "empty" && !this.context)) this.status = "blocked";
      this.stage = "context";
      this.emit();
      return this.getViewModel();
    }
    if (contextRevision !== this.contextRevision) return this.getViewModel();
    if (this.status === "loading" && this.stage === "generation" && this.generationPromise) {
      return this.generationPromise;
    }

    const operation = ++this.operationRevision;
    const context = this.context;
    const schema = this.schema;
    this.currentDataset = null;
    this.error = null;
    this.stage = "generation";
    this.status = "loading";
    this.emit();

    const task = Promise.resolve().then(() => this.runGeneration(contextRevision, operation, context, schema));
    this.generationPromise = task;
    try {
      return await task;
    } finally {
      if (this.generationPromise === task) this.generationPromise = null;
    }
  }

  /** @param {number} contextRevision @param {number} operation @param {object} context @param {object} schema */
  async runGeneration(contextRevision, operation, context, schema) {
    try {
      if (!this.sampleEvidenceLoaded) {
        await this.loadSampleEvidence(contextRevision, context, schema);
      }
      if (contextRevision !== this.contextRevision || operation !== this.operationRevision) return this.getViewModel();

      const response = await this.preview(schema, this.generationOptions());
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
        this.currentDataset = createExportDataset(response.plan, response.generated, { table: context });
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
    if (stage === "metadata") this.plan = null;
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
function sanitizeTemporalPrecisionMetadata(value, schema) {
  if (!isRecord(value)) return {};
  const allowedColumns = new Set(schema.columns.map((column) => column.name));
  const accepted = [];
  for (const [name, entry] of Object.entries(value)) {
    if (!allowedColumns.has(name) || !isRecord(entry) || entry.state !== "known"
      || entry.source !== "system_metadata" || !Number.isSafeInteger(entry.value)
      || entry.value < 0 || entry.value > 6 || typeof entry.provenance !== "string"
      || !entry.provenance.startsWith("DBX Host Data API 1.4 MySQL ")
      || !entry.provenance.endsWith(".COLUMNS.DATETIME_PRECISION")) continue;
    accepted.push([name, {
      state: "known",
      value: entry.value,
      source: "system_metadata",
      provenance: entry.provenance,
    }]);
  }
  return Object.fromEntries(accepted);
}

const SAMPLE_STATUS_STATES = new Set([
  "pending", "not_attempted", "unavailable", "permission_denied", "failed", "sampled", "empty", "insufficient", "unknown",
]);
const SAMPLE_FIELD_STATES = new Set([
  "skipped", "not_attempted", "unavailable", "permission_denied", "failed", "no_data", "insufficient", "used", "unknown",
]);
const SAMPLE_STATUS_REASONS = new Set(["not_selected", "high_confidence_semantic", "unsafe_context"]);
const SAMPLE_SUMMARY_KINDS = new Set([
  "chinese_name_pattern", "chinese_name_pattern_rejected", "email_pattern", "email_pattern_rejected",
  "mobile_pattern", "mobile_pattern_rejected", "pattern", "enum_like", "numeric_range", "temporal_range",
  "temporal_shape", "filename_pattern",
]);

/** @param {object} schema @param {Array<{ name: string }>} candidates @param {string} state */
function createFallbackSampleStatus(schema, candidates, state) {
  const candidateNames = new Set(candidates.map((candidate) => candidate.name));
  const fields = schema.columns.map((column) => {
    if (!candidateNames.has(column.name)) return { column: column.name, state: "skipped", reason: "not_selected" };
    if (["unavailable", "permission_denied", "failed"].includes(state)) return { column: column.name, state };
    if (state === "not_attempted") return { column: column.name, state: "not_attempted" };
    return { column: column.name, state: "unknown" };
  });
  return { state, fields };
}

/** @param {unknown} input @param {object} schema @param {Array<{ name: string }>} candidates @param {Array<Record<string, unknown>>} evidence @param {boolean} sampleUsed */
function normalizeSampleStatus(input, schema, candidates, evidence, sampleUsed) {
  const candidateNames = new Set(candidates.map((candidate) => candidate.name));
  const evidenceByColumn = new Map(evidence.map((entry) => [entry.column, entry]));
  const report = isRecord(input) ? input : {};
  let state = SAMPLE_STATUS_STATES.has(report.state) ? report.state
    : sampleUsed ? "sampled" : candidates.length === 0 ? "not_attempted" : "unknown";
  if (sampleUsed && !["permission_denied", "failed", "unavailable"].includes(state)) state = "sampled";
  if (!sampleUsed && state === "sampled") state = "unknown";
  const reportedFields = new Map(Array.isArray(report.fields)
    ? report.fields.filter((field) => isRecord(field) && typeof field.column === "string").map((field) => [field.column, field])
    : []);

  const fields = schema.columns.map((column) => {
    const reported = reportedFields.get(column.name);
    if (!candidateNames.has(column.name)) {
      const reason = SAMPLE_STATUS_REASONS.has(reported?.reason) ? reported.reason : "not_selected";
      return { column: column.name, state: "skipped", reason };
    }
    const safeCounts = {};
    for (const key of ["sampleCount", "matchedCount", "distinctCount"]) {
      const value = reported?.[key];
      if (Number.isSafeInteger(value) && value >= 0 && value <= 100) safeCounts[key] = value;
    }
    const summaryKind = SAMPLE_SUMMARY_KINDS.has(reported?.summaryKind) ? reported.summaryKind : undefined;
    let fieldState = SAMPLE_FIELD_STATES.has(reported?.state) ? reported.state : undefined;
    if (fieldState === "used" && !summaryKind && !evidenceByColumn.has(column.name)) fieldState = "unknown";
    if (!fieldState && evidenceByColumn.has(column.name)) fieldState = "used";
    if (!fieldState && ["unavailable", "permission_denied", "failed"].includes(state)) fieldState = state;
    if (!fieldState && state === "not_attempted") fieldState = "not_attempted";
    if (!fieldState) fieldState = "unknown";
    return {
      column: column.name,
      state: fieldState,
      ...(SAMPLE_STATUS_REASONS.has(reported?.reason) ? { reason: reported.reason } : {}),
      ...(summaryKind ? { summaryKind } : {}),
      ...safeCounts,
    };
  });
  return { state, fields };
}

function isAbsentTableContext(value) {
  if (value === null || value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length > 0) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

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
