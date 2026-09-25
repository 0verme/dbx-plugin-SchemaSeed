/**
 * Production Workbench export save adapter.
 *
 * The DBX plugin Workbench runs inside a sandboxed iframe: the browser
 * `Blob` + `<a download>` pattern does not reach the OS save dialog there, and
 * the blob URL is never written to disk. The public DBX Host bridge exposes
 * `window.dbxPlugin.saveFile({ fileName, contentType }, bytes)`, which hands
 * the bytes to the host, opens the native save dialog and writes the file.
 *
 * This adapter is the only place the production Workbench touches that host
 * API. It receives the existing `prepareExport()` descriptor, encodes
 * `descriptor.content` as UTF-8 (the serializers already decided on BOM /
 * escapes / newlines) and maps the host result to an explicit
 * saved / cancelled / failed outcome. The Export Core stays host-free.
 */

export const EXPORT_SAVE_STATUS = Object.freeze({
  SAVED: "saved",
  CANCELLED: "cancelled",
  FAILED: "failed",
});

export const EXPORT_SAVE_ERROR = Object.freeze({
  /** No `host.saveFile` on this DBX runtime; fail closed instead of falling back to a browser download. */
  HOST_UNAVAILABLE: "export_host_save_unavailable",
  /** The host rejected the save or the write failed. */
  HOST_FAILED: "export_host_save_failed",
});

/**
 * Encode serialized export content as UTF-8 bytes. The serializer contract
 * (CSV BOM, spreadsheet-safe prefixes, JSON without BOM, SQL literals) is
 * applied to the string before this step and is not modified here.
 * @param {unknown} content
 */
export function encodeExportContent(content) {
  return new TextEncoder().encode(String(content));
}

/**
 * Hand one `prepareExport()` descriptor to the DBX Host native save API.
 *
 * @param {unknown} saveFile `window.dbxPlugin.saveFile` (or the same contract from a test double)
 * @param {{ filename: string, mimeType: string, content: string }} descriptor
 * @returns {Promise<
 *   { status: "saved", path?: string }
 *   | { status: "cancelled" }
 *   | { status: "failed", code: string }
 * >}
 */
export async function saveExportWithHost(saveFile, descriptor) {
  if (typeof saveFile !== "function") {
    return { status: EXPORT_SAVE_STATUS.FAILED, code: EXPORT_SAVE_ERROR.HOST_UNAVAILABLE };
  }

  let bytes;
  try {
    bytes = encodeExportContent(descriptor?.content ?? "");
  } catch {
    return { status: EXPORT_SAVE_STATUS.FAILED, code: EXPORT_SAVE_ERROR.HOST_FAILED };
  }

  let result;
  try {
    result = await saveFile({ fileName: descriptor.filename, contentType: descriptor.mimeType }, bytes);
  } catch {
    return { status: EXPORT_SAVE_STATUS.FAILED, code: EXPORT_SAVE_ERROR.HOST_FAILED };
  }

  // Host contract: the promise resolves null when the user cancels the native dialog.
  if (result === null || result === undefined) return { status: EXPORT_SAVE_STATUS.CANCELLED };

  const path = typeof result === "object" && typeof result.path === "string" && result.path.trim() !== ""
    ? result.path
    : undefined;
  return path
    ? { status: EXPORT_SAVE_STATUS.SAVED, path }
    : { status: EXPORT_SAVE_STATUS.SAVED };
}
