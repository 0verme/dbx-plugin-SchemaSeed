import { PREVIEW_PAGE_SIZE } from "../generation/row-count.mjs";

/** @param {unknown} inputRows @param {number} requestedPage @param {number} [pageSize] */
export function paginatePreviewRows(inputRows, requestedPage, pageSize = PREVIEW_PAGE_SIZE) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : PREVIEW_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Number.isSafeInteger(requestedPage) ? Math.max(0, Math.min(requestedPage, pageCount - 1)) : 0;
  const startIndex = page * size;
  const endIndex = Math.min(startIndex + size, rows.length);
  return {
    page,
    pageCount,
    startRow: rows.length === 0 ? 0 : startIndex + 1,
    endRow: endIndex,
    totalRows: rows.length,
    rows: rows.slice(startIndex, endIndex),
  };
}
