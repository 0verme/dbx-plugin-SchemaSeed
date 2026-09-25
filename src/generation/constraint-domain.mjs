import { formatDecimalUnits, formatTimestamp, parseTimestamp } from "./generation-rules.mjs";
import { toHex } from "./sha256.mjs";

const STRING_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DAY_MS = 86_400_000n;
const DEFAULT_DATE_MIN = Date.parse("2000-01-01T00:00:00.000Z");
const DEFAULT_DATE_MAX = Date.parse("2030-12-31T00:00:00.000Z");
const DEFAULT_TIMESTAMP_MIN = Date.parse("2000-01-01T00:00:00.000Z");
const DEFAULT_TIMESTAMP_MAX = Date.parse("2035-12-31T23:59:59.999Z");

/** Build a finite, directly indexable domain or explain why it cannot be proved. */
export function describeConstraintDomain(columnPlan, rowCount) {
  const { rule, schema } = columnPlan;
  const p = rule.parameters ?? {};
  const known = (kind, capacity, decode, extra = {}) => ({ state: "known", kind, capacity, decode, ...extra });
  const unsupported = (reason) => ({ state: "cannot_prove", kind: rule.kind, reason });

  switch (rule.kind) {
    case "constant":
      return p.value === null
        ? known("null_only", 0n, () => null, { nullOnly: true })
        : known("constant", 1n, () => p.value);
    case "sequence": {
      const capacity = p.numericKind === "decimal"
        ? (BigInt(p.stepUnits) === 0n ? 1n : BigInt(rowCount))
        : (BigInt(p.step) === 0n ? 1n : BigInt(rowCount));
      return known("sequence", capacity, (index) => {
        if (p.numericKind === "decimal") return formatDecimalUnits(BigInt(p.startUnits) + BigInt(p.stepUnits) * index, p.scale);
        const value = BigInt(p.start) + BigInt(p.step) * index;
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error("Integer Sequence exceeded safe numeric representation");
        return number;
      }, { intrinsicUnique: p.numericKind === "decimal" ? BigInt(p.stepUnits) !== 0n : BigInt(p.step) !== 0n });
    }
    case "random_integer":
      return known("integer_range", BigInt(p.max) - BigInt(p.min) + 1n, (index) => Number(BigInt(p.min) + index));
    case "random_decimal": {
      const min = BigInt(p.minUnits);
      const max = BigInt(p.maxUnits);
      return known("decimal_range", max - min + 1n, (index) => formatDecimalUnits(min + index, p.scale));
    }
    case "random_string":
      return stringDomain(BigInt(p.length));
    case "enum": {
      const values = p.values.filter((value) => value !== null && value !== undefined);
      return known("enum", BigInt(values.length), (index) => values[Number(index)], { values });
    }
    case "boolean_ratio": {
      const values = p.trueRatio === 0 ? [false] : p.trueRatio === 1 ? [true] : [false, true];
      return known("boolean", BigInt(values.length), (index) => values[Number(index)], { values });
    }
    case "date_range": {
      const start = parseDate(p.start);
      const end = parseDate(p.end);
      if (start === null || end === null) return unsupported("Date Range bounds are not indexable");
      const capacity = BigInt(Math.floor((end - start) / Number(DAY_MS)) + 1);
      return known("date", capacity, (index) => new Date(start + Number(index * DAY_MS)).toISOString().slice(0, 10));
    }
    case "timestamp_range": {
      const start = parseTimestamp(p.start);
      const end = parseTimestamp(p.end);
      if (!start || !end) return unsupported("Timestamp Range bounds are not indexable");
      const precision = schema.precision.state === "known" ? schema.precision.value : 3;
      const quantum = 10n ** BigInt(9 - precision);
      const capacity = (end.nanoseconds - start.nanoseconds) / quantum + 1n;
      return known("timestamp", capacity, (index) => formatTimestamp(start.nanoseconds + index * quantum, precision));
    }
    case "uuid":
      return uuidDomain();
    case "integer": {
      const min = Number.isSafeInteger(p.min) ? p.min : p.defaultMin;
      const max = Number.isSafeInteger(p.max) ? p.max : p.defaultMax;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) return unsupported("Integer fallback bounds are not finite");
      return known("integer_range", BigInt(max) - BigInt(min) + 1n, (index) => Number(BigInt(min) + index));
    }
    case "decimal": {
      if (!Number.isSafeInteger(p.precision) || !Number.isSafeInteger(p.scale)) return unsupported("Decimal precision/scale are not known");
      const capacity = 10n ** BigInt(p.precision);
      return known("decimal_units", capacity, (index) => formatDecimalUnits(index, p.scale));
    }
    case "varchar": {
      const schemaMax = p.schemaMaxLength;
      const maximum = Math.min(Number.isSafeInteger(p.maxLength) ? p.maxLength : 16,
        Number.isSafeInteger(schemaMax) ? schemaMax : 16);
      if (!Number.isSafeInteger(maximum) || maximum <= 0) return unsupported("Varchar length is not a usable finite bound");
      let capacity = 0n;
      let width = BigInt(STRING_ALPHABET.length);
      for (let length = 1; length <= maximum; length += 1) {
        capacity += width;
        width *= BigInt(STRING_ALPHABET.length);
      }
      return known("varchar_strings", capacity, (index) => decodeVariableString(index, maximum));
    }
    case "boolean":
      return known("boolean", 2n, (index) => index === 1n);
    case "date": {
      const start = p.min === undefined ? DEFAULT_DATE_MIN : parseDate(p.min);
      const end = p.max === undefined ? DEFAULT_DATE_MAX : parseDate(p.max);
      if (start === null || end === null || start > end) return unsupported("Date fallback bounds are not indexable");
      const capacity = BigInt(Math.floor((end - start) / Number(DAY_MS)) + 1);
      return known("date", capacity, (index) => new Date(start + Number(index * DAY_MS)).toISOString().slice(0, 10));
    }
    case "timestamp": {
      const start = p.min === undefined ? DEFAULT_TIMESTAMP_MIN : Date.parse(p.min);
      const end = p.max === undefined ? DEFAULT_TIMESTAMP_MAX : Date.parse(p.max);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return unsupported("Timestamp fallback bounds are not indexable");
      const precision = schema.precision.state === "known" ? schema.precision.value : 3;
      const quantumMs = precision < 3 ? 10 ** (3 - precision) : 1;
      const capacity = BigInt(Math.floor((end - start) / quantumMs) + 1);
      return known("timestamp", capacity, (index) => formatTimestamp(BigInt(start + Number(index) * quantumMs) * 1_000_000n, precision));
    }
    default:
      return unsupported(rule.kind.startsWith("semantic:")
        ? "Semantic generation does not expose an enumerable, collision-free domain"
        : `Generation strategy ${rule.kind} does not expose an enumerable, collision-free domain`);
  }
}

