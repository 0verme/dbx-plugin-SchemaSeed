import { formatDate, formatTimestamp, parseDate, parseTimestamp } from "../schema/temporal-values.mjs";
import { inferSemanticType } from "../semantic/semantic-inference.mjs";
import { interpretColumnType } from "../schema/schema-interpreter.mjs";
import {
  ENUM_PATTERN_MAX_DISTINCT,
  ENUM_PATTERN_MAX_DISTINCT_RATIO,
  ENUM_PATTERN_MIN_SAMPLES,
  FILENAME_PATTERN_MIN_RATIO,
  FILENAME_PATTERN_MIN_SAMPLES,
  isFilenameColumnName,
  isFreeTextSampleColumn,
  isSafeCategoricalSampleColumn,
  isSafeCategoricalValue,
  isSensitiveSampleColumn,
  NAME_PATTERN_MIN_RATIO,
  NAME_PATTERN_MIN_SAMPLES,
  NUMERIC_PATTERN_MIN_SAMPLES,
  PATTERN_NEGATIVE_MAX_RATIO,
  SAMPLE_EVIDENCE_MAX_ROWS,
  TEMPORAL_PROFILE_MIN_ROWS,
} from "../semantic/sample-evidence.mjs";

export const DATA_SAMPLE_ROW_LIMIT = SAMPLE_EVIDENCE_MAX_ROWS;
export const DATA_SAMPLE_TIMEOUT_MS = 3_000;
export const DATA_SAMPLE_FIELD_MAX_LENGTH = 1_024;
const DATA_SAMPLE_UI_DEADLINE_MS = DATA_SAMPLE_TIMEOUT_MS + 500;
const METADATA_ONLY_SAMPLE_RESULT = Object.freeze({ sampleUsed: false, evidence: Object.freeze([]) });

const PORTABLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const RESERVED_TABLE_IDENTIFIERS = new Set([
  "all", "alter", "and", "as", "by", "case", "check", "column", "constraint", "create",
  "database", "default", "delete", "distinct", "drop", "else", "end", "exists", "false",
  "from", "group", "having", "in", "index", "insert", "into", "is", "join", "key", "limit",
  "not", "null", "offset", "on", "or", "order", "primary", "references", "returning", "role",
  "schema", "select", "set", "table", "then", "true", "union", "unique", "update", "user",
  "using", "values", "when", "where", "with",
]);

/**
 * Identify a narrow allow-list of uncertain string columns. Metadata facts are
 * authoritative: bounded strings retain direct projection; only strong semantic
 * candidates with native unbounded text receive a database-side truncated projection.
 * @param {import("../schema/schema-model.mjs").TableSchema} schema
 * @returns {Array<{ name: string, kind: "name" | "email" | "mobile" | "text" | "filename" | "numeric" | "temporal", numericKind?: "integer" | "decimal", temporalKind?: "date" | "timestamp", timezoneAware?: boolean, privacy?: "standard" | "restricted", sampling: "direct" | "truncate" }>}
 */
export function getSampleProbeCandidates(schema) {
  if (!schema || !Array.isArray(schema.columns)) return [];
  const candidates = [];
  for (const column of schema.columns) {
    const type = interpretColumnType(column);
    if ((type?.kind === "integer" || type?.kind === "decimal")
      && !isSensitiveSampleColumn(column.name) && !hasDatabaseIdentity(column)) {
      candidates.push({ name: column.name, kind: "numeric", numericKind: type.kind, sampling: "direct" });
      continue;
    }
    if ((type?.kind === "date" || type?.kind === "timestamp")
      && !isFreeTextSampleColumn(column.name) && !hasDatabaseIdentity(column)) {
      const privacy = temporalSamplePrivacy(column.name);
      candidates.push({
        name: column.name,
        kind: "temporal",
        temporalKind: type.kind,
        timezoneAware: type.parameters.timezoneAware === true,
        privacy,
        sampling: "direct",
      });
      continue;
    }
    if (type?.kind !== "varchar") continue;
    const sampling = type.capacity?.model === "bounded"
      && type.capacity.maxLength <= DATA_SAMPLE_FIELD_MAX_LENGTH ? "direct"
      : type.capacity?.model === "unbounded" && type.capacity.source === "native-text-type" ? "truncate"
        : null;
    if (!sampling) continue;

    if (isFilenameColumnName(column.name)) {
      candidates.push({ name: column.name, kind: "filename", sampling });
      continue;
    }
    const inference = inferSemanticType(column);
    const semanticPatternKind = ["name", "email", "mobile"].includes(inference.semanticType)
      ? inference.semanticType : null;
    if (semanticPatternKind && inference.status === "candidate" && inference.confidence !== "high") {
      candidates.push({ name: column.name, kind: semanticPatternKind, sampling });
      continue;
    }
    if (inference.status !== "unknown" || isSensitiveSampleColumn(column.name) || isFreeTextSampleColumn(column.name)) continue;
    candidates.push({ name: column.name, kind: "text", sampling });
  }
  return candidates;
}

