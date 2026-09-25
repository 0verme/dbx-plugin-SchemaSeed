import { sha256Hex } from "./sha256.mjs";
import { makeDiagnostic } from "../diagnostics.mjs";
import { interpretColumnType, interpretStringCapacity } from "../schema/schema-interpreter.mjs";
import { checkSemanticCompatibility, SEMANTIC_TYPES } from "../semantic/semantic-inference.mjs";

export const GENERATION_RULE_KINDS = Object.freeze([
  "auto",
  "constant",
  "sequence",
  "random_integer",
  "random_decimal",
  "random_string",
  "enum",
  "boolean_ratio",
  "date_range",
  "timestamp_range",
  "uuid",
  "null_ratio",
  "semantic",
]);

export const GENERATION_RULE_LABELS = Object.freeze({
  auto: "Auto",
  constant: "Constant",
  sequence: "Sequence",
  random_integer: "Random Integer",
  random_decimal: "Random Decimal",
  random_string: "Random String",
  enum: "Enum",
  boolean_ratio: "Boolean Ratio",
  date_range: "Date Range",
  timestamp_range: "Timestamp Range",
  uuid: "UUID",
  null_ratio: "Null Ratio",
  semantic: "Semantic",
});

const RULE_FIELDS = Object.freeze({
  auto: [],
  constant: ["value"],
  sequence: ["start", "step"],
  random_integer: ["min", "max"],
  random_decimal: ["min", "max"],
  random_string: ["length"],
  enum: ["values"],
  boolean_ratio: ["trueRatio"],
  date_range: ["start", "end"],
  timestamp_range: ["start", "end"],
  uuid: [],
  null_ratio: ["ratio"],
  semantic: ["semanticType"],
});

const SEMANTIC_OPTIONS = Object.freeze(SEMANTIC_TYPES.filter((type) => type !== "unknown"));
const DAY_MS = 86_400_000n;

/**
 * SchemaSeed-owned generation budget for string output. It bounds what a
 * generator may emit when the schema does not provide a usable maximum. It is
 * a generation-side budget, not a database maximum, and it must never be
 * written back into schema capacity metadata.
 */
export const DEFAULT_STRING_GENERATION_MAX_LENGTH = 16;

/**
 * Resolve the effective string fallback length. Both the requested rule length
 * and the schema maximum fall back to the generation budget, naming the
 * historical default explicitly instead of embedding a literal.
 * @param {unknown} requestedMaxLength
 * @param {unknown} schemaMaxLength
 */
export function resolveStringGenerationMaxLength(requestedMaxLength, schemaMaxLength) {
  const requested = Number.isSafeInteger(requestedMaxLength) && requestedMaxLength > 0
    ? requestedMaxLength
    : DEFAULT_STRING_GENERATION_MAX_LENGTH;
  const schemaMax = Number.isSafeInteger(schemaMaxLength) && schemaMaxLength > 0
    ? schemaMaxLength
    : DEFAULT_STRING_GENERATION_MAX_LENGTH;
  return Math.min(requested, schemaMax);
}

/**
 * The one authoritative rule availability API. The result is a UI hint; the
 * validator below remains authoritative when a particular config is supplied.
 * @param {import("../schema/schema-model.mjs").ColumnSchema} column
 * @returns {string[]}
 */
