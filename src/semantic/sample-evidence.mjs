import { parseDate, parseTimestamp } from "../schema/temporal-values.mjs";
import { EVIDENCE_KINDS, createEvidence } from "./evidence.mjs";

export const SAMPLE_EVIDENCE_MAX_ROWS = 8;
export const TEMPORAL_PROFILE_MIN_ROWS = 3;
export const NAME_PATTERN_MIN_SAMPLES = 3;
export const NAME_PATTERN_MIN_RATIO = 0.8;
export const PATTERN_NEGATIVE_MAX_RATIO = 0.2;
export const ENUM_PATTERN_MIN_SAMPLES = 4;
export const ENUM_PATTERN_MAX_DISTINCT = 6;
export const ENUM_PATTERN_MAX_DISTINCT_RATIO = 0.9;
export const NUMERIC_PATTERN_MIN_SAMPLES = 3;
export const FILENAME_PATTERN_MIN_SAMPLES = 3;
export const FILENAME_PATTERN_MIN_RATIO = 0.8;
export const SAMPLE_CATEGORY_MAX_LENGTH = 24;
export const SAMPLE_SUFFIX_MAX_COUNT = 8;

const SAMPLE_PATTERN_SEMANTICS = new Map([
  ["chinese_name_pattern", "name"],
  ["chinese_name_pattern_rejected", "name"],
  ["email_pattern", "email"],
  ["email_pattern_rejected", "email"],
  ["mobile_pattern", "mobile"],
  ["mobile_pattern_rejected", "mobile"],
]);
const SAMPLE_EVIDENCE_KINDS = new Set([
  ...SAMPLE_PATTERN_SEMANTICS.keys(),
  "enum_like",
  "numeric_range",
  "temporal_range",
  "temporal_shape",
  "filename_pattern",
]);
const SENSITIVE_COLUMN_TOKENS = new Set([
  "account", "acct", "address", "addr", "age", "amount", "auth", "balance", "bank", "birth", "birthday", "card",
  "code", "commission", "coordinate", "coordinates", "cost", "credential", "credit", "customer", "cust", "discount", "email", "fee",
  "geolocation", "gps", "guid", "hash", "iban", "id", "identifier", "identity", "income", "ip", "key", "lat", "latitude",
  "location", "longitude", "lng", "mail", "mobile", "name", "national", "number", "order", "passport", "pass", "password",
  "payment", "phone", "price", "privilege", "profit", "ref", "reference", "revenue", "role", "salary", "secret", "sequence", "seq", "serial", "ssn", "tax", "telephone",
  "token", "transaction", "login", "user", "username", "uuid", "收入", "金额", "成本", "费用", "价格", "折扣", "利润", "佣金", "支付", "坐标", "位置", "经度", "纬度", "姓名", "地址", "密码", "手机号", "电话", "邮箱", "身份证",
]);
const FREE_TEXT_COLUMN_TOKENS = new Set([
  "body", "comment", "content", "description", "detail", "message", "note", "notes", "payload",
  "query", "remark", "sql", "statement", "text",
]);
const SENSITIVE_CATEGORICAL_LABELS = new Set([
  "account", "admin", "address", "bank", "card", "credential", "customer", "email", "identity", "key", "mobile",
  "password", "person", "phone", "private", "root", "secret", "ssn", "token", "user",
]);

/**
 * Value-minimized profile contract crossing the Probe/Core boundary. Enum
 * labels are optional and appear only when every candidate passes privacy
 * guards; numeric decimal bounds remain exact strings where needed; filenames
 * retain suffixes only.
 * @typedef {{ kind: "enum_like", sampleCount: number, distinctCount: number, candidates?: Array<{ value: string, frequency: number }> }
 * | { kind: "numeric_range", sampleCount: number, min: number | string, max: number | string, zeroCount: number }
 * | { kind: "temporal_range", temporalKind: "date" | "timestamp", sampleCount: number, nullCount: number, nullRate: number, observedCount: number, observedMin: string | null, observedMax: string | null, precision: number | null, timezoneAware: boolean }
 * | { kind: "temporal_shape", temporalKind: "date" | "timestamp", sampleCount: number, nullCount: number, nullRate: number, observedCount: number, precision: number | null, timezoneAware: boolean }
 * | { kind: "filename_pattern", sampleCount: number, matchedCount: number, suffixes: Array<{ suffix: string, frequency: number }> }
 * | { kind: "chinese_name_pattern" | "chinese_name_pattern_rejected" | "email_pattern" | "email_pattern_rejected" | "mobile_pattern" | "mobile_pattern_rejected", sampleCount: number, matchedCount: number }} SampleProfile
 */
