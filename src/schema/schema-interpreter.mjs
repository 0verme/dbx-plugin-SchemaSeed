const INTEGER_TYPES = new Map([
  ["tinyint", 127],
  ["smallint", 32_767],
  ["int2", 32_767],
  ["smallserial", 32_767],
  ["mediumint", 8_388_607],
  ["int", 2_147_483_647],
  ["integer", 2_147_483_647],
  ["int4", 2_147_483_647],
  ["serial", 2_147_483_647],
  ["bigint", Number.MAX_SAFE_INTEGER],
  ["int8", Number.MAX_SAFE_INTEGER],
  ["bigserial", Number.MAX_SAFE_INTEGER],
]);

/**
 * Declared string-family types, keyed by type token, never by database name.
 * `text` is intrinsically unbounded; `varchar` / `character varying` /
 * `nvarchar` / `string` establish a maximum only through an explicit typmod
 * `(n)` or structured length metadata.
 */
const STRING_TYPE_PATTERN = /^(varchar|character varying|nvarchar|string|text)(?:\s*\(\s*(\d+)\s*\))?$/;

/**
 * Native textual types whose database semantics do not include an explicit
 * maximum length. Future dialect paths (for example longtext / clob) extend
 * this set without introducing database-name branches in the Workbench or the
 * generators.
 */
const NATIVE_UNBOUNDED_STRING_TYPES = new Set(["text"]);

/**
 * @typedef {{ model: "bounded", maxLength: number, source: "structured-length" | "declared-type" }
 *   | { model: "unbounded", source: "native-text-type" | "explicit-no-length" }
 *   | { model: "unknown", factState: string, reason: string }
 *   | { model: "invalid", reason: string }} StringCapacity
 */

/**
 * Interpret only the database type family. Column names never select semantic
 * generators; business concepts belong to the future Semantic layer.
 *
 * For `varchar`, the returned `capacity` distinguishes a proven maximum from
 * an intrinsically unbounded type and from metadata that proves neither. It
 * is SchemaSeed's string capacity semantics, not a fabricated database limit.
 *
 * @param {import("./schema-model.mjs").ColumnSchema} column
 * @returns {{ kind: string, parameters: Record<string, unknown>, capacity?: StringCapacity } | null}
 */
export function interpretColumnType(column) {
  if (column.dataType.state !== "known" || typeof column.dataType.value !== "string") return null;

  const declared = column.dataType.value.trim().toLowerCase();
  const unsigned = /\bunsigned\b/.test(declared);
  const base = normalizeDeclaredType(declared);

  const integerName = base.match(/^(tinyint|smallint|int2|smallserial|mediumint|int|integer|int4|serial|bigint|int8|bigserial)(?:\s*\(\s*\d+\s*\))?$/)?.[1];
  if (integerName) {
    const max = INTEGER_TYPES.get(integerName);
    return {
      kind: "integer",
      parameters: {
        schemaMin: unsigned ? 0 : -max - 1,
        schemaMax: unsigned ? Math.min(max * 2 + 1, Number.MAX_SAFE_INTEGER) : max,
      },
    };
  }

  if (/^(decimal|numeric|number)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/.test(base)) {
    return { kind: "decimal", parameters: {} };
  }
  const stringType = base.match(STRING_TYPE_PATTERN);
  if (stringType) {
    return {
      kind: "varchar",
      parameters: {},
      capacity: classifyStringCapacity(column, stringType[1], stringType[2] === undefined ? null : Number(stringType[2])),
    };
  }
  if (/^(boolean|bool)$/.test(base)) return { kind: "boolean", parameters: {} };
  if (/^date$/.test(base)) return { kind: "date", parameters: {} };
  if (/^(timestamp|datetime)(?:\s*\(\s*\d+\s*\))?(?:\s+(?:with|without) time zone)?$/.test(base)) {
    return { kind: "timestamp", parameters: {} };
  }
  return null;
}

/**
 * Classify string capacity for callers that only hold the column. Returns
 * `null` when the column is not a supported string-family type.
 *
 * Classification order:
 *  1. structured length metadata that is `known` (authoritative when valid);
 *  2. an explicit declared typmod `(n)` — declared schema syntax, used when
 *     the driver omits structured length (for example SQLite);
 *  3. a native unbounded textual type such as `text`;
 *  4. `absent` / `not_applicable` length facts, which assert no explicit bound;
 *  5. otherwise `unknown`: the type proves neither bounded nor unbounded, so
 *     the caller must keep a conservative capacity diagnostic.
 *
 * @param {import("./schema-model.mjs").ColumnSchema} column
 * @returns {StringCapacity | null}
 */
export function interpretStringCapacity(column) {
  if (column.dataType.state !== "known" || typeof column.dataType.value !== "string") return null;
  const base = normalizeDeclaredType(column.dataType.value.trim().toLowerCase());
  const match = base.match(STRING_TYPE_PATTERN);
  if (!match) return null;
  return classifyStringCapacity(column, match[1], match[2] === undefined ? null : Number(match[2]));
}

/** @param {string} declared */
function normalizeDeclaredType(declared) {
  return declared
    .replace(/\bunsigned\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {import("./schema-model.mjs").ColumnSchema} column
 * @param {string} token
 * @param {number | null} declaredLength
 * @returns {StringCapacity}
 */
function classifyStringCapacity(column, token, declaredLength) {
  const fact = column.length;
  if (fact?.state === "known") {
    if (!Number.isSafeInteger(fact.value) || fact.value <= 0) {
      return { model: "invalid", reason: `varchar length must be a positive safe integer; received ${String(fact.value)}` };
    }
    return { model: "bounded", maxLength: fact.value, source: "structured-length" };
  }
  if (declaredLength !== null) {
    if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
      return { model: "invalid", reason: `declared varchar length must be a positive integer; received ${String(declaredLength)}` };
    }
    return { model: "bounded", maxLength: declaredLength, source: "declared-type" };
  }
  if (NATIVE_UNBOUNDED_STRING_TYPES.has(token)) {
    return { model: "unbounded", source: "native-text-type" };
  }
  if (fact?.state === "absent" || fact?.state === "not_applicable") {
    return { model: "unbounded", source: "explicit-no-length" };
  }
  const factState = fact?.state ?? "unknown";
  return {
    model: "unknown",
    factState,
    reason: `varchar capacity is unknown: the declared type does not include an explicit length and length metadata is ${factState}${fact?.reason ? `: ${fact.reason}` : ""}`,
  };
}
