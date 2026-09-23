import { randomUUID } from "node:crypto";
import { exportCsv } from "../export/csv-exporter.mjs";
import { createExportDataset, createExportFilename, ExportError } from "../export/export-dataset.mjs";
import { exportJson } from "../export/json-exporter.mjs";
import { generateRows } from "../generation/generation-engine.mjs";
import { buildGenerationPlan } from "../generation/generation-plan.mjs";
import { FixtureSchemaMetadataProvider } from "../providers/fixture-schema-metadata-provider.mjs";

export const WORKBENCH_DEFAULT_ROW_COUNT = 20;
export const WORKBENCH_MIN_ROW_COUNT = 1;
export const WORKBENCH_MAX_ROW_COUNT = 100;
export const WORKBENCH_LOCALES = Object.freeze(["zh-CN", "en"]);

const SEMANTIC_TYPES = Object.freeze(["name", "gender", "birthday", "mobile", "email", "address"]);
const SAFE_SYNTHETIC_NOTICE = "Generated values are test data patterns and are not sourced from real PII.";

/**
 * Owns fixture selection, dataset controls, mapping actions, Core plan creation,
 * diagnostics and preview state. UI code consumes only getViewModel() and
 * dispatch(); all generation remains in the existing Core.
 */
export class WorkbenchController {
  /**
   * @param {{ provider?: FixtureSchemaMetadataProvider, seedFactory?: () => string }} [options]
   */
  constructor(options = {}) {
    this.provider = options.provider ?? new FixtureSchemaMetadataProvider();
    this.seedFactory = options.seedFactory ?? randomUUID;
    this.status = "loading";
    this.fixtureNames = [];
    this.selectedFixture = null;
    this.controls = { rowCount: WORKBENCH_DEFAULT_ROW_COUNT, seed: "demo", locale: "zh-CN" };
    this.semanticOverrides = {};
    this.semanticMappings = {};
    this.schema = null;
    this.plan = null;
    this.currentDataset = null;
    this.diagnostics = [];
    this.error = null;
    this.actionError = null;
    this.initialization = null;
  }

  /** @returns {Promise<ReturnType<WorkbenchController["getViewModel"]>>} */
  initialize() {
    if (!this.initialization) this.initialization = this.loadFixtures();
    return this.initialization;
  }

  /** @param {Record<string, unknown>} action */
  async dispatch(action) {
    await this.initialize();
    this.actionError = null;
    try {
      switch (action?.type) {
        case "retry":
          this.initialization = null;
          this.initialization = this.loadFixtures(true);
          await this.initialization;
          break;
        case "select-fixture":
          this.selectFixture(action.fixture);
          await this.refreshPreview();
          break;
        case "update-controls":
          this.updateControls(action.controls);
          await this.refreshPreview();
          break;
        case "confirm-detected":
          this.confirmDetected(action.column);
          await this.refreshPreview();
          break;
        case "set-mapping":
          this.setMapping(action.column, action.semanticType);
          await this.refreshPreview();
          break;
        case "regenerate":
          await this.refreshPreview();
          break;
        case "new-seed": {
          const nextSeed = String(this.seedFactory());
          if (nextSeed === this.controls.seed) throw new Error("New Seed must differ from the current seed");
          this.controls = { ...this.controls, seed: nextSeed };
          await this.refreshPreview();
          break;
        }
        default:
          throw new Error(`Unsupported Workbench action: ${String(action?.type)}`);
      }
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : String(error);
    }
    return this.getViewModel();
  }

  /** @param {boolean} [preserveSelection] @returns {Promise<ReturnType<WorkbenchController["getViewModel"]>>} */
  async loadFixtures(preserveSelection = false) {
    this.status = "loading";
    this.error = null;
    try {
      this.fixtureNames = await this.provider.listTableIdentities();
      if (this.fixtureNames.length === 0) {
        this.selectedFixture = null;
        this.status = "empty";
        return this.getViewModel();
      }
      if (!preserveSelection || !this.fixtureNames.includes(this.selectedFixture)) {
        this.selectedFixture = this.fixtureNames.includes("simple_customer")
          ? "simple_customer"
          : this.fixtureNames[0];
        this.semanticOverrides = {};
        this.semanticMappings = {};
      }
      await this.refreshPreview();
      return this.getViewModel();
    } catch (error) {
      this.failPreview(error);
      return this.getViewModel();
    }
  }

  /** @param {string} fixture */
  selectFixture(fixture) {
    if (typeof fixture !== "string" || !this.fixtureNames.includes(fixture)) {
      throw new Error("Select a fixture available from FixtureSchemaMetadataProvider");
    }
    this.selectedFixture = fixture;
    this.semanticOverrides = {};
    this.semanticMappings = {};
  }

