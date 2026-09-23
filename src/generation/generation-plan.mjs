import { makeDiagnostic, planStatus } from "../diagnostics.mjs";
import { interpretColumnType } from "../schema/schema-interpreter.mjs";
import { normalizeTableSchema } from "../schema/schema-model.mjs";

const SUPPORTED_RULES = new Set(["integer", "decimal", "varchar", "string", "boolean", "date", "timestamp"]);
const MAX_ROW_COUNT = 1_000_000;
const MAX_DECIMAL_PRECISION = 1_000;

/**
 * The semantic slot is deliberately unknown in Phase 1A. Rule selection is
 * explicit user rule > future semantic decision > schema fallback; no semantic
 * inference or personal-data generator is implemented here.
 *
 * @typedef {"unknown"} SemanticType
 * @typedef {Object} GenerationRule
 * @property {string} identity
 * @property {"integer" | "decimal" | "varchar" | "boolean" | "date" | "timestamp" | "unsupported"} kind
 * @property {"explicit_user_rule" | "schema_type_fallback"} source
 * @property {Record<string, unknown>} parameters
 * @typedef {Object} ColumnGenerationPlan
 * @property {import("../schema/schema-model.mjs").ColumnSchema} schema
 * @property {{ type: SemanticType }} semanticType
 * @property {GenerationRule} rule
 * @property {number} nullProbability
 * @typedef {Object} GenerationPlan
 * @property {import("../schema/schema-model.mjs").TableSchema} table
 * @property {ColumnGenerationPlan[]} columns
 * @property {string} seed
 * @property {number} rowCount
 * @property {"sha256-addressed-v1"} determinismProfile
 * @property {GenerationDiagnostic[]} diagnostics
 * @property {"ready" | "ready_with_warnings" | "blocked"} status
 */

/**
 * Convert normalized schema facts and user overrides into a fully inspectable
 * plan. This layer never calls a provider, UI, Faker, or database.
 *
 * @param {unknown} tableInput
 * @param {{ seed?: string | number, rowCount?: number, overrides?: Record<string, unknown> }} options
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
  const overrides = normalizeOverrides(options.overrides, schema.tableIdentity, diagnostics);
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
    return planColumn(schema.tableIdentity, column, overrides.get(column.name), diagnostics);
  });

  for (const columnName of overrides.keys()) {
    if (!seenColumns.has(columnName)) {
      diagnostics.push(makeDiagnostic({
        severity: "error",
        code: "invalid_override",
        table: schema.tableIdentity,
        column: columnName,
        rule: "explicit-user-rule",
        reason: "Override refers to a column that does not exist in the table schema",
      }));
    }
  }

  const frozenDiagnostics = Object.freeze(diagnostics);
  return Object.freeze({
    table: schema,
    columns: Object.freeze(columnPlans),
    seed,
    rowCount,
    determinismProfile: "sha256-addressed-v1",
    diagnostics: frozenDiagnostics,
    status: planStatus(diagnostics),
  });
}

function planColumn(tableIdentity, column, override, diagnostics) {
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
    return makeColumnPlan(column, { kind: "unsupported", parameters: {} }, "schema_type_fallback", 0, schemaRuleId);
  }

  const ruleKind = interpreted.kind;
  const baseParameters = { ...interpreted.parameters };
  if (ruleKind === "integer") {
    baseParameters.defaultMin = Math.max(0, baseParameters.schemaMin);
    baseParameters.defaultMax = Math.max(baseParameters.defaultMin, Math.min(baseParameters.schemaMax, 1_000_000));
  }
  validateTypeMetadata(tableIdentity, column, ruleKind, baseParameters, schemaRuleId, diagnostics);
  const fallback = makeColumnPlan(column, { kind: ruleKind, parameters: baseParameters }, "schema_type_fallback", 0, schemaRuleId);

  let parameters = { ...fallback.rule.parameters };
  let source = "schema_type_fallback";
  let ruleIdentity = schemaRuleId;
  let nullProbability = defaultNullProbability(column, tableIdentity, diagnostics);

  if (override !== undefined) {
    const valid = validateOverride(tableIdentity, column, ruleKind, override, parameters, nullProbability, diagnostics);
    if (valid) {
      parameters = valid.parameters;
      nullProbability = valid.nullProbability;
      source = "explicit_user_rule";
      ruleIdentity = valid.identity;
    }
  }

  const rule = Object.freeze({
    identity: ruleIdentity,
    kind: ruleKind,
    source,
    parameters: Object.freeze({ ...parameters, nullProbability }),
  });
  return Object.freeze({ schema: column, semanticType: Object.freeze({ type: "unknown" }), rule, nullProbability });
}

function makeColumnPlan(column, ruleInput, source, nullProbability, identity) {
  return Object.freeze({
    schema: column,
    semanticType: Object.freeze({ type: "unknown" }),
    rule: Object.freeze({
      identity,
      kind: ruleInput.kind,
      source,
      parameters: Object.freeze({ ...ruleInput.parameters, nullProbability }),
    }),
    nullProbability,
  });
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
