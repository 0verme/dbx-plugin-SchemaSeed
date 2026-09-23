export const SCHEMA_METADATA_HOST_API_REQUIREMENT = "^1.3";
export const SCHEMA_METADATA_CAPABILITY = "schemaMetadataApi";
export const SCHEMA_METADATA_PERMISSION = "host.schema:read";
export const SCHEMA_METADATA_MAX_IDENTIFIER_LENGTH = 256;

export const SCHEMA_METADATA_PROBE_ERROR_CODES = Object.freeze({
  CAPABILITY_UNAVAILABLE: "capability_unavailable",
  PERMISSION_DENIED: "permission_denied",
  MISSING_TABLE_CONTEXT: "missing_table_context",
  CONNECTION_NOT_OPEN: "connection_not_open",
  METADATA_REQUEST_FAILED: "metadata_request_failed",
  INVALID_METADATA_RESPONSE: "invalid_metadata_response",
});

const FIELD_AVAILABILITY = new Set(["supported", "unsupported", "unknown"]);
const STRUCTURED_FIELDS = ["length", "precision", "scale", "default"];
const NOT_EXPOSED_FIELDS = ["primaryKey", "foreignKey", "unique", "check", "comment", "identity"];

/**
 * Consume the documented DBX 1.3 schema metadata Host API. This is a Phase 0
 * probe boundary, not the production SchemaMetadataProvider adapter.
 *
 * @param {{ capabilities?: unknown, getTableMetadata?: (context: object) => Promise<unknown> }} host
 * @param {unknown} tableContext
 */
export async function runDbxSchemaMetadataProbe(host, tableContext) {
  const context = normalizeTableContext(tableContext);
  const capabilityAvailable = isRecord(host?.capabilities)
    && host.capabilities[SCHEMA_METADATA_CAPABILITY] === true
    && typeof host?.getTableMetadata === "function";
  const capability = { name: SCHEMA_METADATA_CAPABILITY, available: capabilityAvailable };
  const hostApi = { requirement: SCHEMA_METADATA_HOST_API_REQUIREMENT, runtimeVersion: "not_exposed_to_workbench" };

  if (!context) {
    return failure(SCHEMA_METADATA_PROBE_ERROR_CODES.MISSING_TABLE_CONTEXT, "No valid recent table context is available.", {
      hostApi,
      capability,
      context: null,
    });
  }

  if (!capabilityAvailable) {
    return failure(
      SCHEMA_METADATA_PROBE_ERROR_CODES.CAPABILITY_UNAVAILABLE,
      "The current DBX host does not expose a callable schemaMetadataApi.",
      { hostApi, capability, context },
    );
  }

  let response;
  try {
    response = await host.getTableMetadata(context);
  } catch (error) {
    const message = errorMessage(error);
    const code = classifyHostError(message);
    return failure(code, message, { hostApi, capability, context });
  }

  const normalized = normalizeMetadataResponse(response);
  if (!normalized.ok) {
    return failure(SCHEMA_METADATA_PROBE_ERROR_CODES.INVALID_METADATA_RESPONSE, normalized.message, {
      hostApi,
      capability,
      context,
    });
  }

  return {
    ok: true,
    hostApi,
    capability,
    context,
    metadata: normalized.metadata,
    futureCapabilities: Object.fromEntries(
      NOT_EXPOSED_FIELDS.map((field) => [field, {
        status: "not_exposed",
        reason: "Not part of getTableMetadata in Host API 1.3.",
      }]),
    ),
    diagnostics: [],
  };
}

/** @param {unknown} value */
function normalizeTableContext(value) {
  if (!isRecord(value)) return null;
  const connectionId = requiredIdentifier(value.connectionId);
  const table = requiredIdentifier(value.table);
  if (!connectionId || !table) return null;

  const context = { connectionId, table };
  for (const key of ["database", "schema"]) {
    const optional = optionalIdentifier(value[key]);
    if (optional === INVALID_OPTIONAL_IDENTIFIER) return null;
    if (optional !== undefined) context[key] = optional;
  }
  return context;
}