/**
 * Accept only bounded, value-safe sample profiles. Categorical candidate labels
 * are the one deliberate exception to value-free evidence: they must be short,
 * lowercase ASCII labels, come from a repeated low-cardinality sample, and belong
 * to a column that is not classified as sensitive or identifier-like. Raw rows,
 * free text, and sensitive values are never retained.
 * @param {unknown} input
 * @param {Set<string>} knownColumns
 * @returns {Map<string, Record<string, unknown>>}
 */
export function normalizeSampleEvidence(input, knownColumns) {
  const normalized = new Map();
  if (!Array.isArray(input)) return normalized;
  for (const entry of input) {
    if (!isRecord(entry) || typeof entry.column !== "string" || !knownColumns.has(entry.column)
      || !SAMPLE_EVIDENCE_KINDS.has(entry.kind)
      || !Number.isSafeInteger(entry.sampleCount) || entry.sampleCount < 1 || entry.sampleCount > SAMPLE_EVIDENCE_MAX_ROWS) continue;

    if (SAMPLE_PATTERN_SEMANTICS.has(entry.kind)) {
      const isNegative = entry.kind.endsWith("_rejected");
      if (!Number.isSafeInteger(entry.matchedCount) || entry.matchedCount < 0
        || entry.matchedCount > entry.sampleCount || entry.sampleCount < NAME_PATTERN_MIN_SAMPLES) continue;
      const matchedRatio = entry.matchedCount / entry.sampleCount;
      if (isNegative ? matchedRatio > PATTERN_NEGATIVE_MAX_RATIO
        : entry.matchedCount === 0 || matchedRatio < NAME_PATTERN_MIN_RATIO) continue;
      normalized.set(entry.column, Object.freeze({
        kind: entry.kind,
        sampleCount: entry.sampleCount,
        matchedCount: entry.matchedCount,
      }));
      continue;
    }

    if (entry.kind === "enum_like") {
      if (!isSafeProfileColumn(entry.column, "categorical")
        || !Number.isSafeInteger(entry.distinctCount) || entry.distinctCount < 2
        || entry.distinctCount > ENUM_PATTERN_MAX_DISTINCT || entry.distinctCount >= entry.sampleCount
        || entry.sampleCount < ENUM_PATTERN_MIN_SAMPLES
        || entry.distinctCount / entry.sampleCount > ENUM_PATTERN_MAX_DISTINCT_RATIO) continue;
      const summary = { kind: entry.kind, sampleCount: entry.sampleCount, distinctCount: entry.distinctCount };
      const candidates = normalizeCategoricalCandidates(entry, summary);
      if (candidates) summary.candidates = Object.freeze(candidates);
      normalized.set(entry.column, Object.freeze(summary));
      continue;
    }

    if (entry.kind === "numeric_range") {
      if (!isSafeProfileColumn(entry.column, "numeric")
        || entry.sampleCount < NUMERIC_PATTERN_MIN_SAMPLES
        || !isSampleNumericValue(entry.min) || !isSampleNumericValue(entry.max) || compareSampleNumbers(entry.min, entry.max) > 0
        || !Number.isSafeInteger(entry.zeroCount) || entry.zeroCount < 0 || entry.zeroCount > entry.sampleCount
        || (entry.zeroCount > 0 && (compareSampleNumbers(entry.min, 0) > 0 || compareSampleNumbers(entry.max, 0) < 0))
        || (entry.zeroCount === 0 && (compareSampleNumbers(entry.min, 0) === 0 || compareSampleNumbers(entry.max, 0) === 0))
        || (entry.zeroCount === entry.sampleCount && (compareSampleNumbers(entry.min, 0) !== 0 || compareSampleNumbers(entry.max, 0) !== 0))
        || (entry.zeroCount < entry.sampleCount && compareSampleNumbers(entry.min, entry.max) === 0
          && compareSampleNumbers(entry.min, 0) === 0)) continue;
      normalized.set(entry.column, Object.freeze({
        kind: entry.kind,
        sampleCount: entry.sampleCount,
        min: entry.min,
        max: entry.max,
        zeroCount: entry.zeroCount,
      }));
      continue;
    }

    if (entry.kind === "temporal_range") {
      const temporal = normalizeTemporalProfile(entry);
      if (temporal && isSafeProfileColumn(entry.column, "temporal")) normalized.set(entry.column, Object.freeze(temporal));
      continue;
    }

    if (entry.kind === "temporal_shape") {
      const temporal = normalizeTemporalShapeProfile(entry);
      if (temporal && isRestrictedTemporalProfileColumn(entry.column)) normalized.set(entry.column, Object.freeze(temporal));
      continue;
    }

    if (entry.kind === "filename_pattern") {
      const matchedCount = entry.matchedCount;
      if (!isSafeProfileColumn(entry.column, "filename")
        || entry.sampleCount < FILENAME_PATTERN_MIN_SAMPLES
        || !Number.isSafeInteger(matchedCount) || matchedCount < FILENAME_PATTERN_MIN_SAMPLES
        || matchedCount > entry.sampleCount || matchedCount / entry.sampleCount < FILENAME_PATTERN_MIN_RATIO) continue;
      const suffixes = normalizeSuffixes(entry.suffixes, matchedCount);
      if (!suffixes) continue;
      normalized.set(entry.column, Object.freeze({
        kind: entry.kind,
        sampleCount: entry.sampleCount,
        matchedCount,
        suffixes: Object.freeze(suffixes),
      }));
    }
  }
  return normalized;
}

