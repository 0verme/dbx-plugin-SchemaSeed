import { validateDatasetConstraints } from "../generation/manual-constraints.mjs";

const SAFE_STATUSES = new Set(["ready", "ready_with_warnings"]);
const EXPORT_SCALAR_TYPES = new Set(["string", "number", "boolean"]);

/** Structured, user-presentable export failure. Structural contract errors fail closed. */
export class ExportError extends Error {
  /** @param {string} code @param {string} reason */
  constructor(code, reason) {
    super(reason);
    this.name = "ExportError";
    this.code = code;
    this.severity = "error";
  }
}

/**
 * Freeze the small export boundary from an already-generated Core result.
 * This function never invokes generation or derives mapping rules.
 * @param {import("../generation/generation-plan.mjs").GenerationPlan} plan
 * @param {{ rows: Array<Record<string, unknown>>, status: string }} generated
 * @returns {ExportDataset}
 */
export function createExportDataset(plan, generated) {
  if (!plan || !generated || !Array.isArray(generated.rows)) {
    throw new ExportError("export_no_dataset", "A GenerationPlan and successful generated rows are required");
  }
  if (plan.status === "blocked" || generated.status === "blocked") {
    throw new ExportError("export_blocked_plan", "Blocked plans or generation results cannot be exported");
  }
  if (!SAFE_STATUSES.has(plan.status) || !SAFE_STATUSES.has(generated.status)) {
    throw new ExportError("export_no_dataset", "A successfully generated dataset is not available");
  }
  if (typeof plan.table?.tableIdentity !== "string" || plan.table.tableIdentity.trim() === ""
    || !Array.isArray(plan.table.columns) || !Array.isArray(plan.columns)) {
    throw new ExportError("export_invalid_columns", "GenerationPlan must contain a table identity and ordered columns");
  }

  const columns = plan.table.columns.map((column) => column?.name);
  validateColumns(columns);
  const plannedColumns = plan.columns.map((column) => column?.schema?.name);
  if (plannedColumns.length !== columns.length || columns.some((column, index) => plannedColumns[index] !== column)) {
    throw new ExportError("export_invalid_columns", "GenerationPlan columns do not match the TableSchema column order");
  }
  if (!Number.isSafeInteger(plan.rowCount) || plan.rowCount < 0
    || generated.rows.length !== plan.rowCount) {
    throw new ExportError("export_row_shape_mismatch", "Generated row count does not match the GenerationPlan");
  }

  const rows = normalizeRows(generated.rows, columns);
  if (plan.constraintPlan) {
    const validation = validateDatasetConstraints(rows, plan.constraintPlan);
    if (!validation.valid) {
      const error = new ExportError("export_constraint_violation", "Dataset failed independent manual-constraint validation");
      error.diagnostics = validation.diagnostics;
      throw error;
    }
  }
  const generationContext = Object.freeze({
    seed: plan.seed,
    locale: plan.locale,
    rowCount: plan.rowCount,
    determinismProfile: plan.determinismProfile,
  });
  return Object.freeze({
    tableIdentity: plan.table.tableIdentity,
    columns: Object.freeze([...columns]),
    rows: Object.freeze(rows),
    generationContext,
  });
}

/** Validate a standalone ExportDataset and return the same instance. */
export function validateExportDataset(dataset) {
  if (!dataset || typeof dataset !== "object") {
    throw new ExportError("export_no_dataset", "No generated dataset is available for export");
  }
  if (typeof dataset.tableIdentity !== "string" || dataset.tableIdentity.trim() === ""
    || !Array.isArray(dataset.columns) || !Array.isArray(dataset.rows)
    || !dataset.generationContext || typeof dataset.generationContext !== "object") {
    throw new ExportError("export_no_dataset", "ExportDataset does not satisfy the required dataset contract");
  }
  validateColumns(dataset.columns);
  if (!Number.isSafeInteger(dataset.generationContext.rowCount) || dataset.generationContext.rowCount < 0
    || typeof dataset.generationContext.seed !== "string"
    || typeof dataset.generationContext.locale !== "string"
    || typeof dataset.generationContext.determinismProfile !== "string") {
    throw new ExportError("export_no_dataset", "ExportDataset generationContext is incomplete");
  }
  if (dataset.rows.length !== dataset.generationContext.rowCount) {
    throw new ExportError("export_row_shape_mismatch", "Dataset row count does not match generationContext.rowCount");
  }
  validateRows(dataset.rows, dataset.columns);
  return dataset;
}

/** @param {string[]} columns */
function validateColumns(columns) {
  if (columns.length === 0 || columns.some((column) => typeof column !== "string" || column.trim() === "")
    || new Set(columns).size !== columns.length) {
    throw new ExportError("export_invalid_columns", "ExportDataset columns must be non-empty, unique names in explicit order");
  }
}

/** @param {Array<Record<string, unknown>>} rows @param {string[]} columns */
function normalizeRows(rows, columns) {
  validateRows(rows, columns);
  return rows.map((row) => Object.freeze(Object.fromEntries(columns.map((column) => [column, row[column]]))));
}

/** @param {Array<Record<string, unknown>>} rows @param {string[]} columns */
function validateRows(rows, columns) {
  const expected = new Set(columns);
  for (const [index, row] of rows.entries()) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new ExportError("export_row_shape_mismatch", `Dataset row ${index + 1} must be an object`);
    }
    const keys = Reflect.ownKeys(row);
    if (keys.length !== columns.length || keys.some((key) => typeof key !== "string" || !expected.has(key))) {
      throw new ExportError("export_row_shape_mismatch", `Dataset row ${index + 1} columns do not match the declared column order`);
    }
    for (const column of columns) {
      if (!Object.hasOwn(row, column)) {
        throw new ExportError("export_row_shape_mismatch", `Dataset row ${index + 1} is missing column ${column}`);
      }
      const value = row[column];
      if (value !== null && !EXPORT_SCALAR_TYPES.has(typeof value)) {
        throw new ExportError("export_serialization_failed", `Column ${column} contains a value that CSV / JSON cannot safely serialize`);
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new ExportError("export_serialization_failed", `Column ${column} contains a non-finite number`);
      }
    }
  }
}

/**
 * @typedef {Object} ExportDataset
 * @property {string} tableIdentity
 * @property {string[]} columns Explicit TableSchema column order.
 * @property {Array<Record<string, string | number | boolean | null>>} rows
 * @property {{ seed: string, locale: string, rowCount: number, determinismProfile: string }} generationContext
 */

/** @param {string} tableIdentity @param {number} rowCount @param {"csv" | "json"} format */
export function createExportFilename(tableIdentity, rowCount, format) {
  if (typeof tableIdentity !== "string" || tableIdentity.trim() === ""
    || !Number.isSafeInteger(rowCount) || rowCount < 0
    || !["csv", "json"].includes(format)) {
    throw new TypeError("A table identity, non-negative row count, and csv/json format are required");
  }
  const normalizedTableName = tableIdentity.normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  const safeTableName = Array.from(normalizedTableName).slice(0, 80).join("") || "table";
  return `schemaseed-${safeTableName}-${rowCount}rows.${format}`;
}
