import { makeDiagnostic, planStatus } from "../diagnostics.mjs";
import { interpretColumnType } from "../schema/schema-interpreter.mjs";
import { normalizeTableSchema } from "../schema/schema-model.mjs";
import { checkSemanticCompatibility, inferSemanticType, SEMANTIC_TYPES } from "../semantic/semantic-inference.mjs";
import { resolvePersonGroups } from "../semantic/person-groups.mjs";

const SUPPORTED_RULES = new Set(["integer", "decimal", "varchar", "string", "boolean", "date", "timestamp"]);
const MAX_ROW_COUNT = 1_000_000;
const MAX_DECIMAL_PRECISION = 1_000;

/**
 * @typedef {"unknown" | "name" | "gender" | "birthday" | "mobile" | "email" | "address"} SemanticType
 * @typedef {Object} SemanticMapping
 * @property {SemanticType} semanticType
 * @property {"high" | "medium" | "low" | "unknown"} confidence
 * @property {Array<{ source: string, observation: string, explanation: string }>} evidence
 * @property {string} source
 * @property {string} status
 * @property {boolean} selected
 * @typedef {Object} GenerationRule
 * @property {string} identity
 * @property {string} kind
 * @property {string} source
 * @property {Record<string, unknown>} parameters
 * @typedef {Object} ColumnGenerationPlan
 * @property {import("../schema/schema-model.mjs").ColumnSchema} schema
 * @property {SemanticMapping} semanticMapping
 * @property {Record<string, unknown>} inference
 * @property {GenerationRule} rule
 * @property {string | null} personGroupIdentity
 * @property {number} nullProbability
 * @typedef {Object} GenerationPlan
 * @property {import("../schema/schema-model.mjs").TableSchema} table
 * @property {ColumnGenerationPlan[]} columns
 * @property {Array<Record<string, unknown>>} semanticGroups
 * @property {string} seed
 * @property {number} rowCount
 * @property {string} locale
 * @property {string} mode
 * @property {"sha256-addressed-v1"} determinismProfile
 * @property {GenerationDiagnostic[]} diagnostics
 * @property {"ready" | "ready_with_warnings" | "blocked"} status
 */

/**
 * Convert normalized schema facts, semantic mappings, groups, and user rules
 * into an inspectable plan. No provider, UI, Faker, or database is called.
 * @param {unknown} tableInput
 * @param {{ seed?: string | number, rowCount?: number, overrides?: Record<string, unknown>, semanticOverrides?: Record<string, string>, semanticMappings?: Record<string, string>, personGroups?: Array<{ id: string, columns: string[] }>, locale?: string, mode?: string }} options
 * @returns {GenerationPlan}
 */