function normalizeTemporalShapeProfile(entry) {
  const { temporalKind, sampleCount, nullCount, nullRate, observedCount, precision, timezoneAware } = entry;
  if (sampleCount < TEMPORAL_PROFILE_MIN_ROWS
    || !Number.isSafeInteger(nullCount) || nullCount < 0 || nullCount > sampleCount
    || typeof nullRate !== "number" || !Number.isFinite(nullRate) || nullRate !== nullCount / sampleCount
    || !Number.isSafeInteger(observedCount) || observedCount < 0 || observedCount > sampleCount - nullCount
    || (precision !== null && (!Number.isSafeInteger(precision) || precision < 0 || precision > 9))
    || (precision !== null && observedCount === 0)
    || typeof timezoneAware !== "boolean"
    || (temporalKind !== "date" && temporalKind !== "timestamp")
    || (temporalKind === "date" && (timezoneAware || (precision !== null && precision !== 0)))) return null;

  return {
    kind: "temporal_shape",
    temporalKind,
    sampleCount,
    nullCount,
    nullRate,
    observedCount,
    precision,
    timezoneAware,
  };
}

function normalizeTemporalProfile(entry) {
  const {
    temporalKind, sampleCount, nullCount, nullRate, observedCount,
    observedMin, observedMax, precision, timezoneAware,
  } = entry;
  if (sampleCount < TEMPORAL_PROFILE_MIN_ROWS
    || !Number.isSafeInteger(nullCount) || nullCount < 0 || nullCount > sampleCount
    || typeof nullRate !== "number" || !Number.isFinite(nullRate) || nullRate !== nullCount / sampleCount
    || !Number.isSafeInteger(observedCount) || observedCount < 0 || observedCount > sampleCount - nullCount
    || (precision !== null && (!Number.isSafeInteger(precision) || precision < 0 || precision > 9))
    || typeof timezoneAware !== "boolean"
    || (temporalKind !== "date" && temporalKind !== "timestamp")
    || [observedMin, observedMax].some((value) => value !== null && (typeof value !== "string" || value.length > 40))) return null;

  const hasRange = typeof observedMin === "string" && typeof observedMax === "string";
  if (!hasRange && (observedMin !== null || observedMax !== null
    || (observedCount > 0 && observedCount === sampleCount - nullCount))) return null;
  if (hasRange && observedCount !== sampleCount - nullCount) return null;
  if (temporalKind === "date") {
    if (timezoneAware || (hasRange && precision !== 0) || (precision !== null && precision !== 0)) return null;
    const min = hasRange ? parseDate(observedMin) : null;
    const max = hasRange ? parseDate(observedMax) : null;
    if (hasRange && (min === null || max === null || min > max)) return null;
  } else {
    const min = hasRange ? parseTimestamp(observedMin, { timezoneAware }) : null;
    const max = hasRange ? parseTimestamp(observedMax, { timezoneAware }) : null;
    if (hasRange && (!min || !max || !Number.isSafeInteger(precision) || min.nanoseconds > max.nanoseconds
      || min.precision > precision || max.precision > precision)) return null;
  }
  return {
    kind: "temporal_range",
    temporalKind,
    sampleCount,
    nullCount,
    nullRate,
    observedCount,
    observedMin,
    observedMax,
    precision,
    timezoneAware,
  };
}

