/** Parse strict JSON editor input; only an array is a valid enum value list. @param {string} text @param {string} [schemaFamily] */
export function parseCandidateJson(text, schemaFamily) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!Array.isArray(value)) return { ok: false, reason: "not-array" };
  if (schemaFamily === "integer") {
    const numericError = validateIntegerJsonNumbers(text);
    if (numericError) return { ok: false, reason: numericError };
  }
  return { ok: true, values: value };
}

/**
 * JSON.parse rounds numeric tokens to IEEE-754 before Core validation. For
 * integer fields, prove each JSON number denotes the exact safe integer that
 * JSON.parse can carry; otherwise leave the raw JSON draft untouched and block
 * committing it. Strings are skipped and retain their normal JSON semantics.
 * @param {string} text
 */
function validateIntegerJsonNumbers(text) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== "-" && (character < "0" || character > "9")) continue;
    const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (!match) continue;
    const result = exactSafeIntegerFromJsonToken(match[0]);
    if (!result.ok) return result.reason;
    index += match[0].length - 1;
  }
  return null;
}

/** @param {string} token */
function exactSafeIntegerFromJsonToken(token) {
  const match = token.match(/^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u);
  if (!match) return { ok: false, reason: "integer-range" };
  const [, sign, whole, fraction = "", exponentText = "0"] = match;
  let digits = `${whole}${fraction}`.replace(/^0+(?=\d)/u, "");
  if (/^0+$/u.test(digits)) return { ok: true, value: 0n };
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return { ok: false, reason: "integer-range" };
  const scale = fraction.length - exponent;
  if (scale > 0) {
    if (scale >= digits.length) return { ok: false, reason: "invalid-integer" };
    const fractionalDigits = digits.slice(-scale);
    if (/[1-9]/u.test(fractionalDigits)) return { ok: false, reason: "invalid-integer" };
    digits = digits.slice(0, -scale) || "0";
  } else if (scale < 0) {
    if (digits.length - scale > String(Number.MAX_SAFE_INTEGER).length) return { ok: false, reason: "integer-range" };
    digits += "0".repeat(-scale);
  }
  if (digits.length > String(Number.MAX_SAFE_INTEGER).length) return { ok: false, reason: "integer-range" };
  const exact = BigInt(`${sign}${digits}`);
  if (exact < -MAX_SAFE_INTEGER_BIGINT || exact > MAX_SAFE_INTEGER_BIGINT) {
    return { ok: false, reason: "integer-range" };
  }
  return { ok: true, value: exact };
}

/**
 * Parse pasted tag-input text without guessing about complex comma content.
 * JSON arrays are always interpreted with JSON semantics; ambiguous comma
 * input retains the exact source text and offers explicit alternatives.
 * @param {string} text
 */
export function parseCandidatePaste(text, schemaFamily) {
  if (typeof text !== "string" || text.length === 0) return { kind: "empty" };
  const trimmed = text.trim();
  if (trimmed === "" && !/[\r\n]/u.test(text)) return { kind: "single", values: [text] };

  let parsedJson;
  let validJson = false;
  try {
    parsedJson = JSON.parse(trimmed);
    validJson = true;
  } catch {
    // Plain text is handled below unless it has an explicit JSON container prefix.
  }
  if (validJson && Array.isArray(parsedJson)) {
    if (schemaFamily === "integer") {
      const numericError = validateIntegerJsonNumbers(trimmed);
      if (numericError) return { kind: "error", reason: numericError };
    }
    return { kind: "values", source: "json", values: parsedJson };
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith('"')) {
    return { kind: "error", reason: "json-array" };
  }

  if (/[\r\n]/u.test(text)) {
    const values = text.split(/\r\n|\r|\n/u);
    // A final line terminator is a separator, not an additional blank item.
    if (values.length > 1 && values.at(-1) === "") values.pop();
    return { kind: "values", source: "lines", values };
  }

  if (text.includes(",")) {
    const parts = text.split(",");
    const simple = !/["'\[\]{}\\]/u.test(text)
      && parts.every((part) => part.length > 0 && part === part.trim() && !/\s/u.test(part));
    if (simple && schemaFamily !== "integer" && schemaFamily !== "decimal") {
      return { kind: "values", source: "comma", values: parts };
    }
    return {
      kind: "ambiguous",
      text,
      splitValues: parts.map((part) => part.trim()),
      singleValue: text,
    };
  }

  return { kind: "single", values: [text] };
}

/** @param {unknown[]} current @param {unknown[]} additions */
export function appendCandidateValues(current, additions) {
  return [...current, ...additions];
}

/** @param {unknown[]} values @param {number} index */
export function removeCandidateValue(values, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) return [...values];
  return values.filter((_value, candidateIndex) => candidateIndex !== index);
}

/** Compare JSON candidate arrays while treating object property order as insignificant. @param {unknown} left @param {unknown} right */
export function candidateValuesEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  try {
    return JSON.stringify(canonicalCandidateValue(left)) === JSON.stringify(canonicalCandidateValue(right));
  } catch {
    return false;
  }
}

