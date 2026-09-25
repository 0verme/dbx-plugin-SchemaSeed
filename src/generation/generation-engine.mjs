import { makeDiagnostic, planStatus } from "../diagnostics.mjs";
import { formatDecimalUnits, formatTimestamp, parseTimestamp, resolveStringGenerationMaxLength } from "./generation-rules.mjs";
import { allocateConstraintRows } from "./constraint-allocation.mjs";
import { digestFor, randomBigIntBelow, randomBigIntBelowUniform, randomUnit } from "./generation-identity.mjs";
import { validateDatasetConstraints } from "./manual-constraints.mjs";
import { generatePersonSyntheticValue } from "./person-synthetic.mjs";

const STRING_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DAY_MS = 86_400_000;
const SECOND_MS = 1_000;
const DEFAULT_DATE_MIN = Date.parse("2000-01-01T00:00:00.000Z");
const DEFAULT_DATE_MAX = Date.parse("2030-12-31T00:00:00.000Z");
const DEFAULT_TIMESTAMP_MIN = Date.parse("2000-01-01T00:00:00.000Z");
const DEFAULT_TIMESTAMP_MAX = Date.parse("2035-12-31T23:59:59.999Z");

/**
 * Execute an inspectable plan using random-access, per-cell SHA-256 identities.
 * No global RNG state, iteration order, or shared random stream participates.
 * @param {import("./generation-plan.mjs").GenerationPlan} plan
 * @returns {{ rows: Array<Record<string, unknown>>, diagnostics: import("../diagnostics.mjs").GenerationDiagnostic[], status: string }}
 */