function normalizeCategoricalCandidates(entry, summary) {
  if (!Array.isArray(entry.candidates) || !isSafeProfileColumn(entry.column, "categorical")
    || entry.candidates.length !== summary.distinctCount) return null;
  const seen = new Set();
  const candidates = [];
  let frequencyTotal = 0;
  for (const candidate of entry.candidates) {
    if (!isRecord(candidate) || !isSafeCategoricalValue(candidate.value)
      || !Number.isSafeInteger(candidate.frequency) || candidate.frequency < 1) return null;
    const normalized = candidate.value.toLowerCase();
    if (seen.has(normalized)) return null;
    seen.add(normalized);
    frequencyTotal += candidate.frequency;
    candidates.push(Object.freeze({ value: candidate.value, frequency: candidate.frequency }));
  }
  return frequencyTotal === entry.sampleCount ? candidates : null;
}

function isSampleNumericValue(value) {
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  if (typeof value !== "number" && (typeof value !== "string" || value.length > 128)) return false;
  return sampleNumericParts(value) !== null;
}

function compareSampleNumbers(left, right) {
  const leftParts = sampleNumericParts(left);
  const rightParts = sampleNumericParts(right);
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftUnits = BigInt(`${leftParts.sign}${leftParts.integer}${leftParts.fraction.padEnd(scale, "0")}`);
  const rightUnits = BigInt(`${rightParts.sign}${rightParts.integer}${rightParts.fraction.padEnd(scale, "0")}`);
  if (leftUnits < rightUnits) return -1;
  if (leftUnits > rightUnits) return 1;
  return 0;
}

function sampleNumericParts(value) {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(String(value));
  if (!match) return null;
  return {
    sign: match[1] === "-" ? "-" : "",
    integer: match[2],
    fraction: match[3] ?? "",
  };
}

function normalizeSuffixes(input, matchedCount) {
  if (!Array.isArray(input) || input.length < 1 || input.length > SAMPLE_SUFFIX_MAX_COUNT) return null;
  const seen = new Set();
  const suffixes = [];
  let frequencyTotal = 0;
  for (const entry of input) {
    if (!isRecord(entry) || typeof entry.suffix !== "string"
      || !/^\.[a-z0-9]{1,8}$/u.test(entry.suffix)
      || !Number.isSafeInteger(entry.frequency) || entry.frequency < 1 || seen.has(entry.suffix)) return null;
    seen.add(entry.suffix);
    frequencyTotal += entry.frequency;
    suffixes.push(Object.freeze({ suffix: entry.suffix, frequency: entry.frequency }));
  }
  return frequencyTotal === matchedCount ? suffixes : null;
}