/**
 * Query a tiny sample through the official DBX Host Data API. The returned
 * value is a bounded summary only; raw result rows never escape this function.
 * Every failure, including missing capability, permission denial and timeout,
 * degrades to metadata-only inference without exposing the Host error.
 * @param {{ capabilities?: unknown, queryData?: (request: object) => Promise<unknown> }} host
 * @param {{ connectionId: string, database?: string, schema?: string, table: string }} context
 * @param {import("../schema/schema-model.mjs").TableSchema} schema
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ sampleUsed: boolean, evidence: Array<Record<string, unknown>> }>}
 */
export async function probeDbxDataSamples(host, context, schema, options = {}) {
  if (host?.capabilities?.dataApi !== true || typeof host?.queryData !== "function") return METADATA_ONLY_SAMPLE_RESULT;
  const candidates = getSampleProbeCandidates(schema);
  if (candidates.length === 0) return METADATA_ONLY_SAMPLE_RESULT;
  const query = buildSampleSelectQuery(context, candidates);
  if (!query) return METADATA_ONLY_SAMPLE_RESULT;

  const requestedTimeout = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, DATA_SAMPLE_TIMEOUT_MS)
    : DATA_SAMPLE_TIMEOUT_MS;
  const request = {
    connectionId: context.connectionId,
    sql: query.sql,
    maxRows: DATA_SAMPLE_ROW_LIMIT,
    timeoutMs: requestedTimeout,
  };
  if (typeof context.database === "string") request.database = context.database;
  if (typeof context.schema === "string") request.schema = context.schema;

  try {
    const result = await withDeadline(
      Promise.resolve().then(() => host.queryData(request)),
      Math.min(DATA_SAMPLE_UI_DEADLINE_MS, requestedTimeout + 500),
    );
    return summarizeSampleResult(result, query.columns, candidates);
  } catch {
    // Do not expose query errors: DBX owns consent and the Workbench remains usable.
    return METADATA_ONLY_SAMPLE_RESULT;
  }
}

/**
 * Render only portable, unquoted identifiers. This deliberately declines
 * mixed-case, delimited, qualified, reserved table names and SQL-like input;
 * ANSI quotes are not portable to MySQL's default mode. Database/schema scope
 * travels in the Host request, not interpolated into SQL.
 * @param {{ connectionId: string, database?: string, schema?: string, table: string }} context
 * @param {Array<{ name: string, kind: "name" | "email" | "mobile" | "text" | "filename" | "numeric" | "temporal", numericKind?: "integer" | "decimal", temporalKind?: "date" | "timestamp", timezoneAware?: boolean, privacy?: "standard" | "restricted", sampling: "direct" | "truncate" }>} candidates
 */
export function buildSampleSelectQuery(context, candidates) {
  if (!context || typeof context.table !== "string" || !isPortableIdentifier(context.table)
    || RESERVED_TABLE_IDENTIFIERS.has(context.table)) return null;
  const safeCandidates = candidates
    .filter((candidate) => candidate && typeof candidate.name === "string" && isPortableIdentifier(candidate.name));
  const columns = safeCandidates.map((candidate) => candidate.name);
  if (columns.length === 0) return null;
  const columnList = safeCandidates.map((candidate) => candidate.sampling === "truncate"
    ? `SUBSTR(ss.${candidate.name}, 1, ${DATA_SAMPLE_FIELD_MAX_LENGTH}) AS ${candidate.name}`
    : `ss.${candidate.name}`).join(", ");
  return {
    sql: `SELECT ${columnList} FROM ${context.table} AS ss LIMIT ${DATA_SAMPLE_ROW_LIMIT}`,
    columns,
  };
}