export function buildGenerationPlan(tableInput, options = {}) {
  const { schema, issues } = normalizeTableSchema(tableInput);
  const diagnostics = issues.map((issue) => makeDiagnostic({
    severity: "error",
    code: issue.code,
    table: schema.tableIdentity,
    column: issue.column,
    rule: "schema-input",
    reason: issue.reason,
  }));

  const seed = normalizeSeed(options.seed, schema.tableIdentity, diagnostics);
  const rowCount = normalizeRowCount(options.rowCount, schema.tableIdentity, diagnostics);
  const locale = normalizeLocale(options.locale, schema.tableIdentity, diagnostics);
  const mode = normalizeMode(options.mode, schema.tableIdentity, diagnostics);
  const overrides = normalizeOverrides(options.overrides, schema.tableIdentity, diagnostics);
  const semanticOverrides = normalizeSemanticMappings(options.semanticOverrides, "explicit-user-semantic-override", schema.tableIdentity, diagnostics);
  const confirmedMappings = normalizeSemanticMappings(options.semanticMappings, "confirmed-semantic-mapping", schema.tableIdentity, diagnostics);
  const seenColumns = new Set();
  const columnPlans = schema.columns.map((column) => {
    if (seenColumns.has(column.name)) {
      diagnostics.push(makeDiagnostic({
        severity: "error",
        code: "duplicate_column_name",
        table: schema.tableIdentity,
        column: column.name,
        rule: "schema-interpretation",
        reason: "Column names must be unique within the table for stable row and seed identity",
      }));
    }
    seenColumns.add(column.name);
    const inference = inferSemanticType(column, locale);
    const semanticMapping = resolveSemanticMapping(
      schema.tableIdentity,
      column,
      inference,
      semanticOverrides,
      confirmedMappings,
      locale,
      diagnostics,
    );
    return planColumn(schema.tableIdentity, column, overrides.get(column.name), semanticMapping, inference, locale, mode, diagnostics);
  });

  for (const [mappingSet, rule] of [[overrides, "explicit-user-rule"], [semanticOverrides, "semantic-user-override"], [confirmedMappings, "confirmed-semantic-mapping"]]) {
    for (const columnName of mappingSet.keys()) {
      if (!seenColumns.has(columnName)) {
        diagnostics.push(makeDiagnostic({
          severity: "error",
          code: rule === "explicit-user-rule" ? "invalid_override" : "semantic_override_invalid",
          table: schema.tableIdentity,
          column: columnName,
          rule,
          reason: "Mapping refers to a column that does not exist in the table schema",
        }));
      }
    }
  }

  const grouped = resolvePersonGroups(columnPlans, options.personGroups, schema.tableIdentity, diagnostics);
  const finalizedColumns = grouped.columns.map((column) => Object.freeze({
    ...column,
    semanticMapping: Object.freeze({ ...column.semanticMapping, evidence: Object.freeze([...column.semanticMapping.evidence]) }),
    inference: Object.freeze({ ...column.inference, evidence: Object.freeze([...column.inference.evidence]), candidates: Object.freeze([...column.inference.candidates]) }),
    rule: Object.freeze({ ...column.rule, parameters: Object.freeze({ ...column.rule.parameters }) }),
  }));
  const frozenDiagnostics = Object.freeze(diagnostics);
  return Object.freeze({
    table: schema,
    columns: Object.freeze(finalizedColumns),
    semanticGroups: Object.freeze(grouped.groups),
    seed,
    rowCount,
    locale,
    mode,
    determinismProfile: "sha256-addressed-v1",
    diagnostics: frozenDiagnostics,
    status: planStatus(diagnostics),
  });
}

function resolveSemanticMapping(tableIdentity, column, inference, semanticOverrides, confirmedMappings, locale, diagnostics) {
  const explicitType = semanticOverrides.get(column.name);
  if (semanticOverrides.has(column.name)) {
    return selectSemanticMapping(tableIdentity, column, explicitType, "explicit_user_semantic_override", inference, locale, diagnostics);
  }
  const confirmedType = confirmedMappings.get(column.name);
  if (confirmedMappings.has(column.name)) {
    return selectSemanticMapping(tableIdentity, column, confirmedType, "confirmed_semantic_mapping", inference, locale, diagnostics);
  }

  if (inference.status === "ambiguous") {
    diagnostics.push(makeDiagnostic({
      severity: "warning",
      code: "semantic_ambiguous",
      table: tableIdentity,
      column: column.name,
      rule: "semantic-inference",
      reason: `Column name matches multiple semantic types: ${inference.candidates.join(", ")}; schema-type fallback is retained`,
      blocking: false,
    }));
    return mappingFromInference(inference, "ambiguous", false);
  }
  if (inference.status === "incompatible") {
    diagnostics.push(makeDiagnostic({
      severity: "warning",
      code: "semantic_schema_incompatible",
      table: tableIdentity,
      column: column.name,
      rule: `semantic:${inference.semanticType}:v1`,
      reason: `${inference.reason}; schema-type fallback is retained`,
      blocking: false,
    }));
    return mappingFromInference(inference, "incompatible", false);
  }
  if (inference.status === "candidate") {
    if (inference.confidence === "low") {
      diagnostics.push(makeDiagnostic({
        severity: "warning",
        code: "semantic_low_confidence",
        table: tableIdentity,
        column: column.name,
        rule: "semantic-inference",
        reason: `Candidate ${inference.semanticType} has low-confidence name evidence; schema-type fallback is retained`,
        blocking: false,
      }));
    }
    diagnostics.push(makeDiagnostic({
      severity: "warning",
      code: "semantic_confirmation_required",
      table: tableIdentity,
      column: column.name,
      rule: `semantic:${inference.semanticType}:v1`,
      reason: `Candidate ${inference.semanticType} is inspectable but requires an explicit semantic override or confirmed mapping before Person generation`,
      blocking: false,
    }));
    return mappingFromInference(inference, "needs_confirmation", false);
  }
  return mappingFromInference(inference, "unknown", false);
}