export function getCompatibleGenerationRules(column) {
  const rules = ["auto"];
  const type = interpretColumnType(column);
  const family = type?.kind;
  const capacity = family === "varchar" ? type.capacity : null;
  const usableCapacity = capacity !== null && capacity !== undefined
    && capacity.model !== "unknown" && capacity.model !== "invalid";
  const supported = new Set(["integer", "decimal", "varchar", "boolean", "date", "timestamp"]);
  if (family === "varchar" && !varcharBound(column).ok) return rules;
  if (family === "decimal" && !decimalShape(column).ok) return rules;
  if (family === "timestamp" && !timestampPrecision(column).ok) return rules;
  if (family && supported.has(family)) {
    rules.push("constant", "enum");
    if (family === "integer" || family === "decimal") rules.push("sequence");
    if (family === "integer") rules.push("random_integer");
    if (family === "decimal") rules.push("random_decimal");
    if (family === "varchar" && usableCapacity) rules.push("random_string");
    if (family === "boolean") rules.push("boolean_ratio");
    if (family === "date") rules.push("date_range");
    if (family === "timestamp") rules.push("timestamp_range");
    rules.push("null_ratio");
  } else if (isUuidType(column)) {
    rules.push("null_ratio");
  }
  if (isUuidType(column) || (family === "varchar" && usableCapacity
    && (capacity.model === "unbounded" || capacity.maxLength >= 36))) rules.push("uuid");
  if (getCompatibleSemanticTypes(column).length > 0) rules.push("semantic");
  return [...new Set(rules)];
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
export function getCompatibleSemanticTypes(column) {
  const type = interpretColumnType(column);
  if (type?.kind === "varchar" && !varcharBound(column).ok) return [];
  return SEMANTIC_OPTIONS.filter((semanticType) => checkSemanticCompatibility(column, semanticType).compatible === true);
}

function safeDraftDecimalScale(column) {
  const scale = column.scale?.value;
  return column.scale?.state === "known" && Number.isSafeInteger(scale) && scale >= 0 && scale <= 1_000
    ? scale
    : 0;
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column @param {string} kind */
export function createGenerationRuleDraft(column, kind) {
  const type = interpretColumnType(column);
  const family = type?.kind;
  switch (kind) {
    case "auto": return { kind };
    case "constant":
      return { kind, value: family === "integer" ? 0
        : family === "decimal" ? formatDecimalUnits(0n, safeDraftDecimalScale(column))
          : family === "boolean" ? false
            : family === "date" ? "2000-01-01"
              : family === "timestamp" ? "2000-01-01T00:00:00Z" : "" };
    case "sequence": {
      if (family !== "decimal") return { kind, start: 1, step: 1 };
      const scale = safeDraftDecimalScale(column);
      return { kind, start: formatDecimalUnits(0n, scale), step: formatDecimalUnits(1n, scale) };
    }
    case "random_integer": {
      const min = Math.max(0, type?.parameters.schemaMin ?? 0);
      return { kind, min, max: Math.min(type?.parameters.schemaMax ?? 100, min + 100) };
    }
    case "random_decimal": {
      const scale = safeDraftDecimalScale(column);
      const one = 10n ** BigInt(scale);
      const shape = decimalShape(column);
      const schemaMax = shape.ok ? 10n ** BigInt(shape.precision) - 1n : one;
      const max = schemaMax < one ? schemaMax : one;
      return { kind, min: formatDecimalUnits(0n, scale), max: formatDecimalUnits(max, scale) };
    }
    case "random_string": {
      const capacity = family === "varchar" ? type.capacity : null;
      const maximum = capacity?.model === "bounded" ? capacity.maxLength : DEFAULT_STRING_GENERATION_MAX_LENGTH;
      return { kind, length: Math.min(8, maximum) };
    }
    case "enum":
      return { kind, values: [] };
    case "boolean_ratio":
      return { kind, trueRatio: 0.5 };
    case "date_range":
      return { kind, start: "2000-01-01", end: "2030-12-31" };
    case "timestamp_range":
      return { kind, start: "2000-01-01T00:00:00Z", end: "2030-12-31T23:59:59Z" };
    case "uuid":
      return { kind };
    case "null_ratio":
      return { kind, ratio: 0 };
    case "semantic":
      return { kind, semanticType: getCompatibleSemanticTypes(column)[0] ?? "unknown" };
    default:
      return { kind };
  }
}

/** Describe editor controls from the Core model; the UI only renders these fields. @param {import("../schema/schema-model.mjs").ColumnSchema} column @param {Record<string, unknown>} rule */
export function getGenerationRuleEditorFields(column, rule) {
  const fields = [];
  const add = (key, label, editor, value) => fields.push({ key, label, editor, value });
  switch (rule?.kind) {
    case "constant": add("value", "Value (JSON scalar)", "json", rule.value); break;
    case "sequence":
      add("start", "Start", interpretColumnType(column)?.kind === "decimal" ? "decimal" : "integer", rule.start);
      add("step", "Step", interpretColumnType(column)?.kind === "decimal" ? "decimal" : "integer", rule.step);
      break;
    case "random_integer":
    case "random_decimal":
      add("min", "Min", rule.kind === "random_decimal" ? "decimal" : "integer", rule.min);
      add("max", "Max", rule.kind === "random_decimal" ? "decimal" : "integer", rule.max);
      break;
    case "random_string": add("length", "Length", "integer", rule.length); break;
    case "enum": add("values", "Values (JSON array)", "json", rule.values); break;
    case "boolean_ratio": add("trueRatio", "True ratio (0–1)", "ratio", rule.trueRatio); break;
    case "date_range":
    case "timestamp_range":
      add("start", "Start (UTC)", "text", rule.start);
      add("end", "End (UTC)", "text", rule.end);
      break;
    case "null_ratio": add("ratio", "Null ratio (0–1)", "ratio", rule.ratio); break;
    case "semantic": add("semanticType", "Semantic type", "semantic", rule.semanticType); break;
    default: break;
  }
  return fields.map((field) => Object.freeze({ ...field }));
}

/**
 * Validate and canonicalize one tagged GenerationRule. No coercion or fallback
 * occurs: a rejected rule produces a located blocking diagnostic.
 * @param {import("../schema/schema-model.mjs").ColumnSchema} column
 * @param {unknown} rawRule
 * @param {{ tableIdentity?: string, rowCount?: number }} [options]
 * @returns {{ valid: boolean, status: "valid" | "warning" | "blocked", rule: (Record<string, unknown> & { identity: string }) | null, diagnostics: import("../diagnostics.mjs").GenerationDiagnostic[] }}
 */
export function validateGenerationRule(column, rawRule, options = {}) {
  const table = options.tableIdentity ?? "<unknown-table>";
  const rowCount = Number.isSafeInteger(options.rowCount) && options.rowCount >= 0 ? options.rowCount : 1;
  const diagnostics = [];
  const fail = (code, reason, severity = "error") => {
    diagnostics.push(makeDiagnostic({
      severity,
      code,
      table,
      column: column?.name ?? null,
      rule: typeof rawRule?.kind === "string" ? `rule:${rawRule.kind}` : "generation-rule",
      reason,
      blocking: severity !== "warning",
    }));
    return { valid: false, status: "blocked", rule: null, diagnostics };
  };

  if (!isPlainRecord(rawRule) || !GENERATION_RULE_KINDS.includes(rawRule.kind)) {
    return fail("generation_rule_invalid", "Generation rule must be a tagged object with a supported kind");
  }
  const fields = RULE_FIELDS[rawRule.kind];
  const allowed = new Set(["kind", ...fields]);
  const unexpected = Object.keys(rawRule).filter((key) => !allowed.has(key));
  const missing = fields.filter((key) => !Object.hasOwn(rawRule, key));
  if (unexpected.length || missing.length) {
    return fail("generation_rule_invalid", [
      unexpected.length ? `Unsupported field(s): ${unexpected.join(", ")}` : "",
      missing.length ? `Required field(s) missing: ${missing.join(", ")}` : "",
    ].filter(Boolean).join(". "));
  }

  const normalized = { kind: rawRule.kind };
  switch (rawRule.kind) {
    case "auto":
    case "uuid":
      break;
    case "constant":
      normalized.value = rawRule.value;
      break;
    case "sequence":
      normalized.start = rawRule.start;
      normalized.step = rawRule.step;
      break;
    case "random_integer":
      normalized.min = rawRule.min;
      normalized.max = rawRule.max;
      break;
    case "random_decimal":
      normalized.min = rawRule.min;
      normalized.max = rawRule.max;
      break;
    case "random_string":
      normalized.length = rawRule.length;
      break;
    case "enum":
      normalized.values = Array.isArray(rawRule.values) ? [...rawRule.values] : rawRule.values;
      break;
    case "boolean_ratio":
      normalized.trueRatio = rawRule.trueRatio;
      break;
    case "date_range":
    case "timestamp_range":
      normalized.start = rawRule.start;
      normalized.end = rawRule.end;
      break;
    case "null_ratio":
      normalized.ratio = rawRule.ratio;
      break;
    case "semantic":
      normalized.semanticType = rawRule.semanticType;
      break;
    default:
      return fail("generation_rule_invalid", `Unsupported rule kind ${String(rawRule.kind)}`);
  }

  const type = interpretColumnType(column);
  const family = type?.kind;
  const incompatible = (expected) => fail("generation_rule_incompatible",
    `${GENERATION_RULE_LABELS[rawRule.kind]} requires ${expected}; the column schema is ${family ?? column?.dataType?.state ?? "unknown"}`);

  if (normalized.kind === "auto") return validRule(normalized, diagnostics);

  if (normalized.kind === "semantic") {
    if (!SEMANTIC_OPTIONS.includes(normalized.semanticType)) {
      return fail("generation_rule_invalid", `semanticType must be one of ${SEMANTIC_OPTIONS.join(", ")}`);
    }
    const compatibility = checkSemanticCompatibility(column, normalized.semanticType);
    if (compatibility.compatible !== true) return fail("generation_rule_incompatible", compatibility.reason);
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "constant") {
    const result = validateScalarValue(column, normalized.value);
    if (!result.ok) return fail(result.code, result.reason, result.severity);
    normalized.value = result.value;
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "sequence") {
    if (family !== "integer" && family !== "decimal") return incompatible("an integer or decimal schema");
    if (family === "integer") {
      if (!Number.isSafeInteger(normalized.start) || !Number.isSafeInteger(normalized.step)) {
        return fail("generation_rule_invalid", "integer Sequence start and step must be safe integers");
      }
      const end = BigInt(normalized.start) + BigInt(normalized.step) * BigInt(Math.max(0, rowCount - 1));
      const low = BigInt(type.parameters.schemaMin);
      const high = BigInt(type.parameters.schemaMax);
      if (BigInt(normalized.start) < low || BigInt(normalized.start) > high || end < low || end > high) {
        return fail("generation_sequence_overflow", `Sequence values for ${rowCount} rows exceed schema integer bounds [${low}, ${high}]`);
      }
    } else {
      const shape = decimalShape(column);
      if (!shape.ok) return fail(shape.code, shape.reason, shape.severity);
      const start = parseDecimalUnits(normalized.start, shape.scale);
      const step = parseDecimalUnits(normalized.step, shape.scale);
      if (start === null || step === null) {
        return fail("generation_rule_invalid", `decimal Sequence start and step must be exact decimal strings expressible at scale ${shape.scale}`);
      }
      const last = start + step * BigInt(Math.max(0, rowCount - 1));
      const bound = 10n ** BigInt(shape.precision) - 1n;
      if (start < -bound || start > bound || last < -bound || last > bound) {
        return fail("generation_sequence_overflow", `Decimal Sequence values for ${rowCount} rows exceed decimal(${shape.precision},${shape.scale})`);
      }
      normalized.start = formatDecimalUnits(start, shape.scale);
      normalized.step = formatDecimalUnits(step, shape.scale);
    }
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "random_integer") {
    if (family !== "integer") return incompatible("an integer schema");
    if (!Number.isSafeInteger(normalized.min) || !Number.isSafeInteger(normalized.max) || normalized.min > normalized.max) {
      return fail("generation_rule_invalid", "Random Integer min/max must be safe integers with min <= max");
    }
    if (normalized.min < type.parameters.schemaMin || normalized.max > type.parameters.schemaMax) {
      return fail("generation_rule_incompatible", `Integer range [${normalized.min}, ${normalized.max}] exceeds schema bounds [${type.parameters.schemaMin}, ${type.parameters.schemaMax}]`);
    }
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "random_decimal") {
    if (family !== "decimal") return incompatible("a decimal schema");
    const shape = decimalShape(column);
    if (!shape.ok) return fail(shape.code, shape.reason, shape.severity);
    const min = parseDecimalUnits(normalized.min, shape.scale);
    const max = parseDecimalUnits(normalized.max, shape.scale);
    if (min === null || max === null) {
      return fail("generation_rule_invalid", `Random Decimal min/max must be exact decimal strings expressible at scale ${shape.scale}`);
    }
    if (min > max) return fail("generation_rule_invalid", "Random Decimal min must be less than or equal to max");
    const bound = 10n ** BigInt(shape.precision) - 1n;
    if (min < -bound || max > bound) {
      return fail("generation_rule_incompatible", `Decimal range exceeds decimal(${shape.precision},${shape.scale}) representable bounds`);
    }
    normalized.min = formatDecimalUnits(min, shape.scale);
    normalized.max = formatDecimalUnits(max, shape.scale);
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "random_string") {
    if (family !== "varchar") return incompatible("a varchar/string schema");
    if (!Number.isSafeInteger(normalized.length) || normalized.length <= 0) {
      return fail("generation_rule_invalid", "Random String length must be a positive safe integer");
    }
    const bound = varcharBound(column);
    if (!bound.ok) return fail(bound.code, bound.reason, bound.severity);
    if (bound.max !== null && normalized.length > bound.max) {
      return fail("generation_rule_incompatible", `Random String length ${normalized.length} exceeds schema maximum length ${bound.max}`);
    }
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "enum") {
    if (!Array.isArray(normalized.values) || normalized.values.length === 0) {
      return fail("generation_rule_invalid", "Enum values must contain at least one candidate");
    }
    const values = [];
    for (let index = 0; index < normalized.values.length; index += 1) {
      const result = validateScalarValue(column, normalized.values[index]);
      if (!result.ok) return fail("generation_rule_incompatible", `Enum candidate ${index + 1} is invalid: ${result.reason}`, result.severity);
      values.push(result.value);
    }
    if (new Set(values.map((value) => JSON.stringify(value))).size !== values.length) {
      return fail("generation_rule_invalid", "Enum values must be unique; duplicate candidates would act as implicit weights");
    }
    normalized.values = values;
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "boolean_ratio") {
    if (family !== "boolean") return incompatible("a boolean schema");
    if (typeof normalized.trueRatio !== "number" || !Number.isFinite(normalized.trueRatio)
      || normalized.trueRatio < 0 || normalized.trueRatio > 1) {
      return fail("generation_rule_invalid", "Boolean Ratio trueRatio must be a finite number from 0 through 1");
    }
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "date_range") {
    if (family !== "date") return incompatible("a date schema");
    const start = parseDate(normalized.start);
    const end = parseDate(normalized.end);
    if (start === null || end === null) return fail("generation_rule_invalid", "Date Range start/end must be valid YYYY-MM-DD dates");
    if (start > end) return fail("generation_rule_invalid", "Date Range start must be earlier than or equal to end");
    normalized.start = formatDate(start);
    normalized.end = formatDate(end);
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "timestamp_range") {
    if (family !== "timestamp") return incompatible("a timestamp schema");
    const precision = timestampPrecision(column);
    if (!precision.ok) return fail(precision.code, precision.reason, precision.severity);
    const start = parseTimestamp(normalized.start);
    const end = parseTimestamp(normalized.end);
    if (!start || !end) return fail("generation_rule_invalid", "Timestamp Range start/end must be valid UTC ISO timestamps ending in Z");
    if (start.nanoseconds > end.nanoseconds) return fail("generation_rule_invalid", "Timestamp Range start must be earlier than or equal to end");
    if (start.precision > precision.value || end.precision > precision.value) {
      return fail("generation_rule_incompatible", `Timestamp Range fractional digits exceed the schema precision ${precision.value}`);
    }
    const quantum = 10n ** BigInt(9 - precision.value);
    if (start.nanoseconds % quantum !== 0n || end.nanoseconds % quantum !== 0n) {
      return fail("generation_rule_incompatible", `Timestamp Range boundaries must align with schema precision ${precision.value}`);
    }
    normalized.start = formatTimestamp(start.nanoseconds, precision.value);
    normalized.end = formatTimestamp(end.nanoseconds, precision.value);
    if (column.precision?.state !== "known") {
      diagnostics.push(makeDiagnostic({
        severity: "warning",
        code: "timestamp_precision_unknown",
        table,
        column: column.name,
        rule: "rule:timestamp_range",
        reason: "Timestamp precision metadata is unavailable; generation uses millisecond precision without claiming a database precision guarantee",
        blocking: false,
      }));
    }
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "uuid") {
    if (!isUuidType(column) && family !== "varchar") return incompatible("a UUID or varchar/string schema");
    if (family === "varchar") {
      const bound = varcharBound(column);
      if (!bound.ok) return fail(bound.code, bound.reason, bound.severity);
      if (bound.max !== null && bound.max < 36) {
        return fail("generation_rule_incompatible", `UUID representation requires 36 characters; schema maximum is ${bound.max}`);
      }
    }
    return validRule(normalized, diagnostics);
  }

  if (normalized.kind === "null_ratio") {
    if ((!family || !new Set(["integer", "decimal", "varchar", "boolean", "date", "timestamp"]).has(family))
      && !isUuidType(column)) {
      return incompatible("a supported scalar schema");
    }
    if (typeof normalized.ratio !== "number" || !Number.isFinite(normalized.ratio)
      || normalized.ratio < 0 || normalized.ratio > 1) {
      return fail("generation_rule_invalid", "Null Ratio must be a finite number from 0 through 1");
    }
    if (normalized.ratio > 0 && (column.nullable?.state !== "known" || column.nullable.value !== true)) {
      const fact = column.nullable?.state ?? "unknown";
      return fail("nullability_rule_conflict", `Null Ratio ${normalized.ratio} requires nullable=true; schema nullability is ${fact}`);
    }
    return validRule(normalized, diagnostics);
  }

  return fail("generation_rule_invalid", `No validator is registered for rule ${normalized.kind}`);
}

/** @param {Record<string, unknown>} normalized @param {import("../diagnostics.mjs").GenerationDiagnostic[]} diagnostics */
function validRule(normalized, diagnostics) {
  const rule = Object.freeze({
    ...normalized,
    ...(Array.isArray(normalized.values) ? { values: Object.freeze([...normalized.values]) } : {}),
    identity: generationRuleIdentity(normalized),
  });
  return { valid: true, status: diagnostics.some((entry) => entry.severity === "warning") ? "warning" : "valid", rule, diagnostics };
}

/** Stable canonical tagged-rule identity; independent of object insertion order. @param {Record<string, unknown>} rule */
export function generationRuleIdentity(rule) {
  const canonical = canonicalSerialize(rule);
  const digest = sha256Hex(`SchemaSeed.GenerationRule.v1\0${canonical}`);
  return `rule:${String(rule.kind)}:v1:${digest.slice(0, 24)}`;
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column @param {unknown} value */
function validateScalarValue(column, value) {
  const type = interpretColumnType(column);
  if (!type) return failScalar("generation_rule_incompatible", `Schema type is ${column.dataType?.state ?? "unknown"} or unsupported`);
  switch (type.kind) {
    case "integer":
      if (!Number.isSafeInteger(value)) return failScalar("generation_rule_incompatible", "Integer value must be a safe integer number");
      if (value < type.parameters.schemaMin || value > type.parameters.schemaMax) {
        return failScalar("generation_rule_incompatible", `Integer value ${value} exceeds schema bounds [${type.parameters.schemaMin}, ${type.parameters.schemaMax}]`);
      }
      return { ok: true, value };
    case "decimal": {
      const shape = decimalShape(column);
      if (!shape.ok) return { ok: false, ...shape };
      const units = parseDecimalUnits(value, shape.scale);
      if (units === null) return failScalar("generation_rule_incompatible", `Decimal value must be a string expressible at scale ${shape.scale}; implicit rounding/coercion is not allowed`);
      const bound = 10n ** BigInt(shape.precision) - 1n;
      if (units < -bound || units > bound) return failScalar("generation_rule_incompatible", `Decimal value exceeds decimal(${shape.precision},${shape.scale}) precision`);
      return { ok: true, value: formatDecimalUnits(units, shape.scale) };
    }
    case "varchar": {
      if (typeof value !== "string") return failScalar("generation_rule_incompatible", "String value must be text; implicit coercion is not allowed");
      const bound = varcharBound(column);
      if (!bound.ok) return { ok: false, ...bound };
      const length = Array.from(value).length;
      if (bound.max !== null && length > bound.max) return failScalar("generation_rule_incompatible", `String value length ${length} exceeds schema maximum length ${bound.max}; truncation is not allowed`);
      return { ok: true, value };
    }
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : failScalar("generation_rule_incompatible", "Boolean value must be true or false");
    case "date": {
      const date = parseDate(value);
      return date === null ? failScalar("generation_rule_incompatible", "Date value must be a valid YYYY-MM-DD date") : { ok: true, value: formatDate(date) };
    }
    case "timestamp": {
      const precision = timestampPrecision(column);
      if (!precision.ok) return { ok: false, ...precision };
      const parsed = parseTimestamp(value);
      if (!parsed) return failScalar("generation_rule_incompatible", "Timestamp value must be a valid UTC ISO timestamp ending in Z");
      if (parsed.precision > precision.value) return failScalar("generation_rule_incompatible", `Timestamp fractional digits exceed schema precision ${precision.value}`);
      return { ok: true, value: formatTimestamp(parsed.nanoseconds, precision.value) };
    }
    default:
      return failScalar("generation_rule_incompatible", `Constant/Enum do not support schema family ${type.kind}`);
  }
}

function failScalar(code, reason, severity = "error") {
  return { ok: false, code, reason, severity };
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
function decimalShape(column) {
  const precision = column.precision;
  const scale = column.scale;
  if (precision?.state !== "known" || scale?.state !== "known") {
    return { ok: false, code: "decimal_precision_scale_unknown", severity: "unsupported", reason: `Decimal precision/scale must be known; metadata states are ${precision?.state ?? "unknown"} / ${scale?.state ?? "unknown"}` };
  }
  if (!Number.isSafeInteger(precision.value) || precision.value < 1 || precision.value > 1000
    || !Number.isSafeInteger(scale.value) || scale.value < 0 || scale.value > precision.value) {
    return { ok: false, code: "invalid_precision_scale", severity: "error", reason: `Decimal precision/scale must satisfy 1 <= precision <= 1000 and 0 <= scale <= precision; received (${String(precision.value)}, ${String(scale.value)})` };
  }
  return { ok: true, precision: precision.value, scale: scale.value };
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
function varcharBound(column) {
  const capacity = interpretStringCapacity(column);
  if (!capacity) {
    return { ok: false, code: "generation_rule_incompatible", severity: "error", reason: "Schema type is not a supported string family" };
  }
  if (capacity.model === "bounded") return { ok: true, max: capacity.maxLength };
  if (capacity.model === "unbounded") return { ok: true, max: null };
  if (capacity.model === "invalid") return { ok: false, code: "invalid_length", severity: "error", reason: capacity.reason };
  return { ok: false, code: "varchar_length_unknown", severity: "unsupported", reason: capacity.reason };
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
function timestampPrecision(column) {
  const fact = column.precision;
  if (fact?.state === "known") {
    if (!Number.isSafeInteger(fact.value) || fact.value < 0 || fact.value > 9) {
      return { ok: false, code: "invalid_precision_scale", severity: "error", reason: `Timestamp precision must be an integer from 0 through 9; received ${String(fact.value)}` };
    }
    return { ok: true, value: fact.value };
  }
  return { ok: true, value: 3 };
}

/** @param {unknown} raw @param {number} scale */
export function parseDecimalUnits(raw, scale) {
  if (typeof raw !== "string" || !/^[+-]?(?:\d+)(?:\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) return null;
  const padded = fraction.padEnd(scale, "0");
  const units = BigInt(`${whole}${padded}` || "0");
  return negative ? -units : units;
}

/** @param {bigint} units @param {number} scale */
export function formatDecimalUnits(units, scale) {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString();
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(scale + 1, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

/** @param {unknown} value */
function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? millis : null;
}

/** @param {number} millis */
function formatDate(millis) {
  return new Date(millis).toISOString().slice(0, 10);
}

/** @param {unknown} value */
export function parseTimestamp(value) {
  const match = typeof value === "string"
    ? value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/)
    : null;
  if (!match) return null;
  const [, date, hourText, minuteText, secondText, fraction = ""] = match;
  const millis = parseDate(date);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (millis === null || hour > 23 || minute > 59 || second > 59) return null;
  const nanos = BigInt(fraction.padEnd(9, "0") || "0");
  const nanoseconds = BigInt(millis) * 1_000_000n + BigInt(hour * 3600 + minute * 60 + second) * 1_000_000_000n + nanos;
  return { nanoseconds, precision: fraction.length };
}

/** @param {bigint} nanoseconds @param {number} precision */
export function formatTimestamp(nanoseconds, precision) {
  let seconds = nanoseconds / 1_000_000_000n;
  let fractionValue = nanoseconds % 1_000_000_000n;
  if (fractionValue < 0n) {
    seconds -= 1n;
    fractionValue += 1_000_000_000n;
  }
  const base = new Date(Number(seconds * 1_000n)).toISOString().replace(/\.\d{3}Z$/, "");
  if (precision === 0) return `${base}Z`;
  const fraction = fractionValue.toString().padStart(9, "0").slice(0, precision);
  return `${base}.${fraction}Z`;
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
export function isUuidType(column) {
  return column.dataType?.state === "known" && typeof column.dataType.value === "string"
    && /^uuid$/i.test(column.dataType.value.trim());
}

/** @param {unknown} value */
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} value */
function canonicalSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`).join(",")}}`;
}
