import { interpretColumnType, resolveTemporalPrecision } from "../schema/schema-interpreter.mjs";

export const TEMPORAL_METADATA_MAX_ROWS = 8;
export const TEMPORAL_METADATA_TIMEOUT_MS = 3_000;
const MYSQL_METADATA_PROVENANCE = "DBX Host Data API 1.4 MySQL information_schema.COLUMNS.DATETIME_PRECISION";
const POSTGRES_METADATA_PROVENANCE = "DBX Host Data API 1.4 PostgreSQL information_schema.columns.datetime_precision";
const POSTGRES_DB_TYPES = new Set(["postgres", "postgresql"]);
const SAFE_SCOPE_IDENTIFIER = /^[A-Za-z0-9_]{1,256}$/u;

/**
 * Resolve missing temporal precision through DBX's consent-gated Data API.
 * The first bounded, read-only query discovers the public `dbType` result;
 * only a verified MySQL or PostgreSQL result can select its narrowly scoped
 * information_schema query. The function returns precision summaries only,
 * never raw rows. Every failure is a safe metadata-only fallback.
 *
 * @param {{ capabilities?: unknown, queryData?: (request: object) => Promise<unknown> }} host
 * @param {{ connectionId: string, database?: string, schema?: string, table: string }} context
 * @param {import("../schema/schema-model.mjs").TableSchema} schema
 * @param {{ timeoutMs?: number }} [options] Testable request timeout, always clamped to the production ceiling.
 * @returns {Promise<Record<string, { state: "known", value: number, source: "system_metadata", provenance: string }>>}
 */
export async function resolveDbxTemporalMetadata(host, context, schema, options = {}) {
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, TEMPORAL_METADATA_TIMEOUT_MS)
    : TEMPORAL_METADATA_TIMEOUT_MS;
  if (host?.capabilities?.dataApi !== true || typeof host?.queryData !== "function") return {};
  const candidates = temporalCandidates(schema);
  if (candidates.length === 0 || !isSafeBaseScope(context)) return {};

  try {
    const discovery = await requestWithDeadline(host, context, "SELECT 1 AS ss_temporal_precision_probe", 1, timeoutMs);
    if (!isValidQueryResult(discovery, 1) || discovery.rows.length !== 1) return {};

    if (discovery.dbType === "mysql") {
      const mysqlCandidates = candidates
        .filter((column) => ["timestamp", "datetime"].includes(getTemporalTypeName(column)))
        .slice(0, TEMPORAL_METADATA_MAX_ROWS);
      const query = buildMySqlTemporalMetadataQuery(context, mysqlCandidates);
      if (!query) return {};
      const result = await requestWithDeadline(host, context, query.sql, TEMPORAL_METADATA_MAX_ROWS, timeoutMs);
      const values = readMySqlTemporalMetadata(result, query.columnTypes);
      return toSystemMetadata(values, MYSQL_METADATA_PROVENANCE);
    }

    if (POSTGRES_DB_TYPES.has(discovery.dbType.toLowerCase())) {
      const postgresCandidates = candidates
        .filter((column) => ["timestamp", "timestamptz"].includes(getTemporalTypeName(column)))
        .slice(0, TEMPORAL_METADATA_MAX_ROWS);
      const query = buildPostgresTemporalMetadataQuery(context, postgresCandidates);
      if (!query) return {};
      const result = await requestWithDeadline(host, context, query.sql, TEMPORAL_METADATA_MAX_ROWS, timeoutMs);
      const values = readPostgresTemporalMetadata(result, query.columnTypes);
      return toSystemMetadata(values, POSTGRES_METADATA_PROVENANCE);
    }

    return {};
  } catch {
    // Consent denial, missing capabilities, query rejection and timeout do not
    // escape the metadata path or leak Host error details into diagnostics.
    return {};
  }
}

/**
 * Construct the narrow MySQL metadata SELECT. There is no documented bind
 * parameter field on queryData, so interpolation is limited to validated
 * ASCII identifier values; unsafe names decline the query entirely.
 * @param {{ database?: string, schema?: string, table: string }} context
 * @param {Array<{ name: string, dataType?: { state?: string, value?: unknown } }>} columns
 * @returns {{ sql: string, columnTypes: Record<string, string> } | null}
 */