function canonicalCandidateValue(value) {
  if (Array.isArray(value)) return value.map(canonicalCandidateValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalCandidateValue(value[key])]));
  }
  return value;
}

const TAG_EDITABLE_FAMILIES = new Set(["varchar", "integer", "decimal", "boolean", "date", "timestamp"]);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const INTEGER_TEXT = /^[+-]?\d+$/u;
const DECIMAL_TEXT = /^[+-]?\d+(?:\.\d+)?$/u;

/**
 * Whether every current enum value can be displayed and edited as a scalar
 * token without changing its Core representation. Complex JSON values and
 * unsupported Core families stay in the JSON editor.
 * @param {string | null | undefined} schemaFamily
 * @param {unknown} values
 */
export function canEditEnumCandidatesAsTags(schemaFamily, values) {
  if (!TAG_EDITABLE_FAMILIES.has(schemaFamily) || !Array.isArray(values)) return false;
  return values.every((value) => {
    switch (schemaFamily) {
      case "varchar":
      case "date":
      case "timestamp":
        return typeof value === "string";
      case "integer":
        return Number.isSafeInteger(value);
      case "decimal": {
        if (typeof value !== "string") return false;
        const parsed = parseCandidateText(schemaFamily, value);
        return parsed.ok && parsed.value === value;
      }
      case "boolean":
        return typeof value === "boolean";
      default:
        return false;
    }
  });
}

/**
 * Parse one textual Tag Input token to the value type already required by the
 * Generation Core. In particular, integers are bounded with BigInt before
 * conversion to Number, and decimal values remain exact text.
 * @param {string} schemaFamily
 * @param {string} text
 */
export function parseCandidateText(schemaFamily, text) {
  if (typeof text !== "string") return { ok: false, reason: "invalid-value" };
  switch (schemaFamily) {
    case "varchar":
    case "date":
    case "timestamp":
      return { ok: true, value: text };
    case "integer": {
      const token = text.trim();
      if (!INTEGER_TEXT.test(token)) return { ok: false, reason: "invalid-integer" };
      const unsigned = token.replace(/^[+-]/u, "").replace(/^0+(?=\d)/u, "");
      if (unsigned.length > String(Number.MAX_SAFE_INTEGER).length) return { ok: false, reason: "integer-range" };
      const exact = BigInt(`${token.startsWith("-") ? "-" : ""}${unsigned}`);
      if (exact < -MAX_SAFE_INTEGER_BIGINT || exact > MAX_SAFE_INTEGER_BIGINT) {
        return { ok: false, reason: "integer-range" };
      }
      const value = Number(exact);
      return Number.isSafeInteger(value) && BigInt(value) === exact
        ? { ok: true, value }
        : { ok: false, reason: "integer-range" };
    }
    case "decimal": {
      const token = text.trim();
      return DECIMAL_TEXT.test(token)
        ? { ok: true, value: token }
        : { ok: false, reason: "invalid-decimal" };
    }
    case "boolean": {
      const token = text.trim().toLowerCase();
      if (token === "true") return { ok: true, value: true };
      if (token === "false") return { ok: true, value: false };
      return { ok: false, reason: "invalid-boolean" };
    }
    default:
      return { ok: false, reason: "unsupported-family" };
  }
}

/**
 * Parse a batch of paste candidates atomically. JSON numeric values are
 * rejected for decimal columns because JSON.parse has already discarded their
 * decimal lexemes; integer numbers are accepted only when safely representable.
 * @param {string} schemaFamily
 * @param {unknown[]} values
 */
export function parseCandidateValues(schemaFamily, values) {
  if (!Array.isArray(values)) return { ok: false, reason: "invalid-value", index: -1 };
  const parsed = [];
  for (const [index, value] of values.entries()) {
    const result = parseCandidateValue(schemaFamily, value);
    if (!result.ok) return { ...result, index };
    parsed.push(result.value);
  }
  return { ok: true, values: parsed };
}

/** @param {string} schemaFamily @param {unknown} value */
function parseCandidateValue(schemaFamily, value) {
  if (typeof value === "string") return parseCandidateText(schemaFamily, value);
  switch (schemaFamily) {
    case "integer":
      return Number.isSafeInteger(value)
        ? { ok: true, value }
        : { ok: false, reason: "integer-range" };
    case "decimal":
      return typeof value === "number"
        ? { ok: false, reason: "decimal-json-number" }
        : { ok: false, reason: "invalid-decimal" };
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { ok: false, reason: "invalid-boolean" };
    default:
      return { ok: false, reason: "invalid-value" };
  }
}

/** @param {{ key?: string, isComposing?: boolean, keyCode?: number }} event */
export function shouldAddCandidateOnEnter(event) {
  return event?.key === "Enter" && event.isComposing !== true && event.keyCode !== 229;
}

/** @param {{ key?: string, value?: string, isComposing?: boolean, keyCode?: number }} event @param {number} candidateCount */
export function shouldRemoveLastCandidateOnBackspace(event, candidateCount) {
  return event?.key === "Backspace" && event.value === "" && event.isComposing !== true
    && event.keyCode !== 229 && Number.isSafeInteger(candidateCount) && candidateCount > 0;
}