function selectSemanticMapping(tableIdentity, column, rawType, source, inference, locale, diagnostics) {
  const fail = (code, reason, severity = "error") => {
    diagnostics.push(makeDiagnostic({
      severity,
      code,
      table: tableIdentity,
      column: column.name,
      rule: source,
      reason,
    }));
    return {
      semanticType: typeof rawType === "string" && SEMANTIC_TYPES.includes(rawType) ? rawType : "unknown",
      confidence: "unknown",
      evidence: [...inference.evidence],
      source,
      status: "invalid",
      selected: false,
    };
  };

  if (typeof rawType !== "string") {
    return fail("semantic_override_invalid", "Semantic mapping must be a string SemanticType");
  }
  if (!SEMANTIC_TYPES.includes(rawType)) {
    return fail("unsupported_semantic_type", `Unsupported semantic type ${rawType}`);
  }
  if (rawType === "unknown") {
    return {
      semanticType: "unknown",
      confidence: "unknown",
      evidence: [Object.freeze({ source: source === "confirmed_semantic_mapping" ? "user_confirmed" : "user_override", observation: rawType, explanation: "Semantic generation was explicitly left unknown" })],
      source,
      status: "unknown",
      selected: false,
    };
  }

  const compatibility = checkSemanticCompatibility(column, rawType, locale);
  const evidence = [...(inference.semanticType === rawType ? inference.evidence : []), ...compatibility.evidence];
  evidence.push(Object.freeze({
    source: source === "confirmed_semantic_mapping" ? "user_confirmed" : "user_override",
    observation: rawType,
    explanation: source === "confirmed_semantic_mapping" ? "Semantic mapping was explicitly confirmed" : "Semantic type was explicitly overridden by the user",
  }));
  if (compatibility.compatible !== true) {
    diagnostics.push(makeDiagnostic({
      severity: "error",
      code: "semantic_schema_incompatible",
      table: tableIdentity,
      column: column.name,
      rule: source,
      reason: compatibility.reason,
    }));
    return {
      semanticType: rawType,
      confidence: inference.semanticType === rawType ? inference.confidence : "unknown",
      evidence,
      source,
      status: "incompatible",
      selected: false,
    };
  }
  return {
    semanticType: rawType,
    confidence: inference.semanticType === rawType ? inference.confidence : "unknown",
    evidence,
    source,
    status: "selected",
    selected: true,
  };
}

function mappingFromInference(inference, status, selected) {
  return {
    semanticType: inference.semanticType,
    confidence: inference.confidence,
    evidence: [...inference.evidence],
    source: inference.status === "unknown" ? "schema_type_fallback" : "automatic_semantic_inference",
    status,
    selected,
  };
}

