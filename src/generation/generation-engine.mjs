import { createHash } from "node:crypto";
import { makeDiagnostic, planStatus } from "../diagnostics.mjs";
import { generatePersonSyntheticValue } from "./person-synthetic.mjs";

const STRING_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DAY_MS = 86_400_000;
const SECOND_MS = 1_000;
const DEFAULT_DATE_MIN = Date.parse("2000-01-01T00:00:00.000Z");
const DEFAULT_DATE_MAX = Date.parse("2030-12-31T00:00:00.000Z");
const DEFAULT_TIMESTAMP_MIN = Date.parse("2000-01-01T00:00:00.000Z");
const DEFAULT_TIMESTAMP_MAX = Date.parse("2035-12-31T23:59:59.999Z");

/**
 * Execute a frozen plan using random-access, per-cell SHA-256 identities. No
 * module-level RNG state or generation call order participates in a value.
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
        entries.push([schema.name, generateValue(rule, identity, schema, plan.locale)]);
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
    rows.push(Object.fromEntries(entries));
  }

  return { rows, diagnostics: [...plan.diagnostics], status: planStatus(plan.diagnostics) };
}

function generateValue(rule, identity, column, locale) {
  const parameters = rule.parameters;
  if (rule.kind.startsWith("semantic:")) {
    return generatePersonSyntheticValue(rule.kind.slice("semantic:".length), identity, locale);
  }
  switch (rule.kind) {
    case "integer": {
      const min = Number.isSafeInteger(parameters.min) ? parameters.min : parameters.defaultMin;
      const max = Number.isSafeInteger(parameters.max) ? parameters.max : parameters.defaultMax;
      return Number(randomBigIntBelow(BigInt(max) - BigInt(min) + 1n, [...identity, "integer"]) + BigInt(min));
    }
    case "decimal": {
      const precision = parameters.precision;
      const scale = parameters.scale;
      const units = randomBigIntBelow(10n ** BigInt(precision), [...identity, "decimal"]);
      return formatDecimal(units, scale);
    }
    case "varchar": {
      const schemaMax = parameters.schemaMaxLength;
      const maxLength = Math.min(parameters.maxLength ?? 16, schemaMax ?? 16);
      const length = Number(randomBigIntBelow(BigInt(maxLength), [...identity, "string-length"])) + 1;
      let output = "";
      for (let index = 0; index < length; index += 1) {
        const slot = [...identity, `character-${index}`];
        const charIndex = Number(randomBigIntBelow(BigInt(STRING_ALPHABET.length), slot));
        output += STRING_ALPHABET[charIndex];
      }
      return output;
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
      return formatTimestamp(value, precision);
    }
    default:
      throw new Error(`No generator is available for rule ${rule.kind}`);
  }
}

function formatDecimal(units, scale) {
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
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

function formatTimestamp(value, precision) {
  const iso = new Date(value).toISOString();
  if (precision >= 3) return iso;
  if (precision === 0) return iso.replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/\.(\d{3})Z$/, (_match, fraction) => `.${fraction.slice(0, precision)}Z`);
}

function randomUnit(identity) {
  const digest = digestFor(identity);
  const top53Bits = digest.readBigUInt64BE(0) >> 11n;
  return Number(top53Bits) / 9_007_199_254_740_992;
}

function randomBigIntBelow(exclusiveMax, identity) {
  if (exclusiveMax <= 0n) throw new Error("Random range must have a positive width");
  const bitCount = exclusiveMax.toString(2).length;
  const byteCount = Math.ceil(bitCount / 8);
  const mask = (1n << BigInt(bitCount)) - 1n;
  let bytes = Buffer.alloc(0);
  let block = 0;
  while (bytes.length < byteCount) {
    bytes = Buffer.concat([bytes, digestFor([...identity, `block-${block}`])]);
    block += 1;
  }
  const candidate = BigInt(`0x${bytes.subarray(0, byteCount).toString("hex")}`) & mask;
  return candidate % exclusiveMax;
}

function digestFor(identity) {
  return createHash("sha256")
    .update(JSON.stringify(["SchemaSeed", "sha256-addressed-v1", ...identity]), "utf8")
    .digest();
}
