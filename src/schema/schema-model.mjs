export const FACT_STATES = Object.freeze([
  "known",
  "absent",
  "not_applicable",
  "unknown",
  "unavailable",
  "unsupported",
  "failed",
]);

const factStateSet = new Set(FACT_STATES);

/**
 * SchemaSeed-owned schema facts. Scalar fixture values are normalized to
 * `{ state: "known", value }`; omitted values remain `unknown`.
 *
 * @typedef {{ state: "known", value: unknown } | { state: "absent" | "not_applicable" | "unknown" | "unavailable" | "unsupported" | "failed", reason?: string }} SchemaFact
 * @typedef {Object} ColumnSchema
 * @property {string} name
 * @property {SchemaFact} dataType
 * @property {SchemaFact} nullable
 * @property {SchemaFact} length
 * @property {SchemaFact} precision
 * @property {SchemaFact} scale
 * @property {SchemaFact} default
 * @property {SchemaFact} identity
 * @typedef {Object} TableSchema
 * @property {string} tableIdentity
 * @property {ColumnSchema[]} columns
 */

/**
 * Normalize a fixture/domain value without turning missing metadata into a
 * false, zero, empty string, or an asserted absence.
 * @param {unknown} raw
 * @returns {SchemaFact}
 */
export function schemaFact(raw) {
  if (raw === undefined || raw === null) {
    return Object.freeze({ state: "unknown", reason: "Metadata was not supplied with an explicit availability state" });
  }

  if (isRecord(raw) && Object.hasOwn(raw, "state")) {
    if (!factStateSet.has(raw.state)) {
      return Object.freeze({ state: "unsupported", reason: `Unknown fact state: ${String(raw.state)}` });
    }
    if (raw.state === "known") {
      if (!Object.hasOwn(raw, "value")) {
        return Object.freeze({ state: "unsupported", reason: "Known metadata fact has no value" });
      }
      return Object.freeze({ state: "known", value: raw.value });
    }
    return Object.freeze({ state: raw.state, ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}) });
  }

  return Object.freeze({ state: "known", value: raw });
}

/**
 * Convert project-owned fixture input into the internal domain model. This is
 * not a DBX DTO adapter and performs no host or database access.
 * @param {unknown} input
 * @returns {{ schema: TableSchema, issues: Array<{ code: string, column: string | null, reason: string }> }}
 */
export function normalizeTableSchema(input) {
  const issues = [];
  if (!isRecord(input)) {
    return {
      schema: Object.freeze({ tableIdentity: "<unknown-table>", columns: Object.freeze([]) }),
      issues: [{ code: "invalid_schema", column: null, reason: "Table schema must be an object" }],
    };
  }

  const hasTableIdentity = typeof input.tableIdentity === "string" && input.tableIdentity.trim() !== "";
  const tableIdentity = hasTableIdentity ? input.tableIdentity : "<unknown-table>";
  if (!hasTableIdentity) {
    issues.push({ code: "invalid_schema", column: null, reason: "tableIdentity must be a non-empty string" });
  }

  if (!Array.isArray(input.columns)) {
    issues.push({ code: "invalid_schema", column: null, reason: "columns must be an array" });
    return { schema: Object.freeze({ tableIdentity, columns: Object.freeze([]) }), issues };
  }

  if (input.columns.length === 0) {
    issues.push({ code: "invalid_schema", column: null, reason: "columns must contain at least one column" });
  }

  const columns = input.columns.map((rawColumn, index) => {
    if (!isRecord(rawColumn)) {
      issues.push({ code: "invalid_schema", column: `<column-${index}>`, reason: "Column schema must be an object" });
      return normalizeColumn({}, `<column-${index}>`);
    }

    const fallbackName = `<column-${index}>`;
    const hasName = typeof rawColumn.name === "string" && rawColumn.name.trim() !== "";
    const name = hasName ? rawColumn.name : fallbackName;
    if (!hasName) {
      issues.push({ code: "invalid_schema", column: name, reason: "Column name must be a non-empty string" });
    }
    return normalizeColumn(rawColumn, name);
  });

  return {
    schema: Object.freeze({ tableIdentity, columns: Object.freeze(columns) }),
    issues,
  };
}

function normalizeColumn(input, name) {
  return Object.freeze({
    name,
    dataType: schemaFact(input.dataType),
    nullable: schemaFact(input.nullable),
    length: schemaFact(input.length),
    precision: schemaFact(input.precision),
    scale: schemaFact(input.scale),
    default: schemaFact(input.default),
    identity: schemaFact(input.identity),
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
