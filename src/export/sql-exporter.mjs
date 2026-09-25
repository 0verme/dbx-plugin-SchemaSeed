import { ExportError, validateExportDataset } from "./export-dataset.mjs";

/**
 * INSERT SQL serializer for the frozen ExportDataset snapshot.
 *
 * Scope is deliberately small: one plain `INSERT INTO ... VALUES (...)` per
 * preview row. It never executes SQL, opens a database connection, batches rows
 * into one multi-row VALUES list, or emits UPSERT / MERGE / TRUNCATE / DELETE.
 */

/**
 * DBX Host API 1.3 does not expose the target database type, so SchemaSeed
 * cannot select a dialect-specific identifier quote. v0.2.2 uses this explicit
 * minimum instead of guessing:
 *
 * - `PLAIN_IDENTIFIER` names that are not reserved words are emitted unquoted;
 *   every tested driver (PostgreSQL, MySQL, SQLite, Oracle, SQL Server,
 *   GaussDB, DB2, ...) accepts plain lower-case unquoted identifiers.
 * - Every other name (reserved word, upper/mixed case, spaces, special
 *   characters, an embedded quote) is emitted as an ANSI double-quoted
 *   identifier, with `"` doubled.
 * - ANSI double quotes are accepted by PostgreSQL, Oracle, GaussDB, SQLite,
 *   DB2 and SQL Server; MySQL accepts them in ANSI_QUOTES mode. SchemaSeed
 *   cannot observe `sql_mode`, so a MySQL session using the default
 *   backtick-only mode may treat the fallback quoting differently. This is a
 *   documented dialect limit, not a silent promise, and is tracked as Future
 *   Work for a dialect-aware serializer once the Host exposes the database
 *   type.
 *
 * Over-quoting is not used for ordinary names because the same double-quote
 * fallback is the only alternative; keeping common names unquoted keeps the
 * generated script usable by the widest set of dialects.
 */
const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Conservative cross-dialect reserved-word set: heads of SQL:2016, PostgreSQL,
 * MySQL, SQLite and T-SQL reserved lists, frozen for identifier quoting only.
 * A name in this set is quoted; the list is intentionally not a dialect
 * framework and never changes value serialization.
 */
const RESERVED_WORDS = new Set([
  "abort", "absolute", "access", "action", "add", "after", "all", "alter", "analyse", "analyze",
  "and", "any", "array", "as", "asc", "asensitive", "assertion", "at", "attach", "authorization",
  "backup", "before", "begin", "between", "bigint", "binary", "bit", "blob", "boolean", "both",
  "break", "browse", "bulk", "by", "call", "cascade", "case", "cast", "catalog", "char",
  "character", "check", "checkpoint", "clob", "close", "clustered", "coalesce", "collate", "column",
  "commit", "compute", "condition", "conflict", "connect", "constraint", "contains", "containstable",
  "continue", "convert", "create", "cross", "cube", "current", "current_date", "current_time",
  "current_timestamp", "current_user", "cursor", "database", "date", "day", "dbcc", "deallocate",
  "dec", "decimal", "declare", "default", "deferrable", "deferred", "delete", "deny", "desc",
  "describe", "detach", "deterministic", "disk", "distinct", "distributed", "do", "domain",
  "double", "drop", "dual", "dump", "each", "else", "elseif", "enable", "end", "errlvl",
  "escape", "except", "exclusive", "exec", "execute", "exists", "exit", "explain", "external",
  "extract", "fail", "false", "fetch", "file", "fillfactor", "filter", "first", "float", "following",
  "for", "foreign", "freetext", "freetexttable", "from", "full", "fulltext", "function", "generated",
  "get", "glob", "grant", "group", "grouping", "groups", "having", "high_priority", "holdlock",
  "hour", "identity", "identity_insert", "identitycol", "if", "ignore", "ilike", "immediate", "in",
  "index", "indexed", "infile", "initially", "inner", "inout", "insensitive", "insert", "instead",
  "int", "integer", "intersect", "interval", "into", "is", "isnull", "join", "key", "keys",
  "kill", "last", "lateral", "leading", "leave", "left", "like", "limit", "lineno", "lines",
  "load", "local", "localtime", "localtimestamp", "lock", "loop", "low_priority", "match",
  "materialized", "mediumint", "merge", "middleint", "minute", "mod", "mode", "month", "national",
  "natural", "nchar", "next", "no", "nocheck", "nonclustered", "not", "nothing", "notnull", "nowait",
  "null", "nullif", "nulls", "numeric", "of", "off", "offsets", "on", "only", "open", "opendatasource",
  "openquery", "openrowset", "openxml", "option", "or", "order", "others", "out", "outer", "outfile",
  "over", "partition", "percent", "pivot", "placing", "plan", "position", "pragma", "preceding",
  "precision", "primary", "print", "proc", "procedure", "public", "purge", "query", "raise",
  "raiserror", "range", "rank", "read", "reads", "readtext", "real", "reconfigure", "recursive",
  "references", "regexp", "reindex", "release", "rename", "repeat", "replace", "replication",
  "require", "resignal", "restore", "restrict", "return", "returning", "returns", "revoke", "right",
  "rlike", "rollback", "row", "row_number", "rows", "rule", "save", "savepoint", "schema", "second",
  "securityaudit", "select", "sensitive", "separator", "session_user", "set", "setuser", "share",
  "show", "shutdown", "similar", "smallint", "some", "spatial", "specific", "sql", "sql_big_result",
  "sql_calc_found_rows", "sql_small_result", "sqlexception", "sqlstate", "sqlwarning", "ssl",
  "starting", "statistics", "straight_join", "symmetric", "table", "temp", "temporary", "terminated",
  "text", "textsize", "then", "ties", "time", "timestamp", "tinyblob", "tinyint", "tinytext", "to",
  "top", "trailing", "tran", "transaction", "trigger", "true", "truncate", "tsequal", "unbounded",
  "undo", "union", "unique", "unknown", "unlock", "unsigned", "update", "updatetext", "usage", "user",
  "using", "utc_date", "utc_time", "utc_timestamp", "vacuum", "values", "varbinary", "varchar",
  "varcharacter", "variadic", "varying", "verbose", "view", "virtual", "waitfor", "when", "where",
  "while", "window", "with", "without", "work", "write", "writetext", "xor", "year", "zerofill",
]);

