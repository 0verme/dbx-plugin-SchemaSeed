const SQL_BIGINT_MIN = -(1n << 63n);
const SQL_BIGINT_MAX = (1n << 63n) - 1n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = -MAX_SAFE_INTEGER_BIGINT;
const TAG_KEY = "$schemaSeedType";
const TAG_KIND = "sql-bigint";
const VALUE_KEY = "value";
const CANONICAL_DECIMAL = /^(?:0|-?[1-9]\d*)$/u;

/**
 * JSON-compatible, explicitly tagged exact SQL BIGINT scalar. Safe integers
 * continue to use JavaScript numbers; only values outside the safe-integer
 * range need this representation.
 *
 * @typedef {{ $schemaSeedType: "sql-bigint", value: string }} SqlBigIntValue
 */

/** @returns {bigint} */
export function sqlBigIntMinimum() {
  return SQL_BIGINT_MIN;
}

/** @returns {bigint} */
export function sqlBigIntMaximum() {
  return SQL_BIGINT_MAX;
}

/** @param {unknown} value */
export function isSqlBigIntValue(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes(TAG_KEY) || !keys.includes(VALUE_KEY)) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return false;
  }
  if (value[TAG_KEY] !== TAG_KIND || typeof value[VALUE_KEY] !== "string"
    || value[VALUE_KEY].length > 20 || !CANONICAL_DECIMAL.test(value[VALUE_KEY])) return false;
  try {
    const exact = BigInt(value[VALUE_KEY]);
    return exact.toString() === value[VALUE_KEY] && exact >= SQL_BIGINT_MIN && exact <= SQL_BIGINT_MAX
      && (exact < MIN_SAFE_INTEGER_BIGINT || exact > MAX_SAFE_INTEGER_BIGINT);
  } catch {
    return false;
  }
}

/**
 * Return the exact value represented by a safe number or tagged BIGINT. Plain
 * decimal strings are deliberately not accepted by Core; callers that parse a
 * type-aware text field must convert them explicitly first.
 * @param {unknown} value
 * @returns {bigint | null}
 */
export function sqlIntegerToBigInt(value) {
  if (Number.isSafeInteger(value)) return BigInt(value);
  if (isSqlBigIntValue(value)) return BigInt(value.value);
  return null;
}

/** @param {bigint} value @returns {number | SqlBigIntValue} */
export function sqlIntegerFromBigInt(value) {
  if (typeof value !== "bigint" || value < SQL_BIGINT_MIN || value > SQL_BIGINT_MAX) {
    throw new RangeError("SQL BIGINT value is outside the signed 64-bit range");
  }
  if (value >= MIN_SAFE_INTEGER_BIGINT && value <= MAX_SAFE_INTEGER_BIGINT) return Number(value);
  return Object.freeze({ [TAG_KEY]: TAG_KIND, [VALUE_KEY]: value.toString() });
}

/**
 * Parse type-aware integer text without passing through Number. Leading zeros
 * and an optional plus sign are accepted as input and normalized canonically.
 * @param {string} text
 */
export function parseSqlIntegerText(text) {
  const token = typeof text === "string" ? text.trim() : "";
  if (!/^[+-]?\d+$/u.test(token)) return { ok: false, reason: "invalid-integer" };
  if (token.replace(/^[+-]/u, "").length > 19) return { ok: false, reason: "integer-range" };
  try {
    const exact = BigInt(token);
    if (exact < SQL_BIGINT_MIN || exact > SQL_BIGINT_MAX) return { ok: false, reason: "integer-range" };
    return { ok: true, value: sqlIntegerFromBigInt(exact) };
  } catch {
    return { ok: false, reason: "integer-range" };
  }
}

/** @param {unknown} value */
export function sqlIntegerText(value) {
  const exact = sqlIntegerToBigInt(value);
  if (exact === null) throw new TypeError("A safe integer or tagged SQL BIGINT value is required");
  return exact.toString();
}

/** JSON contract: unsafe SQL BIGINT values are decimal strings, not JSON numbers. @param {unknown} value */
export function sqlIntegerJsonValue(value) {
  return isSqlBigIntValue(value) ? value.value : value;
}