/** @param {unknown} result @param {string[]} selectedColumns @param {Array<{ name: string, kind: "name" | "email" | "mobile" | "text" | "filename" | "numeric" | "temporal", numericKind?: "integer" | "decimal", temporalKind?: "date" | "timestamp", timezoneAware?: boolean, privacy?: "standard" | "restricted", sampling: "direct" | "truncate" }>} candidates */
function summarizeSampleResult(result, selectedColumns, candidates) {
  if (!isRecord(result) || !Array.isArray(result.columns) || !Array.isArray(result.rows)) return METADATA_ONLY_SAMPLE_RESULT;
  const rows = result.rows.slice(0, DATA_SAMPLE_ROW_LIMIT).filter(Array.isArray);
  const columnIndexes = new Map();
  for (const [index, column] of result.columns.slice(0, selectedColumns.length).entries()) {
    if (isRecord(column) && typeof column.name === "string") columnIndexes.set(column.name, index);
  }

  const evidence = [];
  let sampleUsed = false;
  for (const candidate of candidates) {
    if (!selectedColumns.includes(candidate.name)) continue;
    const index = columnIndexes.get(candidate.name);
    if (!Number.isSafeInteger(index)) continue;
    const rawValues = rows.map((row) => row[index]);
    if (candidate.kind === "temporal") {
      const profile = candidate.privacy === "restricted"
        ? summarizeTemporalShapeProfile(candidate, rawValues)
        : summarizeTemporalProfile(candidate, rawValues);
      if (profile) {
        sampleUsed = true;
        evidence.push(profile);
      }
      continue;
    }
    if (candidate.kind === "numeric") {
      const present = rawValues.filter((value) => value !== null && value !== undefined && value !== "");
      const values = present.map((value) => parseNumericValue(value, candidate.numericKind));
      if (values.some((value) => value === null)) continue;
      if (values.length > 0) sampleUsed = true;
      if (values.length < NUMERIC_PATTERN_MIN_SAMPLES || looksLikeOrderedUniqueNumeric(values)) continue;
      const ordered = [...values].sort(compareNumericValues);
      evidence.push({
        column: candidate.name,
        kind: "numeric_range",
        sampleCount: values.length,
        min: ordered[0],
        max: ordered.at(-1),
        zeroCount: values.filter((value) => compareNumericValues(value, 0) === 0).length,
      });
      continue;
    }

    const values = rawValues
      .filter((value) => typeof value === "string" && value.length <= DATA_SAMPLE_FIELD_MAX_LENGTH && value.trim() !== "")
      .map((value) => value.trim());
    if (values.length > 0) sampleUsed = true;
    if (["name", "email", "mobile"].includes(candidate.kind)) {
      const matchedCount = values.filter((value) => matchesSemanticPattern(candidate.kind, value)).length;
      if (values.length >= NAME_PATTERN_MIN_SAMPLES) {
        const matchedRatio = matchedCount / values.length;
        const patternKind = candidate.kind === "name" ? "chinese_name_pattern" : `${candidate.kind}_pattern`;
        const kind = matchedRatio >= NAME_PATTERN_MIN_RATIO ? patternKind
          : matchedRatio <= PATTERN_NEGATIVE_MAX_RATIO ? `${patternKind}_rejected` : null;
        if (kind) evidence.push({ column: candidate.name, kind, sampleCount: values.length, matchedCount });
      }
      continue;
    }
    if (candidate.kind === "filename") {
      const profile = summarizeFilenameProfile(candidate.name, values);
      if (profile) evidence.push(profile);
      continue;
    }
    const profile = summarizeCategoricalProfile(candidate.name, values);
    if (profile) evidence.push(profile);
  }
  return { sampleUsed, evidence };
}