function planColumn(tableIdentity, column, override, semanticMapping, inference, locale, mode, diagnostics) {
  const interpreted = interpretColumnType(column);
  const schemaRuleId = `schema:${column.name}`;
  if (!interpreted) {
    const knownType = column.dataType.state === "known" ? String(column.dataType.value) : column.dataType.state;
    diagnostics.push(makeDiagnostic({
      severity: "unsupported",
      code: column.dataType.state === "known" ? "unsupported_type" : "data_type_unknown",
      table: tableIdentity,
      column: column.name,
      rule: schemaRuleId,
      reason: column.dataType.state === "known"
        ? `No schema fallback generator supports data type ${knownType}`
        : `Data type metadata is ${column.dataType.state}; ${column.dataType.reason || "a known type is required"}`,
    }));
    return {
      schema: column,
      semanticMapping,
      inference,
      rule: { identity: schemaRuleId, kind: "unsupported", source: "schema_type_fallback", parameters: {} },
      nullProbability: 0,
      personGroupIdentity: null,
    };
  }

  const ruleKind = interpreted.kind;
  const baseParameters = { ...interpreted.parameters };
  if (ruleKind === "integer") {
    baseParameters.defaultMin = Math.max(0, baseParameters.schemaMin);
    baseParameters.defaultMax = Math.max(baseParameters.defaultMin, Math.min(baseParameters.schemaMax, 1_000_000));
  }
  validateTypeMetadata(tableIdentity, column, ruleKind, baseParameters, schemaRuleId, diagnostics);
  let nullProbability = defaultNullProbability(column, tableIdentity, diagnostics);
  let rule;
  let finalSemanticMapping = semanticMapping;

  if (override !== undefined) {
    const valid = validateOverride(tableIdentity, column, ruleKind, override, baseParameters, nullProbability, diagnostics);
    if (valid) {
      nullProbability = valid.nullProbability;
      rule = { identity: valid.identity, kind: ruleKind, source: "explicit_user_rule", parameters: { ...valid.parameters, nullProbability } };
      if (semanticMapping.selected) {
        finalSemanticMapping = { ...semanticMapping, status: "overridden_by_explicit_user_rule", selected: false };
      }
    } else if (semanticMapping.selected) {
      finalSemanticMapping = { ...semanticMapping, status: "blocked_by_invalid_explicit_rule", selected: false };
    }
  }

  if (!rule && semanticMapping.selected) {
    rule = {
      identity: `semantic:${semanticMapping.semanticType}:v1`,
      kind: `semantic:${semanticMapping.semanticType}`,
      source: semanticMapping.source,
      parameters: { locale, mode, nullProbability: 0 },
    };
    nullProbability = 0;
  }
  if (!rule) {
    rule = {
      identity: schemaRuleId,
      kind: ruleKind,
      source: "schema_type_fallback",
      parameters: { ...baseParameters, nullProbability },
    };
  }

  return {
    schema: column,
    semanticMapping: finalSemanticMapping,
    inference,
    rule: { ...rule, parameters: { ...rule.parameters } },
    nullProbability,
    personGroupIdentity: null,
  };
}