/**
 * Quote one catalog / schema / table / column identifier for the documented
 * cross-dialect minimum. Exported so tests can pin the quoting contract.
 * @param {string} name
 * @returns {string}
 */
export function quoteSqlIdentifier(name) {
  if (typeof name !== "string" || name === "") {
    throw new ExportError("export_serialization_failed", "SQL identifiers must be non-empty strings");
  }
  if (PLAIN_IDENTIFIER.test(name) && !RESERVED_WORDS.has(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Serialize one scalar ExportDataset value as a SQL literal.
 *
 * - `null` becomes `NULL`; the empty string stays `''`.
 * - Strings quote with single quotes and double embedded quotes; a NUL
 *   character fails closed because many database text protocols cannot carry
 *   it inside a literal.
 * - Numbers stay unquoted. Core decimals are already exact decimal strings and
 *   stay strings, matching the CSV / JSON contract.
 * - Booleans use the SQL-standard `TRUE` / `FALSE` literals. The Host does not
 *   expose the database type, so this is the documented dialect limit; it is
 *   accepted by the verified PostgreSQL, MySQL and SQLite drivers.
 *
 * @param {string | number | boolean | null} value
 * @returns {string}
 */
export function sqlLiteral(value) {
  if (value === null) return "NULL";
  switch (typeof value) {
    case "boolean":
      return value ? "TRUE" : "FALSE";
    case "number":
      if (!Number.isFinite(value)) {
        throw new ExportError("export_serialization_failed", "SQL export cannot serialize a non-finite number");
      }
      return String(value);
    case "string":
      if (value.includes("\u0000")) {
        throw new ExportError("export_serialization_failed", "SQL export cannot serialize a string containing a NUL character");
      }
      return `'${value.replaceAll("'", "''")}'`;
    default:
      throw new ExportError("export_serialization_failed", `SQL export cannot serialize a ${typeof value} value`);
  }
}

/**
 * Serialize an existing ExportDataset as deterministic INSERT SQL text.
 * The dataset is the same frozen snapshot CSV / JSON consume; this function
 * never generates rows, rebuilds a plan, or touches a database.
 * @param {import("./export-dataset.mjs").ExportDataset} dataset
 * @param {{ header?: boolean }} [options]
 */
export function exportInsertSql(dataset, options = {}) {
  validateExportDataset(dataset);
  const { header = true } = options;
  if (typeof header !== "boolean") throw new TypeError("SQL options require a boolean header");
  if (!dataset.table) {
    throw new ExportError("export_no_table_reference", "INSERT SQL export requires the current database / schema / table reference");
  }

  try {
    const table = renderQualifiedTable(dataset.table);
    const columns = dataset.columns.map((column) => quoteSqlIdentifier(column));
    const statements = dataset.rows.map((row) => {
      const values = dataset.columns.map((column) => sqlLiteral(row[column]));
      return [
        `INSERT INTO ${table} (`,
        ...columns.map((column, index) => `    ${column}${index === columns.length - 1 ? "" : ","}`),
        ") VALUES (",
        ...values.map((value, index) => `    ${value}${index === values.length - 1 ? "" : ","}`),
        ");",
      ].join("\n");
    });
    const parts = [];
    if (header) {
      parts.push([
        "-- Generated by SchemaSeed",
        "-- Synthetic test data only",
        `-- Table: ${table}`,
        `-- Rows: ${dataset.rows.length}`,
      ].join("\n"));
    }
    parts.push(...statements);
    return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("export_serialization_failed", `INSERT SQL serialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Qualify with a schema when the driver has one, otherwise with the database
 * namespace (for example the MySQL database / SQLite attached name). The
 * connection database is never emitted next to a schema, because drivers such
 * as PostgreSQL do not accept `database.schema.table`.
 * @param {{ database: string | null, schema: string | null, table: string }} table
 */
function renderQualifiedTable(table) {
  const qualifier = table.schema ?? table.database ?? null;
  const name = quoteSqlIdentifier(table.table);
  return qualifier === null ? name : `${quoteSqlIdentifier(qualifier)}.${name}`;
}