function summarizeTemporalShapeProfile(candidate, rawValues) {
  if (rawValues.length < TEMPORAL_PROFILE_MIN_ROWS || rawValues.some((value) => value === undefined)) return null;
  const nullCount = rawValues.filter((value) => value === null).length;
  const nonNullValues = rawValues.filter((value) => value !== null);
  const timezoneAware = candidate.temporalKind === "timestamp" && candidate.timezoneAware === true;
  const parsedValues = nonNullValues.map((value) => {
    if (typeof value !== "string") return null;
    if (candidate.temporalKind === "date") return parseDate(value) === null ? null : { precision: 0 };
    const parsed = parseTimestamp(value, { timezoneAware });
    return parsed ? { precision: parsed.precision } : null;
  });
  const allNonNullValuesValid = parsedValues.every((value) => value !== null);
  const precision = allNonNullValuesValid && parsedValues.length > 0
    ? parsedValues.reduce((maximum, value) => Math.max(maximum, value.precision), 0)
    : null;
  return {
    column: candidate.name,
    kind: "temporal_shape",
    temporalKind: candidate.temporalKind,
    sampleCount: rawValues.length,
    nullCount,
    nullRate: nullCount / rawValues.length,
    observedCount: parsedValues.filter((value) => value !== null).length,
    precision,
    timezoneAware,
  };
}

function temporalSamplePrivacy(columnName) {
  return isSensitiveSampleColumn(columnName) ? "restricted" : "standard";
}

function summarizeTemporalProfile(candidate, rawValues) {
  if (rawValues.length < TEMPORAL_PROFILE_MIN_ROWS || rawValues.some((value) => value === undefined)) return null;
  const nullCount = rawValues.filter((value) => value === null).length;
  const nonNullValues = rawValues.filter((value) => value !== null);
  const timezoneAware = candidate.temporalKind === "timestamp" && candidate.timezoneAware === true;
  const parsedValues = nonNullValues.map((value) => {
    if (typeof value !== "string") return null;
    if (candidate.temporalKind === "date") {
      const milliseconds = parseDate(value);
      return milliseconds === null ? null : { order: BigInt(milliseconds) * 1_000_000n, value: milliseconds, precision: 0 };
    }
    const parsed = parseTimestamp(value, { timezoneAware });
    return parsed ? { order: parsed.nanoseconds, value: parsed.nanoseconds, precision: parsed.precision } : null;
  });
  const allNonNullValuesValid = parsedValues.every((value) => value !== null);
  const ordered = allNonNullValuesValid ? [...parsedValues].sort((left, right) => left.order < right.order ? -1 : left.order > right.order ? 1 : 0) : [];
  const precision = allNonNullValuesValid && parsedValues.length > 0
    ? parsedValues.reduce((maximum, value) => Math.max(maximum, value.precision), 0)
    : null;
  const observedMin = ordered.length === 0 ? null : candidate.temporalKind === "date"
    ? formatDate(ordered[0].value)
    : formatTimestamp(ordered[0].value, ordered[0].precision, timezoneAware);
  const observedMax = ordered.length === 0 ? null : candidate.temporalKind === "date"
    ? formatDate(ordered.at(-1).value)
    : formatTimestamp(ordered.at(-1).value, ordered.at(-1).precision, timezoneAware);
  return {
    column: candidate.name,
    kind: "temporal_range",
    temporalKind: candidate.temporalKind,
    sampleCount: rawValues.length,
    nullCount,
    nullRate: nullCount / rawValues.length,
    observedCount: parsedValues.filter((value) => value !== null).length,
    observedMin,
    observedMax,
    precision,
    timezoneAware,
  };
}

function summarizeCategoricalProfile(column, values) {
  const counts = new Map();
  for (const value of values) {
    const normalized = value.toLocaleLowerCase("en-US");
    const entry = counts.get(normalized) ?? { value, frequency: 0 };
    entry.frequency += 1;
    counts.set(normalized, entry);
  }
  const distinctCount = counts.size;
  if (values.length < ENUM_PATTERN_MIN_SAMPLES || distinctCount < 2
    || distinctCount > ENUM_PATTERN_MAX_DISTINCT || distinctCount >= values.length
    || distinctCount / values.length > ENUM_PATTERN_MAX_DISTINCT_RATIO) return null;

  const evidence = { column, kind: "enum_like", sampleCount: values.length, distinctCount };
  if (isSafeCategoricalSampleColumn(column) && [...counts.values()].every(({ value }) => isSafeCategoricalValue(value))) {
    evidence.candidates = [...counts.values()];
  }
  return evidence;
}