/** @param {unknown} value */
export function isSafeCategoricalValue(value) {
  return typeof value === "string" && value.length <= SAMPLE_CATEGORY_MAX_LENGTH
    && value === value.trim() && /^[a-z][a-z_-]*$/u.test(value)
    && !value.split(/[_-]/u).some((token) => SENSITIVE_CATEGORICAL_LABELS.has(token));
}

/** @param {string} columnName */
export function isFilenameColumnName(columnName) {
  const tokens = normalizeNameTokens(columnName);
  const fileLike = tokens.includes("file") || tokens.includes("filename") || tokens.includes("filepath") || tokens.includes("path");
  return fileLike && !tokens.some((token) => token !== "name" && SENSITIVE_COLUMN_TOKENS.has(token));
}

/** @param {string} columnName */
export function isSensitiveSampleColumn(columnName) {
  if (/[\p{Script=Han}]/u.test(columnName)
    && /姓名|地址|密码|手机|电话|邮箱|身份证|账户|银行卡|令牌|编号|序号|流水号|业务号|订单号|主键|唯一标识|金额|成本|费用|价格|折扣|收入|利润|佣金|支付|坐标|位置|经度|纬度/u.test(columnName)) return true;
  return normalizeNameTokens(columnName).some((token) => SENSITIVE_COLUMN_TOKENS.has(token));
}

export function isSafeCategoricalSampleColumn(columnName) {
  return isSafeProfileColumn(columnName, "categorical");
}

/** @param {string} columnName */
export function isFreeTextSampleColumn(columnName) {
  return normalizeNameTokens(columnName).some((token) => FREE_TEXT_COLUMN_TOKENS.has(token));
}

function isSafeProfileColumn(columnName, kind) {
  if (kind === "filename") return isFilenameColumnName(columnName);
  if (isFilenameColumnName(columnName) || isSensitiveSampleColumn(columnName)) return false;
  return !normalizeNameTokens(columnName).some((token) => FREE_TEXT_COLUMN_TOKENS.has(token));
}

function isRestrictedTemporalProfileColumn(columnName) {
  return isSensitiveSampleColumn(columnName)
    && !isFilenameColumnName(columnName)
    && !isFreeTextSampleColumn(columnName);
}

/** @param {string} name */
function normalizeNameTokens(name) {
  return String(name)
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1_$2")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .split("_")
    .filter(Boolean);
}

/** @param {unknown} input @param {Set<string>} knownColumns */
export function sanitizeSampleEvidence(input, knownColumns) {
  return [...normalizeSampleEvidence(input, knownColumns)].map(([column, summary]) => ({ column, ...summary }));
}