  /** @param {unknown} input */
  updateControls(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Dataset controls must be an object");
    }
    const rowCount = input.rowCount ?? this.controls.rowCount;
    const seed = input.seed ?? this.controls.seed;
    const locale = input.locale ?? this.controls.locale;
    if (!Number.isSafeInteger(rowCount) || rowCount < WORKBENCH_MIN_ROW_COUNT || rowCount > WORKBENCH_MAX_ROW_COUNT) {
      throw new RangeError(`Rows must be an integer from ${WORKBENCH_MIN_ROW_COUNT} to ${WORKBENCH_MAX_ROW_COUNT}`);
    }
    if (typeof seed !== "string") throw new TypeError("Seed must be text");
    if (!WORKBENCH_LOCALES.includes(locale)) throw new RangeError(`Locale must be one of: ${WORKBENCH_LOCALES.join(", ")}`);
    this.controls = { rowCount, seed, locale };
  }

  /** @param {string} columnName */
  confirmDetected(columnName) {
    const column = this.findPlanColumn(columnName);
    if (column.inference.status !== "candidate" || !SEMANTIC_TYPES.includes(column.inference.semanticType)) {
      throw new Error("This column has no confirmable detected semantic candidate");
    }
    this.semanticMappings[columnName] = column.inference.semanticType;
    delete this.semanticOverrides[columnName];
  }

  /** @param {string} columnName @param {string} semanticType */
  setMapping(columnName, semanticType) {
    this.findPlanColumn(columnName);
    if (semanticType === "auto") {
      delete this.semanticOverrides[columnName];
      delete this.semanticMappings[columnName];
      return;
    }
    if (!SEMANTIC_TYPES.includes(semanticType)) {
      throw new Error(`Choose Auto / Fallback or one of: ${SEMANTIC_TYPES.join(", ")}`);
    }
    this.semanticOverrides[columnName] = semanticType;
    delete this.semanticMappings[columnName];
  }

  /** @returns {Record<string, unknown>} */
  getViewModel() {
    const plan = this.plan;
    const planColumns = plan?.columns ?? [];
    return {
      status: this.status,
      fixtures: [...this.fixtureNames],
      selectedFixture: this.selectedFixture,
      controls: { ...this.controls },
      tableContext: plan ? {
        tableIdentity: plan.table.tableIdentity,
        columns: plan.table.columns.map((column) => column.name),
      } : null,
      columns: planColumns.map((column) => toColumnViewModel(column)),
      personGroups: (plan?.semanticGroups ?? []).map((group) => ({
        identity: group.groupIdentity,
        kind: group.kind,
        status: group.status,
        members: group.members.map((member) => ({ column: member.columnIdentity, role: member.role })),
      })),
      diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      information: plan ? [{ code: "safe_synthetic_mode", reason: "Preview uses the GenerationPlan Safe Synthetic mode." }] : [],
      preview: {
        columns: plan?.table.columns.map((column) => column.name) ?? [],
        rows: this.currentDataset?.rows.map((row) => ({ ...row })) ?? [],
      },
      export: {
        enabled: Boolean(plan && plan.status !== "blocked"
          && ["ready", "ready_with_warnings"].includes(this.status)
          && this.currentDataset?.rows.length > 0),
        rowCount: this.currentDataset?.rows.length ?? 0,
      },
      plan: plan ? {
        status: plan.status,
        seed: plan.seed,
        rowCount: plan.rowCount,
        locale: plan.locale,
        mode: plan.mode,
        determinismProfile: plan.determinismProfile,
        columns: plan.columns.map((column) => ({
          column: column.schema.name,
          rule: { ...column.rule, parameters: { ...column.rule.parameters } },
          semanticMapping: { ...column.semanticMapping, evidence: [...column.semanticMapping.evidence] },
        })),
        semanticGroups: plan.semanticGroups.map((group) => ({ ...group })),
      } : null,
      safeSyntheticNotice: SAFE_SYNTHETIC_NOTICE,
      error: this.error,
      actionError: this.actionError,
    };
  }

  /**
   * Return a download descriptor for the already-generated current dataset.
   * @param {"csv" | "json"} format
   */
  prepareExport(format) {
    if (format !== "csv" && format !== "json") throw new TypeError("Export format must be csv or json");
    if (this.plan?.status === "blocked" || this.status === "blocked") {
      throw new ExportError("export_blocked_plan", "Blocked plans cannot be exported");
    }
    if (!this.plan || !this.currentDataset || this.status === "preview_error"
      || !["ready", "ready_with_warnings"].includes(this.status)
      || this.currentDataset.rows.length === 0) {
      throw new ExportError("export_no_dataset", "A successfully generated dataset with rows is required for export");
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

  async refreshPreview() {
    this.status = "loading";
    this.schema = null;
    this.plan = null;
    this.currentDataset = null;
    this.diagnostics = [];
    this.error = null;
    try {
      this.schema = await this.provider.getTableMetadata({ tableIdentity: this.selectedFixture });
      const options = {
        ...this.controls,
        mode: "safe_synthetic",
        semanticOverrides: { ...this.semanticOverrides },
        semanticMappings: { ...this.semanticMappings },
      };
      const initialPlan = buildGenerationPlan(this.schema, options);
      const declarations = this.schema?.workbench?.personGroups;
      this.plan = Array.isArray(declarations)
        ? buildGenerationPlan(this.schema, { ...options, personGroups: selectedFixtureGroups(declarations, initialPlan) })
        : initialPlan;
      const result = generateRows(this.plan);
      this.diagnostics = result.diagnostics;
      this.status = result.status;
      if (this.plan.status !== "blocked" && result.status !== "blocked") {
        this.currentDataset = createExportDataset(this.plan, result);
      }
    } catch (error) {
      this.failPreview(error);
    }
  }

  /** @param {string} name */
  findPlanColumn(name) {
    const column = this.plan?.columns.find((entry) => entry.schema.name === name);
    if (!column) throw new Error(`Unknown column: ${String(name)}`);
    return column;
  }

  /** @param {unknown} error */
  failPreview(error) {
    this.status = "preview_error";
    this.plan = null;
    this.currentDataset = null;
    this.diagnostics = [];
    this.error = error instanceof Error ? error.message : String(error);
  }
}

/**
 * Keep only fixture-declared group memberships which the Core's preliminary
 * plan identifies as selected Person semantic mappings. Compatibility and
 * mapping validity remain Core decisions.
 * @param {Array<{ id: string, columns: string[] }>} declarations
 * @param {import("../generation/generation-plan.mjs").GenerationPlan} plan
 */
function selectedFixtureGroups(declarations, plan) {
  const selected = new Set(plan.columns
    .filter((column) => column.semanticMapping.selected && column.rule.kind.startsWith("semantic:"))
    .map((column) => column.schema.name));
  return declarations
    .map((group) => ({ id: group.id, columns: group.columns.filter((column) => selected.has(column)) }))
    .filter((group) => group.columns.length > 0);
}

/** @param {import("../generation/generation-plan.mjs").ColumnGenerationPlan} column */
function toColumnViewModel(column) {
  const inference = column.inference;
  const semanticMapping = column.semanticMapping;
  const isSelectedSemantic = semanticMapping.selected && column.rule.kind.startsWith("semantic:");
  const rejectedMapping = ["invalid", "incompatible"].includes(semanticMapping.status)
    && ["explicit_user_semantic_override", "confirmed_semantic_mapping"].includes(semanticMapping.source);
  const mappingStatus = isSelectedSemantic
    ? semanticMapping.source === "confirmed_semantic_mapping" ? "Confirmed" : "Override"
    : rejectedMapping
      ? `${semanticMapping.source === "confirmed_semantic_mapping" ? "Confirmed mapping" : "Override"} incompatible · fallback active`
      : inference.status === "candidate" ? "Needs confirmation · fallback active"
        : inference.status === "ambiguous" ? "Ambiguous · fallback"
          : inference.status === "incompatible" ? "Incompatible · fallback"
            : "Fallback";
  const detected = inference.status === "ambiguous"
    ? `Ambiguous · ${inference.candidates.map(title).join(" / ")}`
    : inference.semanticType === "unknown" ? "Unknown" : title(inference.semanticType);

  return {
    column: column.schema.name,
    schemaType: formatSchemaType(column.schema),
    detected,
    detectedType: inference.semanticType,
    candidates: [...inference.candidates],
    confidence: title(inference.confidence),
    selectedMapping: isSelectedSemantic || rejectedMapping ? title(semanticMapping.semanticType) : title(column.rule.kind),
    mappingStatus,
    mappingValue: isSelectedSemantic || rejectedMapping ? semanticMapping.semanticType : "auto",
    canConfirm: !isSelectedSemantic && inference.status === "candidate" && SEMANTIC_TYPES.includes(inference.semanticType),
    rule: { kind: column.rule.kind, source: column.rule.source },
    evidence: [...semanticMapping.evidence],
  };
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
function formatSchemaType(column) {
  const type = column.dataType.state === "known" ? String(column.dataType.value) : title(column.dataType.state);
  const length = column.length.state === "known" ? column.length.value : null;
  const precision = column.precision.state === "known" ? column.precision.value : null;
  const scale = column.scale.state === "known" ? column.scale.value : null;
  if (length !== null) return `${type}(${length})`;
  if (precision !== null) return `${type}(${precision}${scale === null ? "" : `, ${scale}`})`;
  return type;
}

/** @param {string} value */
function title(value) {
  if (value === "unknown") return "Unknown";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
