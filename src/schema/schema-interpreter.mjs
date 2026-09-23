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
 * Interpret only the database type family. Column names never select semantic
 * generators; business concepts belong to the future Semantic layer.
 * @param {import("./schema-model.mjs").ColumnSchema} column
 * @returns {{ kind: string, parameters: Record<string, unknown> } | null}
 */
export function interpretColumnType(column) {
  if (column.dataType.state !== "known" || typeof column.dataType.value !== "string") return null;

  const declared = column.dataType.value.trim().toLowerCase();
  const unsigned = /\bunsigned\b/.test(declared);
  const base = declared
    .replace(/\bunsigned\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

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
  if (/^(varchar|character varying|nvarchar|string|text)(?:\s*\(\s*\d+\s*\))?$/.test(base)) {
    return { kind: "varchar", parameters: {} };
  }
  if (/^(boolean|bool)$/.test(base)) return { kind: "boolean", parameters: {} };
  if (/^date$/.test(base)) return { kind: "date", parameters: {} };
  if (/^(timestamp|datetime)(?:\s*\(\s*\d+\s*\))?(?:\s+(?:with|without) time zone)?$/.test(base)) {
    return { kind: "timestamp", parameters: {} };
  }
  return null;
}