function summarizeFilenameProfile(column, values) {
  if (values.length < FILENAME_PATTERN_MIN_SAMPLES) return null;
  const matches = values.map((value) => /\.([a-z0-9]{1,8})$/iu.exec(value)?.[1]?.toLowerCase() ?? null);
  const suffixMatches = matches.filter((suffix) => suffix !== null);
  if (suffixMatches.length < FILENAME_PATTERN_MIN_SAMPLES
    || suffixMatches.length / values.length < FILENAME_PATTERN_MIN_RATIO) return null;
  const frequencies = new Map();
  for (const suffix of suffixMatches) frequencies.set(suffix, (frequencies.get(suffix) ?? 0) + 1);
  if (frequencies.size > 8 || frequencies.size >= suffixMatches.length) return null;
  return {
    column,
    kind: "filename_pattern",
    sampleCount: values.length,
    matchedCount: suffixMatches.length,
    suffixes: [...frequencies].map(([suffix, frequency]) => ({ suffix: `.${suffix}`, frequency })),
  };
}

function parseNumericValue(value, numericKind) {
  if (numericKind === "integer") {
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== "string" || !/^[+-]?\d+$/u.test(value.trim())) return null;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : null;
  }
  if (numericKind !== "decimal") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || String(value).includes("e")) return null;
    if (!Number.isSafeInteger(value) && String(value).replace(/\D/gu, "").replace(/^0+/u, "").length > 15) return null;
    value = String(value);
  }
  if (typeof value !== "string" || value.length > 128) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(value.trim());
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/u, "");
  const fraction = (match[3] ?? "").replace(/0+$/u, "");
  if (/^0+$/u.test(integer) && fraction === "") return "0";
  return `${match[1] === "-" ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function looksLikeOrderedUniqueNumeric(values) {
  if (values.length < NUMERIC_PATTERN_MIN_SAMPLES || new Set(values.map(String)).size !== values.length) return false;
  let ascending = true;
  let descending = true;
  for (let index = 1; index < values.length; index += 1) {
    const comparison = compareNumericValues(values[index - 1], values[index]);
    if (comparison >= 0) ascending = false;
    if (comparison <= 0) descending = false;
  }
  return ascending || descending;
}

function compareNumericValues(left, right) {
  const leftParts = numericParts(left);
  const rightParts = numericParts(right);
  if (!leftParts || !rightParts) throw new TypeError("Sample numeric values must be finite plain decimals");
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftUnits = BigInt(`${leftParts.sign}${leftParts.integer}${leftParts.fraction.padEnd(scale, "0")}`);
  const rightUnits = BigInt(`${rightParts.sign}${rightParts.integer}${rightParts.fraction.padEnd(scale, "0")}`);
  if (leftUnits < rightUnits) return -1;
  if (leftUnits > rightUnits) return 1;
  return 0;
}

function numericParts(value) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(String(value));
  if (!match) return null;
  return {
    sign: match[1] === "-" ? "-" : "",
    integer: match[2],
    fraction: match[3] ?? "",
  };
}

function hasDatabaseIdentity(column) {
  if (column.identity?.state !== "known") return false;
  const value = column.identity.value;
  return value !== false && value !== 0 && value !== "" && value !== "false" && value !== "no";
}

function matchesSemanticPattern(kind, value) {
  const normalized = value.trim();
  if (kind === "name") return /^\p{Script=Han}{2,4}$/u.test(normalized);
  if (kind === "email") return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(normalized);
  if (kind === "mobile") return /^(?:\+?86)?1[3-9]\d{9}$/u.test(normalized.replace(/[\s()-]/gu, ""));
  return false;
}

/** @param {string} name */
function isPortableIdentifier(name) {
  return PORTABLE_IDENTIFIER.test(name);
}

/** @param {Promise<unknown>} promise @param {number} timeoutMs */
function withDeadline(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("sample_timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
