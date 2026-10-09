/** @typedef {{ __schemaSeedJsonDocumentV1: true, value: unknown }} JsonDocumentValue */

const DOCUMENT_MARKER = "__schemaSeedJsonDocumentV1";
const MAX_JSON_DEPTH = 64;

/**
 * Preserve a database JSON document's root type inside the otherwise scalar
 * row-value contract. In particular, a document containing JSON `null` must
 * not be confused with SQL NULL, which remains JavaScript `null`.
 * @param {unknown} value
 */
export function createJsonDocumentValue(value) {
  return Object.freeze({ [DOCUMENT_MARKER]: true, value: normalizeJsonValue(value) });
}

/** @param {unknown} value */
export function isJsonDocumentValue(value) {
  return isRecord(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && value[DOCUMENT_MARKER] === true
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "value");
}

/** @param {unknown} value */
export function unwrapJsonDocumentValue(value) {
  if (!isJsonDocumentValue(value)) throw new TypeError("A SchemaSeed JSON document value is required");
  return value.value;
}

/** @param {unknown} value */
export function serializeJsonDocumentValue(value) {
  const serialized = JSON.stringify(unwrapJsonDocumentValue(value));
  if (typeof serialized !== "string") throw new TypeError("JSON document did not serialize to JSON text");
  return serialized;
}

/**
 * Validate and canonicalize an arbitrary JSON value. Object keys are sorted
 * and copied so explicit rule identity/output never depends on insertion order.
 * @param {unknown} value
 * @returns {unknown}
 */
export function normalizeJsonValue(value) {
  return normalize(value, new Set(), 0);
}

/** @param {unknown} value @param {Set<object>} ancestors @param {number} depth */
function normalize(value, ancestors, depth) {
  if (depth > MAX_JSON_DEPTH) throw new TypeError(`JSON value exceeds maximum nesting depth ${MAX_JSON_DEPTH}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`Unsupported JSON value type ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("JSON values cannot contain circular references");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes("length")) {
        throw new TypeError("JSON arrays cannot contain holes, symbols, or extra properties");
      }
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          throw new TypeError("JSON arrays must contain only indexed data values");
        }
        output.push(normalize(descriptor.value, ancestors, depth + 1));
      }
      return Object.freeze(output);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON objects must be plain objects");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("JSON objects cannot contain symbol keys");
    }
    const output = {};
    for (const key of /** @type {string[]} */ (keys).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError("JSON objects must contain only enumerable data properties");
      }
      Object.defineProperty(output, key, {
        value: normalize(descriptor.value, ancestors, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