function validateTypeMetadata(tableIdentity, column, kind, parameters, ruleIdentity, diagnostics) {
  if (kind === "varchar") {
    const length = column.length;
    if (length.state === "known") {
      if (!Number.isSafeInteger(length.value) || length.value <= 0) {
        diagnostics.push(makeDiagnostic({
          severity: "error",
          code: "invalid_length",
          table: tableIdentity,
          column: column.name,
          rule: ruleIdentity,
          reason: `varchar length must be a positive safe integer; received ${String(length.value)}`,
        }));
      } else {
        parameters.schemaMaxLength = length.value;
      }
    } else if (length.state === "absent" || length.state === "not_applicable") {
      parameters.schemaMaxLength = null;
    } else {
      diagnostics.push(makeDiagnostic({
        severity: "unsupported",
        code: "varchar_length_unknown",
        table: tableIdentity,
        column: column.name,
        rule: ruleIdentity,
        reason: `varchar maximum length is ${length.state}; a maximum cannot be verified${length.reason ? `: ${length.reason}` : ""}`,
      }));
    }
  }

  if (kind === "decimal") {
    const precision = column.precision;
    const scale = column.scale;
    if (precision.state !== "known" || scale.state !== "known") {
      const unavailable = [precision, scale].filter((fact) => fact.state !== "known").map((fact) => fact.state).join(" / ");
      diagnostics.push(makeDiagnostic({
        severity: "unsupported",
        code: "decimal_precision_scale_unknown",
        table: tableIdentity,
        column: column.name,
        rule: ruleIdentity,
        reason: `decimal precision/scale must be known; metadata state: ${unavailable}`,
      }));
    } else if (!Number.isSafeInteger(precision.value)
      || !Number.isSafeInteger(scale.value)
      || precision.value < 1
      || precision.value > MAX_DECIMAL_PRECISION
      || scale.value < 0
      || scale.value > precision.value) {
      diagnostics.push(makeDiagnostic({
        severity: "error",
        code: "invalid_precision_scale",
        table: tableIdentity,
        column: column.name,
        rule: ruleIdentity,
        reason: `decimal precision/scale must satisfy 1 <= precision <= ${MAX_DECIMAL_PRECISION} and 0 <= scale <= precision; received (${String(precision.value)}, ${String(scale.value)})`,
      }));
    } else {
      parameters.precision = precision.value;
      parameters.scale = scale.value;
    }
  }

  if (kind === "timestamp" && column.precision.state === "known"
    && (!Number.isSafeInteger(column.precision.value) || column.precision.value < 0 || column.precision.value > 9)) {
    diagnostics.push(makeDiagnostic({
      severity: "error",
      code: "invalid_precision_scale",
      table: tableIdentity,
      column: column.name,
      rule: ruleIdentity,
      reason: `timestamp fractional precision must be an integer from 0 through 9; received ${String(column.precision.value)}`,
    }));
  } else if (kind === "timestamp" && column.precision.state !== "known") {
    diagnostics.push(makeDiagnostic({
      severity: "warning",
      code: "timestamp_precision_unknown",
      table: tableIdentity,
      column: column.name,
      rule: ruleIdentity,
      reason: `Timestamp precision is ${column.precision.state}; preview uses millisecond precision and does not claim a database precision guarantee`,
      blocking: false,
    }));
  }
}

function defaultNullProbability(column, tableIdentity, diagnostics) {
  if (column.nullable.state === "known") {
    if (typeof column.nullable.value !== "boolean") {
      diagnostics.push(makeDiagnostic({
        severity: "error",
        code: "invalid_nullable_fact",
        table: tableIdentity,
        column: column.name,
        rule: "schema:nullability",
        reason: "Known nullable metadata must contain a boolean value",
      }));
      return 0;
    }
    return column.nullable.value ? 0.1 : 0;
  }

  const isUnavailable = column.nullable.state === "unsupported" || column.nullable.state === "failed";
  diagnostics.push(makeDiagnostic({
    severity: isUnavailable ? "unsupported" : "warning",
    code: "nullability_unknown",
    table: tableIdentity,
    column: column.name,
    rule: "schema:nullability",
    reason: `Nullability is ${column.nullable.state}; the core will generate non-null values only and will not claim the column is NOT NULL${column.nullable.reason ? `: ${column.nullable.reason}` : ""}`,
    blocking: false,
  }));
  return 0;
}

