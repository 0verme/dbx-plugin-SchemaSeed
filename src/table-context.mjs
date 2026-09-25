/**
 * SchemaSeed's internal consumer contract. DBX's wire payload is adapted here
 * once so the rest of the probe never depends on host-specific object shapes.
 */
export const PLUGIN_ID = "io.github.0verme.schema-seed";
export const PLUGIN_VERSION = "0.2.4";
// Legacy Phase 0 contract kept only for the manually opened Schema Metadata
// Probe Workbench sidecar flow and its tests. The production table context-menu
// contribution was removed in the DBX v0.6.23 runtime-validation cleanup;
// `contextMenu/<id>` is no longer reachable through a manifest entry.
export const TABLE_CONTEXT_CONTRIBUTION_ID = `${PLUGIN_ID}.table-context-probe`;
export const TABLE_CONTEXT_METHOD = `contextMenu/${TABLE_CONTEXT_CONTRIBUTION_ID}`;

/**
 * @typedef {Object} TableContext
 * @property {string} connectionId
 * @property {string=} database
 * @property {string=} schema
 * @property {string} table
 */

/** @param {unknown} value */
export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize the actual #9918 payload:
 * `{ table: { connectionId, database?, schema?, table } }`.
 * Unknown fields are deliberately discarded at this boundary.
 *
 * @param {unknown} payload
 * @returns {{ ok: true, context: TableContext } | { ok: false, code: string, message: string }}
 */
export function normalizeTableContextPayload(payload) {
  if (!isRecord(payload)) return invalid("Payload must be an object");
  if (!isRecord(payload.table)) return invalid("Missing table context");

  const tablePayload = payload.table;
  const connectionId = requiredText(tablePayload.connectionId, "table.connectionId");
  if (!connectionId.ok) return connectionId;
  const table = requiredText(tablePayload.table, "table.table");
  if (!table.ok) return table;

  const database = optionalText(tablePayload.database, "table.database");
  if (!database.ok) return database;
  const schema = optionalText(tablePayload.schema, "table.schema");
  if (!schema.ok) return schema;

  /** @type {TableContext} */
  const context = { connectionId: connectionId.value };
  if (database.value !== undefined) context.database = database.value;
  if (schema.value !== undefined) context.schema = schema.value;
  context.table = table.value;
  return { ok: true, context: Object.freeze(context) };
}

/**
 * @param {TableContext} context
 */
export function formatProbeOutput(context) {
  return JSON.stringify(context, null, 2);
}

/**
 * @param {unknown} payload
 */
export function probeTableContextPayload(payload) {
  const normalized = normalizeTableContextPayload(payload);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    context: normalized.context,
    result: {
      // DBX's native context-menu host displays this message as a toast.
      message: formatProbeOutput(normalized.context),
      context: normalized.context,
    },
  };
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    return invalid(`${field} is required and must be a non-empty string`);
  }
  return { ok: true, value: value.trim() };
}

function optionalText(value, field) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") return invalid(`${field} must be a string when provided`);
  const normalized = value.trim();
  return { ok: true, value: normalized || undefined };
}

function invalid(message) {
  return { ok: false, code: "MALFORMED_TABLE_CONTEXT", message };
}
