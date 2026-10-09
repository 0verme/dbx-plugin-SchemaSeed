import { ExportError, validateExportDataset } from "./export-dataset.mjs";
import { isJsonDocumentValue, unwrapJsonDocumentValue } from "../json-document.mjs";

/**
 * Serialize an existing ExportDataset as a deterministic JSON array.
 * Exact decimal strings stay strings; columns controls each object's field order.
 * @param {import("./export-dataset.mjs").ExportDataset} dataset
 * @param {{ pretty?: boolean }} [options]
 */
export function exportJson(dataset, options = {}) {
  validateExportDataset(dataset);
  const { pretty = true } = options;
  if (typeof pretty !== "boolean") throw new TypeError("JSON pretty option must be a boolean");

  try {
    const rows = dataset.rows.map((row) => Object.fromEntries(dataset.columns.map((column) => {
      const value = row[column];
      return [column, isJsonDocumentValue(value) ? unwrapJsonDocumentValue(value) : value];
    })));
    return JSON.stringify(rows, null, pretty ? 2 : undefined);
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("export_serialization_failed", `JSON serialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