export function buildMySqlTemporalMetadataQuery(context, columns) {
  if (!isSafeMySqlScope(context) || !Array.isArray(columns) || columns.length === 0) return null;
  const uniqueColumns = [...new Map(columns.map((column) => [column?.name, column])).values()];
  const names = uniqueColumns.map((column) => column?.name);
  if (names.length === 0 || names.length > TEMPORAL_METADATA_MAX_ROWS
    || names.some((name) => !isSafeScopeIdentifier(name))) return null;

  const columnTypes = Object.fromEntries(uniqueColumns.map((column) => [column.name, getTemporalTypeName(column)]));
  if (Object.values(columnTypes).some((type) => !["timestamp", "datetime"].includes(type))) return null;
  const quoted = (value) => `'${value}'`;
  return {
    sql: `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, DATETIME_PRECISION AS datetime_precision FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${quoted(context.database)} AND TABLE_NAME = ${quoted(context.table)} AND COLUMN_NAME IN (${names.map(quoted).join(", ")}) LIMIT ${TEMPORAL_METADATA_MAX_ROWS}`,
    columnTypes,
  };
}

/**
 * Construct a target-scoped PostgreSQL information_schema query. Precision is
 * accepted only after verifying the database type and the returned timestamp
 * timezone category; unsafe identifiers decline the query entirely.
 * @param {{ database?: string, schema?: string, table: string }} context
 * @param {Array<{ name: string, dataType?: { state?: string, value?: unknown } }>} columns
 * @returns {{ sql: string, columnTypes: Record<string, string> } | null}
 */
export function buildPostgresTemporalMetadataQuery(context, columns) {
  if (!isSafePostgresScope(context) || !Array.isArray(columns) || columns.length === 0) return null;
  const uniqueColumns = [...new Map(columns.map((column) => [column?.name, column])).values()];
  const names = uniqueColumns.map((column) => column?.name);
  if (names.length === 0 || names.length > TEMPORAL_METADATA_MAX_ROWS
    || names.some((name) => !isSafeScopeIdentifier(name))) return null;

  const columnTypes = Object.fromEntries(uniqueColumns.map((column) => {
    const interpreted = interpretColumnType(column);
    if (interpreted?.kind !== "timestamp") return [column.name, ""];
    const timezoneAware = interpreted.parameters.timezoneAware === true;
    return [column.name, timezoneAware ? "timestamp with time zone" : "timestamp without time zone"];
  }));
  if (Object.values(columnTypes).some((type) => !["timestamp with time zone", "timestamp without time zone"].includes(type))) return null;
  const quoted = (value) => `'${value}'`;
  return {
    sql: `SELECT column_name AS column_name, data_type AS data_type, datetime_precision AS datetime_precision FROM information_schema.columns WHERE table_catalog = ${quoted(context.database)} AND table_schema = ${quoted(context.schema)} AND table_name = ${quoted(context.table)} AND column_name IN (${names.map(quoted).join(", ")}) LIMIT ${TEMPORAL_METADATA_MAX_ROWS}`,
    columnTypes,
  };
}

/** @param {unknown} schema */
function temporalCandidates(schema) {
  if (!schema || !Array.isArray(schema.columns)) return [];
  return schema.columns.filter((column) => {
    if (!column || typeof column.name !== "string" || !isSafeScopeIdentifier(column.name)) return false;
    if (resolveTemporalPrecision(column).state === "known") return false;
    return interpretColumnType(column)?.kind === "timestamp" && getTemporalTypeName(column) !== null;
  });
}