function validateOverride(tableIdentity, column, schemaKind, raw, fallbackParameters, defaultNull, diagnostics) {
  const ruleLabel = isRecord(raw) && typeof raw.id === "string" && raw.id.trim() ? raw.id : "explicit-user-rule";
  const reject = (reason) => {
    diagnostics.push(makeDiagnostic({
      severity: "error",
      code: "invalid_override",
      table: tableIdentity,
      column: column.name,
      rule: ruleLabel,
      reason,
    }));
    return null;
  };
  if (!isRecord(raw)) return reject("Override must be an object");

  const allowed = new Set(["id", "type", "min", "max", "maxLength", "nullProbability"]);
  const unknownKeys = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknownKeys.length) return reject(`Unsupported rule parameter(s): ${unknownKeys.join(", ")}`);
  if (typeof raw.type !== "string" || !SUPPORTED_RULES.has(raw.type.toLowerCase())) {
    return reject("Override type must be one of integer, decimal, varchar/string, boolean, date, timestamp");
  }

  const overrideKind = raw.type.toLowerCase() === "string" ? "varchar" : raw.type.toLowerCase();
  if (overrideKind !== schemaKind) return reject(`Rule type ${overrideKind} is incompatible with schema type ${schemaKind}`);
  const specificParameters = schemaKind === "integer" || schemaKind === "date" || schemaKind === "timestamp"
    ? new Set(["min", "max"])
    : schemaKind === "varchar" ? new Set(["maxLength"]) : new Set();
  const unexpectedParameters = ["min", "max", "maxLength"].filter((key) => raw[key] !== undefined && !specificParameters.has(key));
  if (unexpectedParameters.length) return reject(`Unsupported ${schemaKind} parameter(s): ${unexpectedParameters.join(", ")}`);
  if (raw.id !== undefined && (typeof raw.id !== "string" || raw.id.trim() === "")) {
    return reject("Rule id must be a non-empty string when provided");
  }

  const parameters = { ...fallbackParameters };
  const nullProbability = raw.nullProbability === undefined ? defaultNull : raw.nullProbability;
  if (typeof nullProbability !== "number" || !Number.isFinite(nullProbability) || nullProbability < 0 || nullProbability > 1) {
    return reject("nullProbability must be a finite number between 0 and 1");
  }
  if (column.nullable.state === "known" && column.nullable.value === false && nullProbability > 0) {
    return reject("A NOT NULL column cannot have nullProbability greater than zero");
  }
  if (column.nullable.state !== "known" && nullProbability > 0) {
    return reject("A null-producing rule cannot be used while column nullability is unknown or unsupported");
  }
  parameters.nullProbability = nullProbability;

  if (schemaKind === "integer") {
    const min = raw.min === undefined ? fallbackParameters.defaultMin : raw.min;
    const max = raw.max === undefined ? fallbackParameters.defaultMax : raw.max;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      return reject("integer min/max must be safe integers with min <= max");
    }
    if (min < fallbackParameters.schemaMin || max > fallbackParameters.schemaMax) {
      return reject(`integer range [${min}, ${max}] exceeds schema domain [${fallbackParameters.schemaMin}, ${fallbackParameters.schemaMax}]`);
    }
    parameters.min = min;
    parameters.max = max;
  } else if (schemaKind === "varchar") {
    const schemaMax = fallbackParameters.schemaMaxLength;
    const maxLength = raw.maxLength === undefined ? Math.min(16, schemaMax ?? 16) : raw.maxLength;
    if (!Number.isSafeInteger(maxLength) || maxLength <= 0) return reject("varchar maxLength must be a positive safe integer");
    if (schemaMax !== null && schemaMax !== undefined && maxLength > schemaMax) {
      return reject(`varchar maxLength ${maxLength} exceeds schema length ${schemaMax}`);
    }
    parameters.maxLength = maxLength;
  } else if ((schemaKind === "date" || schemaKind === "timestamp") && (raw.min !== undefined || raw.max !== undefined)) {
    const parsed = validateDateRange(schemaKind, raw.min, raw.max);
    if (!parsed.ok) return reject(parsed.reason);
    if (schemaKind === "timestamp" && column.precision.state === "known") {
      const quantum = column.precision.value < 3 ? 10 ** (3 - column.precision.value) : 1;
      if (parseTimestamp(parsed.min) % quantum !== 0 || parseTimestamp(parsed.max) % quantum !== 0) {
        return reject(`timestamp min/max must align with the column's ${column.precision.value}-digit fractional precision`);
      }
    }
    parameters.min = parsed.min;
    parameters.max = parsed.max;
  } else if (raw.min !== undefined || raw.max !== undefined || raw.maxLength !== undefined) {
    return reject(`min/max/maxLength are not valid parameters for ${schemaKind}`);
  }

  return {
    identity: typeof raw.id === "string" ? raw.id : `explicit:${column.name}:${schemaKind}`,
    parameters,
    nullProbability,
  };
}

