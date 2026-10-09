/** Parse strict JSON editor input; only an array is a valid enum value list. @param {string} text */
export function parseCandidateJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  return Array.isArray(value)
    ? { ok: true, values: value }
    : { ok: false, reason: "not-array" };
}

/**
 * Parse pasted tag-input text without guessing about complex comma content.
 * JSON arrays are always interpreted with JSON semantics; ambiguous comma
 * input retains the exact source text and offers explicit alternatives.
 * @param {string} text
 */
export function parseCandidatePaste(text) {
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
  if (validJson && Array.isArray(parsedJson)) return { kind: "values", source: "json", values: parsedJson };
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
    if (simple) return { kind: "values", source: "comma", values: parts };
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

/** @param {{ key?: string, isComposing?: boolean, keyCode?: number }} event */
export function shouldAddCandidateOnEnter(event) {
  return event?.key === "Enter" && event.isComposing !== true && event.keyCode !== 229;
}

/** @param {{ key?: string, value?: string, isComposing?: boolean, keyCode?: number }} event @param {number} candidateCount */
export function shouldRemoveLastCandidateOnBackspace(event, candidateCount) {
  return event?.key === "Backspace" && event.value === "" && event.isComposing !== true
    && event.keyCode !== 229 && Number.isSafeInteger(candidateCount) && candidateCount > 0;
}