/** @param {unknown} value */
function normalizeMetadataResponse(value) {
  if (!isRecord(value) || !Array.isArray(value.columns) || value.columns.length === 0) {
    return invalidResponse("Metadata response must contain a non-empty columns array.");
  }
  if (!isRecord(value.fieldCapabilities)) {
    return invalidResponse("Metadata response must contain fieldCapabilities.");
  }

  const columns = [];
  for (let index = 0; index < value.columns.length; index += 1) {
    const column = normalizeColumn(value.columns[index], index);
    if (!column.ok) return column;
    columns.push(column.value);
  }

  const fieldCapabilities = {};
  for (const field of STRUCTURED_FIELDS) {
    const availability = value.fieldCapabilities[field];
    if (!FIELD_AVAILABILITY.has(availability)) {
      return invalidResponse(`fieldCapabilities.${field} must be supported, unsupported, or unknown.`);
    }
    fieldCapabilities[field] = availability;
  }

  return { ok: true, metadata: { columns, fieldCapabilities } };
}

/** @param {unknown} value @param {number} index */
function normalizeColumn(value, index) {
  if (!isRecord(value)) return invalidResponse(`columns[${index}] must be an object.`);
  const name = requiredIdentifier(value.name);
  if (!name) return invalidResponse(`columns[${index}].name must be a non-empty identifier.`);
  if (typeof value.dataType !== "string" || value.dataType.trim() === "") {
    return invalidResponse(`columns[${index}].dataType must be a non-empty string.`);
  }
  if (typeof value.nullable !== "boolean") {
    return invalidResponse(`columns[${index}].nullable must be a boolean.`);
  }

  const column = { name, dataType: value.dataType.trim(), nullable: value.nullable };
  for (const field of ["length", "precision", "scale"]) {
    const normalized = optionalNumber(value, field, index);
    if (!normalized.ok) return normalized;
    if (normalized.present) column[field] = normalized.value;
  }
  const normalizedDefault = optionalDefault(value, index);
  if (!normalizedDefault.ok) return normalizedDefault;
  if (normalizedDefault.present) column.default = normalizedDefault.value;
  return { ok: true, value: column };
}

/** @param {Record<string, unknown>} object @param {string} field @param {number} index */
function optionalNumber(object, field, index) {
  if (!Object.hasOwn(object, field) || object[field] === undefined) return { ok: true, present: false };
  const value = object[field];
  if (value !== null && (!Number.isInteger(value) || !Number.isFinite(value))) {
    return invalidResponse(`columns[${index}].${field} must be an integer or null.`);
  }
  return { ok: true, present: true, value };
}

/** @param {Record<string, unknown>} object @param {number} index */
function optionalDefault(object, index) {
  if (!Object.hasOwn(object, "default") || object.default === undefined) return { ok: true, present: false };
  if (object.default !== null && typeof object.default !== "string") {
    return invalidResponse(`columns[${index}].default must be a string or null.`);
  }
  return { ok: true, present: true, value: object.default };
}

/** @param {unknown} value */
function requiredIdentifier(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > SCHEMA_METADATA_MAX_IDENTIFIER_LENGTH) return undefined;
  return normalized;
}

const INVALID_OPTIONAL_IDENTIFIER = Symbol("invalid optional identifier");
/** @param {unknown} value */
function optionalIdentifier(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return INVALID_OPTIONAL_IDENTIFIER;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (Array.from(normalized).length > SCHEMA_METADATA_MAX_IDENTIFIER_LENGTH) return INVALID_OPTIONAL_IDENTIFIER;
  return normalized;
}

/** @param {string} message */
function classifyHostError(message) {
  const normalized = message.toLowerCase();
  if (normalized.includes("connection is not open") || normalized.includes("connection session is not open")) {
    return SCHEMA_METADATA_PROBE_ERROR_CODES.CONNECTION_NOT_OPEN;
  }
  if (normalized.includes(SCHEMA_METADATA_PERMISSION) && (normalized.includes("permission") || normalized.includes("denied"))) {
    return SCHEMA_METADATA_PROBE_ERROR_CODES.PERMISSION_DENIED;
  }
  return SCHEMA_METADATA_PROBE_ERROR_CODES.METADATA_REQUEST_FAILED;
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message */
function invalidResponse(message) {
  return { ok: false, message };
}

/** @param {string} code @param {string} message @param {Record<string, unknown>} details */
function failure(code, message, details) {
  return {
    ok: false,
    ...details,
    diagnostics: [{ code, message }],
  };
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