function validateDateRange(kind, rawMin, rawMax) {
  const minDefault = kind === "date" ? "2000-01-01" : "2000-01-01T00:00:00.000Z";
  const maxDefault = kind === "date" ? "2030-12-31" : "2035-12-31T23:59:59.999Z";
  const min = rawMin ?? minDefault;
  const max = rawMax ?? maxDefault;
  const parse = kind === "date" ? parseDate : parseTimestamp;
  const minValue = parse(min);
  const maxValue = parse(max);
  if (minValue === null || maxValue === null) return { ok: false, reason: `${kind} min/max must be valid ${kind === "date" ? "YYYY-MM-DD dates" : "ISO timestamps"}` };
  if (minValue > maxValue) return { ok: false, reason: `${kind} min must be earlier than or equal to max` };
  return { ok: true, min, max };
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function parseTimestamp(value) {
  const match = typeof value === "string"
    ? value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/)
    : null;
  if (!match || parseDate(match[1]) === null) return null;
  const [, , hourText, minuteText, secondText, fractionText = ""] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const milliseconds = Number((fractionText + "000").slice(0, 3));
  return parseDate(match[1]) + hour * 3_600_000 + minute * 60_000 + second * 1_000 + milliseconds;
}

function normalizeSeed(seed, tableIdentity, diagnostics) {
  if (typeof seed === "string") return seed;
  if (typeof seed === "number" && Number.isFinite(seed)) return String(seed);
  diagnostics.push(makeDiagnostic({
    severity: "error",
    code: "invalid_seed",
    table: tableIdentity,
    rule: "generation-settings",
    reason: "A string or finite numeric seed is required for deterministic generation",
  }));
  return "<invalid-seed>";
}

function normalizeRowCount(rowCount, tableIdentity, diagnostics) {
  if (Number.isSafeInteger(rowCount) && rowCount >= 0 && rowCount <= MAX_ROW_COUNT) return rowCount;
  diagnostics.push(makeDiagnostic({
    severity: "error",
    code: "invalid_row_count",
    table: tableIdentity,
    rule: "generation-settings",
    reason: `rowCount must be an integer from 0 through ${MAX_ROW_COUNT}`,
  }));
  return 0;
}

function normalizeLocale(locale, tableIdentity, diagnostics) {
  if (locale === undefined) return "zh-CN";
  if (locale === "zh-CN" || locale === "en") return locale;
  diagnostics.push(makeDiagnostic({
    severity: "error",
    code: "invalid_locale",
    table: tableIdentity,
    rule: "generation-settings",
    reason: "Locale must be one of zh-CN or en",
  }));
  return "zh-CN";
}

function normalizeMode(mode, tableIdentity, diagnostics) {
  if (mode === undefined || mode === "safe_synthetic") return "safe_synthetic";
  diagnostics.push(makeDiagnostic({
    severity: "unsupported",
    code: "validator_mode_unsupported",
    table: tableIdentity,
    rule: "generation-mode",
    reason: `Generation mode ${String(mode)} is unsupported; Safe Synthetic is the only implemented mode`,
  }));
  return String(mode);
}

function normalizeSemanticMappings(input, rule, tableIdentity, diagnostics) {
  if (input === undefined) return new Map();
  if (!isRecord(input)) {
    diagnostics.push(makeDiagnostic({
      severity: "error",
      code: "semantic_override_invalid",
      table: tableIdentity,
      rule,
      reason: "Semantic mappings must be an object keyed by column name",
    }));
    return new Map();
  }
  return new Map(Object.entries(input));
}

function normalizeOverrides(input, tableIdentity, diagnostics) {
  if (input === undefined) return new Map();
  if (!isRecord(input)) {
    diagnostics.push(makeDiagnostic({
      severity: "error",
      code: "invalid_override",
      table: tableIdentity,
      rule: "explicit-user-rule",
      reason: "Rule overrides must be an object keyed by column name",
    }));
    return new Map();
  }
  return new Map(Object.entries(input));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