/** @param {Record<string, unknown>} summary @param {string} columnName */
export function sampleEvidenceToCoreEvidence(summary, columnName) {
  if (SAMPLE_PATTERN_SEMANTICS.has(String(summary.kind))) {
    const isNegative = String(summary.kind).endsWith("_rejected");
    const patternKind = isNegative ? String(summary.kind).slice(0, -"_rejected".length) : String(summary.kind);
    const semantic = SAMPLE_PATTERN_SEMANTICS.get(String(summary.kind));
    return createEvidence({
      kind: samplePatternEvidenceKind(patternKind, isNegative),
      source: "sample_pattern",
      observation: `${summary.matchedCount}/${summary.sampleCount} non-null samples matched the ${patternKind.replaceAll("_", " ")}`,
      explanation: isNegative
        ? `A small sample strongly conflicts with the ${semantic} pattern; weak column-name candidates are rejected while exact aliases are retained at lower confidence`
        : `A consistent ${patternKind.replaceAll("_", " ")} in a small sample supports the existing semantic candidate`,
      params: {
        column: columnName,
        semantic,
        sampleCount: summary.sampleCount,
        matchedCount: summary.matchedCount,
      },
    });
  }
  if (summary.kind === "enum_like") {
    return createEvidence({
      kind: EVIDENCE_KINDS.sampleEnumLike,
      source: "sample_pattern",
      observation: `${summary.sampleCount} non-null samples formed ${summary.distinctCount} distinct categories`,
      explanation: "A small, repeated set of short textual labels supports categorical generation",
      params: {
        column: columnName,
        sampleCount: summary.sampleCount,
        distinctCount: summary.distinctCount,
      },
    });
  }
  if (summary.kind === "numeric_range") {
    return createEvidence({
      kind: EVIDENCE_KINDS.sampleNumericRange,
      source: "sample_profile",
      observation: `Observed numeric range ${summary.min} to ${summary.max}; zero appeared ${summary.zeroCount}/${summary.sampleCount} times`,
      explanation: "A bounded numeric profile constrains synthetic values to the observed scale without retaining individual sample values",
      params: { column: columnName, sampleCount: summary.sampleCount, min: summary.min, max: summary.max, zeroCount: summary.zeroCount },
    });
  }
  if (summary.kind === "temporal_shape") {
    const precision = Number.isSafeInteger(summary.precision) ? `${summary.precision}` : "unknown";
    return createEvidence({
      kind: EVIDENCE_KINDS.sampleTemporalShape,
      source: "sample_profile",
      observation: `Sensitive temporal profile: precision ${precision}; NULL appeared ${summary.nullCount}/${summary.sampleCount} samples`,
      explanation: "A restricted temporal profile retains only shape and NULL statistics; source values and observed bounds are not carried into GenerationPlan",
      params: {
        column: columnName,
        temporalKind: summary.temporalKind,
        sampleCount: summary.sampleCount,
        nullCount: summary.nullCount,
        nullRate: summary.nullRate,
        observedCount: summary.observedCount,
        precision: summary.precision,
        timezoneAware: summary.timezoneAware,
      },
    });
  }
  if (summary.kind === "temporal_range") {
    const hasRange = typeof summary.observedMin === "string" && typeof summary.observedMax === "string";
    const range = hasRange
      ? `Observed ${summary.temporalKind} range ${summary.observedMin} to ${summary.observedMax}`
      : "No sufficiently parseable non-NULL temporal range was observed";
    return createEvidence({
      kind: EVIDENCE_KINDS.sampleTemporalRange,
      source: "sample_profile",
      observation: `${range}; NULL appeared ${summary.nullCount}/${summary.sampleCount} samples`,
      explanation: "A bounded temporal profile guides generated values while preserving schema timezone semantics and observed nullability",
      params: {
        column: columnName,
        temporalKind: summary.temporalKind,
        sampleCount: summary.sampleCount,
        nullCount: summary.nullCount,
        nullRate: summary.nullRate,
        observedCount: summary.observedCount,
        observedMin: summary.observedMin,
        observedMax: summary.observedMax,
        precision: summary.precision,
        timezoneAware: summary.timezoneAware,
      },
    });
  }
  if (summary.kind === "filename_pattern") {
    const suffixes = Array.isArray(summary.suffixes) ? summary.suffixes.map((item) => item.suffix) : [];
    return createEvidence({
      kind: EVIDENCE_KINDS.sampleFilenamePattern,
      source: "sample_profile",
      observation: `${summary.matchedCount}/${summary.sampleCount} non-null samples matched a filename suffix (${suffixes.join(", ")})`,
      explanation: "Only safe file suffixes are retained; generated names use a synthetic stem rather than source filenames",
      params: { column: columnName, sampleCount: summary.sampleCount, matchedCount: summary.matchedCount, suffixes },
    });
  }
  return null;
}

function samplePatternEvidenceKind(kind, isNegative) {
  const kinds = {
    chinese_name_pattern: [EVIDENCE_KINDS.sampleNamePattern, EVIDENCE_KINDS.sampleNamePatternRejected],
    email_pattern: [EVIDENCE_KINDS.sampleEmailPattern, EVIDENCE_KINDS.sampleEmailPatternRejected],
    mobile_pattern: [EVIDENCE_KINDS.sampleMobilePattern, EVIDENCE_KINDS.sampleMobilePatternRejected],
  };
  return kinds[kind]?.[isNegative ? 1 : 0] ?? null;
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