/** @param {unknown} column */
function getTemporalTypeName(column) {
  if (column?.dataType?.state !== "known" || typeof column.dataType.value !== "string") return null;
  const match = column.dataType.value.trim().toLowerCase().match(/^(timestamp|datetime|timestamptz)(?:\s*\(|\s|$)/u);
  return match?.[1] ?? null;
}

/** @param {{ connectionId: string, database?: string, schema?: string, table: string }} context */
function isSafeBaseScope(context) {
  return context !== null && typeof context === "object"
    && typeof context.connectionId === "string" && context.connectionId.trim() !== "" && context.connectionId.length <= 256
    && isSafeScopeIdentifier(context.database)
    && isSafeScopeIdentifier(context.table)
    && (context.schema === undefined || context.schema === null || isSafeScopeIdentifier(context.schema));
}

/** @param {unknown} context */
function isSafeMySqlScope(context) {
  return isSafeBaseScope(context)
    && (context.schema === undefined || context.schema === null || context.schema === context.database);
}

/** @param {unknown} context */
function isSafePostgresScope(context) {
  return isSafeBaseScope(context) && isSafeScopeIdentifier(context.schema);
}

/** @param {unknown} value */
function isSafeScopeIdentifier(value) {
  return typeof value === "string" && SAFE_SCOPE_IDENTIFIER.test(value);
}

/** @param {{ capabilities?: unknown, queryData: (request: object) => Promise<unknown> }} host @param {object} context @param {string} sql @param {number} maxRows @param {number} timeoutMs */
async function requestWithDeadline(host, context, sql, maxRows, timeoutMs) {
  const request = {
    connectionId: context.connectionId,
    sql,
    maxRows,
    timeoutMs,
    ...(typeof context.database === "string" ? { database: context.database } : {}),
    ...(typeof context.schema === "string" ? { schema: context.schema } : {}),
  };
  return withDeadline(Promise.resolve().then(() => host.queryData(request)), timeoutMs + 500);
}

/** @param {unknown} result @param {number} maxRows */
function isValidQueryResult(result, maxRows) {
  return isRecord(result) && typeof result.dbType === "string"
    && Array.isArray(result.columns) && Array.isArray(result.rows)
    && result.rows.length <= maxRows && result.truncated === false;
}

/** @param {unknown} result @param {Record<string, string>} requestedColumnTypes */
function readMySqlTemporalMetadata(result, requestedColumnTypes) {
  const output = new Map();
  if (!isValidQueryResult(result, TEMPORAL_METADATA_MAX_ROWS) || result.dbType !== "mysql") return output;

  const columnIndexes = new Map();
  for (const [index, column] of result.columns.entries()) {
    if (isRecord(column) && typeof column.name === "string") columnIndexes.set(column.name.toLowerCase(), index);
  }
  const indexes = ["column_name", "data_type", "column_type", "datetime_precision"].map((name) => columnIndexes.get(name));
  if (indexes.some((index) => !Number.isSafeInteger(index))) return output;

  const allowed = new Set(Object.keys(requestedColumnTypes));
  const seen = new Set();
  for (const row of result.rows) {
    if (!Array.isArray(row) || row.length <= Math.max(...indexes)) return new Map();
    const [columnName, dataType, columnType, rawPrecision] = indexes.map((index) => row[index]);
    if (typeof columnName !== "string" || !allowed.has(columnName) || seen.has(columnName)) continue;
    seen.add(columnName);
    const expectedType = requestedColumnTypes[columnName];
    const normalizedType = typeof dataType === "string" ? dataType.toLowerCase() : "";
    const normalizedColumnType = typeof columnType === "string" ? columnType.toLowerCase() : "";
    const precision = parseMetadataPrecision(rawPrecision);
    if (!expectedType || normalizedType !== expectedType
      || !new RegExp(`^${expectedType}(?:\\(\\d+\\))?$`, "u").test(normalizedColumnType)
      || precision === null) continue;
    output.set(columnName, precision);
  }
  return output;
}

/** @param {unknown} result @param {Record<string, string>} requestedColumnTypes */
function readPostgresTemporalMetadata(result, requestedColumnTypes) {
  const output = new Map();
  if (!isValidQueryResult(result, TEMPORAL_METADATA_MAX_ROWS)
    || !POSTGRES_DB_TYPES.has(result.dbType.toLowerCase())) return output;

  const columnIndexes = new Map();
  for (const [index, column] of result.columns.entries()) {
    if (isRecord(column) && typeof column.name === "string") columnIndexes.set(column.name.toLowerCase(), index);
  }
  const indexes = ["column_name", "data_type", "datetime_precision"].map((name) => columnIndexes.get(name));
  if (indexes.some((index) => !Number.isSafeInteger(index))) return output;

  const allowed = new Set(Object.keys(requestedColumnTypes));
  const seen = new Set();
  for (const row of result.rows) {
    if (!Array.isArray(row) || row.length <= Math.max(...indexes)) return new Map();
    const [columnName, dataType, rawPrecision] = indexes.map((index) => row[index]);
    if (typeof columnName !== "string" || !allowed.has(columnName) || seen.has(columnName)) continue;
    seen.add(columnName);
    const expectedType = requestedColumnTypes[columnName];
    const precision = parseMetadataPrecision(rawPrecision);
    if (!expectedType || typeof dataType !== "string" || dataType.trim().toLowerCase() !== expectedType || precision === null) continue;
    output.set(columnName, precision);
  }
  return output;
}

/** @param {Map<string, number>} values @param {string} provenance */
function toSystemMetadata(values, provenance) {
  return Object.fromEntries([...values].map(([column, value]) => [column, {
    state: "known",
    value,
    source: "system_metadata",
    provenance,
  }]));
}

/** @param {unknown} value */
function parseMetadataPrecision(value) {
  const precision = typeof value === "number" ? value
    : typeof value === "string" && /^\d{1,2}$/u.test(value) ? Number(value) : null;
  return Number.isSafeInteger(precision) && precision >= 0 && precision <= 6 ? precision : null;
}

/** @param {Promise<unknown>} promise @param {number} timeoutMs */
function withDeadline(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("temporal_metadata_timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