function stringDomain(length) {
  if (length < 1n || length > 100_000n) return { state: "cannot_prove", kind: "random_string", reason: "Random String length is outside the safely indexable range" };
  return {
    state: "known",
    kind: "fixed_strings",
    capacity: BigInt(STRING_ALPHABET.length) ** length,
    decode: (index) => decodeString(index, Number(length)),
  };
}

function uuidDomain() {
  return {
    state: "known",
    kind: "uuid",
    capacity: 1n << 122n,
    decode: encodeUuid,
  };
}

function decodeVariableString(index, maximum) {
  let remaining = index;
  let count = BigInt(STRING_ALPHABET.length);
  for (let length = 1; length <= maximum; length += 1) {
    if (remaining < count) return decodeString(remaining, length);
    remaining -= count;
    count *= BigInt(STRING_ALPHABET.length);
  }
  throw new Error("Varchar allocation index exceeded its planned domain");
}

function decodeString(index, length) {
  const base = BigInt(STRING_ALPHABET.length);
  const chars = Array(length).fill(STRING_ALPHABET[0]);
  let remaining = index;
  for (let position = length - 1; position >= 0; position -= 1) {
    chars[position] = STRING_ALPHABET[Number(remaining % base)];
    remaining /= base;
  }
  if (remaining !== 0n) throw new Error("String allocation index exceeded its planned domain");
  return chars.join("");
}

function encodeUuid(index) {
  if (index < 0n || index >= (1n << 122n)) throw new Error("UUID allocation index exceeded its planned domain");
  const bytes = new Uint8Array(16);
  const positions = [];
  for (let bit = 0; bit < 48; bit += 1) positions.push([bit >> 3, 7 - (bit & 7)]);
  for (let bit = 3; bit >= 0; bit -= 1) positions.push([6, bit]);
  for (let bit = 7; bit >= 0; bit -= 1) positions.push([7, bit]);
  for (let bit = 5; bit >= 0; bit -= 1) positions.push([8, bit]);
  for (let byte = 9; byte < 16; byte += 1) for (let bit = 0; bit < 8; bit += 1) positions.push([byte, 7 - bit]);
  for (let bit = 0; bit < positions.length; bit += 1) {
    if (((index >> BigInt(positions.length - bit - 1)) & 1n) === 1n) {
      const [byte, shift] = positions[bit];
      bytes[byte] |= 1 << shift;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? millis : null;
}
