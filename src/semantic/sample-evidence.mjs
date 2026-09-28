import { EVIDENCE_KINDS, createEvidence } from "./evidence.mjs";

export const SAMPLE_EVIDENCE_MAX_ROWS = 8;
export const NAME_PATTERN_MIN_SAMPLES = 3;
export const NAME_PATTERN_MIN_RATIO = 0.8;
export const PATTERN_NEGATIVE_MAX_RATIO = 0.2;
export const ENUM_PATTERN_MIN_SAMPLES = 4;
export const ENUM_PATTERN_MAX_DISTINCT = 4;
export const ENUM_PATTERN_MAX_DISTINCT_RATIO = 0.6;
const SAMPLE_PATTERN_SEMANTICS = new Map([
  ["chinese_name_pattern", "name"],
  ["chinese_name_pattern_rejected", "name"],
  ["email_pattern", "email"],
  ["email_pattern_rejected", "email"],
  ["mobile_pattern", "mobile"],
  ["mobile_pattern_rejected", "mobile"],
]);
const SAMPLE_EVIDENCE_KINDS = new Set([...SAMPLE_PATTERN_SEMANTICS.keys(), "enum_like"]);

/**
 * Accept only small, value-free summaries produced by the UI-side sample probe.
 * Unknown fields and raw values are discarded at the Core RPC boundary.
 * @param {unknown} input
 * @param {Set<string>} knownColumns
 * @returns {Map<string, { kind: string, sampleCount: number, matchedCount?: number, distinctCount?: number }>}
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
    if (!Number.isSafeInteger(entry.distinctCount) || entry.distinctCount < 2
      || entry.distinctCount > ENUM_PATTERN_MAX_DISTINCT || entry.distinctCount > entry.sampleCount
      || entry.sampleCount < ENUM_PATTERN_MIN_SAMPLES || entry.distinctCount / entry.sampleCount > ENUM_PATTERN_MAX_DISTINCT_RATIO) continue;
    normalized.set(entry.column, Object.freeze({
      kind: entry.kind,
      sampleCount: entry.sampleCount,
      distinctCount: entry.distinctCount,
    }));
  }
  return normalized;
}

/** @param {unknown} input @param {Set<string>} knownColumns */
export function sanitizeSampleEvidence(input, knownColumns) {
  return [...normalizeSampleEvidence(input, knownColumns)].map(([column, summary]) => ({ column, ...summary }));
}

/** @param {{ kind: string, sampleCount: number, matchedCount?: number, distinctCount?: number }} summary @param {string} columnName */
export function sampleEvidenceToCoreEvidence(summary, columnName) {
  if (SAMPLE_PATTERN_SEMANTICS.has(summary.kind)) {
    const isNegative = summary.kind.endsWith("_rejected");
    const patternKind = isNegative ? summary.kind.slice(0, -"_rejected".length) : summary.kind;
    const semantic = SAMPLE_PATTERN_SEMANTICS.get(summary.kind);
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
      explanation: "A small, repeated set of textual categories supports an enum-like generation recommendation",
      params: {
        column: columnName,
        sampleCount: summary.sampleCount,
        distinctCount: summary.distinctCount,
      },
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
