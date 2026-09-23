import { ExportError, validateExportDataset } from "./export-dataset.mjs";

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
    return JSON.stringify(dataset.rows, dataset.columns, pretty ? 2 : undefined);
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("export_serialization_failed", `JSON serialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
