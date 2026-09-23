import { ExportError, validateExportDataset } from "./export-dataset.mjs";

const CSV_MODES = new Set(["raw", "spreadsheet_safe"]);
const UTF8_BOM = "\uFEFF";

/**
 * Serialize an existing ExportDataset as UTF-8-compatible CSV text.
 * RFC-style quoting uses CRLF record separators and doubled embedded quotes.
 * @param {import("./export-dataset.mjs").ExportDataset} dataset
 * @param {{ header?: boolean, nullToken?: string, mode?: "raw" | "spreadsheet_safe", bom?: boolean }} [options]
 */
export function exportCsv(dataset, options = {}) {
  validateExportDataset(dataset);
  const { header = true, nullToken = "", mode = "raw", bom = false } = options;
  if (typeof header !== "boolean" || typeof nullToken !== "string" || typeof bom !== "boolean" || !CSV_MODES.has(mode)) {
    throw new TypeError("CSV options require boolean header/bom, string nullToken, and raw or spreadsheet_safe mode");
  }

  try {
    const records = [];
    if (header) records.push(dataset.columns.map((column) => serializeField(column, mode, true)).join(","));
    for (const row of dataset.rows) {
      records.push(dataset.columns.map((column) => {
        const value = row[column];
        if (value === null) return serializeField(nullToken, mode, true);
        return serializeField(value, mode, typeof value === "string");
      }).join(","));
    }
    return `${bom ? UTF8_BOM : ""}${records.join("\r\n")}`;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("export_serialization_failed", `CSV serialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** @param {string | number | boolean} value @param {string} mode @param {boolean} isString */
function serializeField(value, mode, isString) {
  let text = String(value);
  if (mode === "spreadsheet_safe" && isString && /^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