export function generateRows(plan) {
  if (!plan || !Array.isArray(plan.columns) || !Array.isArray(plan.diagnostics)) {
    const diagnostics = [makeDiagnostic({
      severity: "error",
      code: "invalid_generation_plan",
      rule: "generation-engine",
      reason: "A GenerationPlan produced by buildGenerationPlan is required",
    })];
    return { rows: [], diagnostics, status: "blocked" };
  }
  if (plan.status === "blocked") return { rows: [], diagnostics: [...plan.diagnostics], status: "blocked" };

  const rows = [];
  const constrainedRows = plan.constraintPlan?.allocations?.length
    ? allocateConstraintRows(plan)
    : new Map();
  for (let rowIndex = 0; rowIndex < plan.rowCount; rowIndex += 1) {
    const rowIdentity = String(rowIndex);
    const entries = [];
    try {
      for (const columnPlan of plan.columns) {
        const { schema, rule, nullProbability } = columnPlan;
        const semantic = rule.kind.startsWith("semantic:");
        if (semantic && !columnPlan.personGroupIdentity) {
          throw new Error("A semantic Person rule must belong to a resolved Person group");
        }
        const identity = semantic
          ? [plan.seed, plan.table.tableIdentity, columnPlan.personGroupIdentity, rowIdentity, plan.locale, plan.mode, rule.identity]
          : [plan.seed, plan.table.tableIdentity, schema.name, rowIdentity, rule.identity];
        if (nullProbability > 0 && randomUnit([...identity, "nullable"]) < nullProbability) {
          entries.push([schema.name, null]);
          continue;
        }
        entries.push([schema.name, generateValue(rule, identity, schema, plan.locale, rowIndex)]);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const column = plan.columns[entries.length]?.schema?.name ?? null;
      const failedRule = plan.columns[entries.length]?.rule;
      const diagnostics = [
        ...plan.diagnostics,
        makeDiagnostic({
          severity: "error",
          code: "generation_impossible",
          table: plan.table.tableIdentity,
          column,
          rule: failedRule?.identity ?? "generation-engine",
          reason,
        }),
      ];
      return { rows: [], diagnostics, status: "blocked" };
    }
    const row = Object.fromEntries(entries);
    for (const [column, value] of constrainedRows.get(rowIndex) ?? []) row[column] = value;
    rows.push(row);
  }

  const diagnostics = [...plan.diagnostics];
  if (plan.constraintPlan) {
    const validation = validateDatasetConstraints(rows, plan.constraintPlan);
    diagnostics.push(...validation.diagnostics);
    if (!validation.valid) return { rows: [], diagnostics, status: "blocked" };
  }
  return { rows, diagnostics, status: planStatus(diagnostics) };
}

function generateValue(rule, identity, column, locale, rowIndex) {
  const parameters = rule.parameters;
  if (rule.kind.startsWith("semantic:")) {
    return generatePersonSyntheticValue(rule.kind.slice("semantic:".length), identity, locale);
  }
  switch (rule.kind) {
    case "constant":
      return parameters.value;
    case "sequence": {
      if (parameters.numericKind === "decimal") {
        const value = BigInt(parameters.startUnits) + BigInt(parameters.stepUnits) * BigInt(rowIndex);
        return formatDecimalUnits(value, parameters.scale);
      }
      const value = BigInt(parameters.start) + BigInt(parameters.step) * BigInt(rowIndex);
      const numeric = Number(value);
      if (!Number.isSafeInteger(numeric)) throw new Error("Integer Sequence exceeded safe numeric representation");
      return numeric;
    }
    case "random_integer":
      return Number(randomBigIntBelowUniform(BigInt(parameters.max) - BigInt(parameters.min) + 1n, [...identity, "random-integer"]) + BigInt(parameters.min));
    case "random_decimal": {
      const min = BigInt(parameters.minUnits);
      const max = BigInt(parameters.maxUnits);
      const units = min + randomBigIntBelowUniform(max - min + 1n, [...identity, "random-decimal"]);
      return formatDecimalUnits(units, parameters.scale);
    }
    case "random_string":
      return randomString(parameters.length, identity, true);
    case "enum":
      return parameters.values[Number(randomBigIntBelowUniform(BigInt(parameters.values.length), [...identity, "enum-choice"]))];
    case "boolean_ratio":
      return parameters.trueRatio === 1
        || (parameters.trueRatio !== 0 && randomUnit([...identity, "boolean-ratio"]) < parameters.trueRatio);
    case "date_range":
      return randomDate(parameters.start, parameters.end, identity);
    case "timestamp_range":
      return randomTimestamp(parameters.start, parameters.end, column, identity);
    case "uuid":
      return deterministicUuid(identity);
    case "integer": {
      const min = Number.isSafeInteger(parameters.min) ? parameters.min : parameters.defaultMin;
      const max = Number.isSafeInteger(parameters.max) ? parameters.max : parameters.defaultMax;
      return Number(randomBigIntBelow(BigInt(max) - BigInt(min) + 1n, [...identity, "integer"]) + BigInt(min));
    }
    case "decimal": {
      const precision = parameters.precision;
      const scale = parameters.scale;
      const units = randomBigIntBelow(10n ** BigInt(precision), [...identity, "decimal"]);
      return formatDecimalUnits(units, scale);
    }
    case "varchar": {
      const maxLength = resolveStringGenerationMaxLength(parameters.maxLength, parameters.schemaMaxLength);
      return randomString(Number(randomBigIntBelow(BigInt(maxLength), [...identity, "string-length"])) + 1, identity);
    }
    case "boolean":
      return randomBigIntBelow(2n, [...identity, "boolean"]) === 1n;
    case "date": {
      const min = parseDateBound(parameters.min, DEFAULT_DATE_MIN);
      const max = parseDateBound(parameters.max, DEFAULT_DATE_MAX);
      const days = Math.floor((max - min) / DAY_MS) + 1;
      const offset = Number(randomBigIntBelow(BigInt(days), [...identity, "date"])) * DAY_MS;
      return new Date(min + offset).toISOString().slice(0, 10);
    }
    case "timestamp": {
      const min = parseTimestampBound(parameters.min, DEFAULT_TIMESTAMP_MIN);
      const max = parseTimestampBound(parameters.max, DEFAULT_TIMESTAMP_MAX);
      const precision = column.precision.state === "known" ? column.precision.value : 3;
      const quantum = precision < 3 ? 10 ** (3 - precision) : 1;
      const slots = Math.floor((max - min) / quantum) + 1;
      const value = min + Number(randomBigIntBelow(BigInt(slots), [...identity, "timestamp"])) * quantum;
      return formatTimestamp(BigInt(value) * 1_000_000n, precision);
    }
    default:
      throw new Error(`No generator is available for rule ${rule.kind}`);
  }
}

function randomString(length, identity, uniform = false) {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    const address = [...identity, `character-${index}`];
    const charIndex = Number(uniform
      ? randomBigIntBelowUniform(BigInt(STRING_ALPHABET.length), address)
      : randomBigIntBelow(BigInt(STRING_ALPHABET.length), address));
    output += STRING_ALPHABET[charIndex];
  }
  return output;
}

function randomDate(start, end, identity) {
  const min = Date.parse(`${start}T00:00:00.000Z`);
  const max = Date.parse(`${end}T00:00:00.000Z`);
  const days = BigInt(Math.floor((max - min) / DAY_MS) + 1);
  const value = min + Number(randomBigIntBelowUniform(days, [...identity, "date-range"])) * DAY_MS;
  return new Date(value).toISOString().slice(0, 10);
}

function randomTimestamp(start, end, column, identity) {
  const minimum = parseTimestamp(start);
  const maximum = parseTimestamp(end);
  if (!minimum || !maximum) throw new Error("Invalid Timestamp Range in GenerationPlan");
  const precision = column.precision.state === "known" ? column.precision.value : 3;
  const quantum = 10n ** BigInt(9 - precision);
  const slots = (maximum.nanoseconds - minimum.nanoseconds) / quantum + 1n;
  const value = minimum.nanoseconds + randomBigIntBelowUniform(slots, [...identity, "timestamp-range"]) * quantum;
  return formatTimestamp(value, precision);
}

function deterministicUuid(identity) {
  const bytes = Buffer.from(digestFor([...identity, "uuid-v4"]).subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseDateBound(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid date bound ${String(value)}`);
  return parsed;
}

function parseTimestampBound(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid timestamp bound ${String(value)}`);
  return parsed;
}
