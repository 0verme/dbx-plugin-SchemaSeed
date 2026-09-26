# Phase 1D — Deterministic Export Core + Workbench Save

## Scope and runtime

Phase 1D exports CSV / JSON / INSERT SQL from an already-generated dataset. It does not introduce generation rules, a second random path, a provider, a database connection, or a DBX adapter, and it is never a database write path. INSERT SQL is delivered by the packaged DBX Workbench because it needs the production database / schema / table reference; the standalone `npm run workbench` fixture harness keeps CSV / JSON. The production save path was verified end-to-end on DBX v0.6.23 (2026-09-26, SchemaSeed v0.2.4): each format opened the host native save dialog and wrote the file, and cancelling reported cancelled rather than saved — see the [Phase 1E runtime smoke record](PHASE1E_PRODUCTION_WORKBENCH.md#runtime-smoke-record).

## Architecture and dataset contract

```text
GenerationPlan
      ↓ generateRows(plan) — once per preview refresh
Generated result
      ↓ createExportDataset(plan, result, { table })
ExportDataset
   ├─ exportCsv(dataset)
   ├─ exportJson(dataset)
   └─ exportInsertSql(dataset)
      ↓ WorkbenchController prepareExport() descriptor { filename, mimeType, content, summary }
Production DBX Workbench → UTF-8 bytes → window.dbxPlugin.saveFile() → native save dialog → host writes the file
Standalone browser harness → Blob → object URL → <a download>
```

Export Core lives under `src/export/` and has no Workbench DOM, fixture-provider, DBX, host API, or database-driver dependency.

`ExportDataset` contains only:

- `tableIdentity`
- `table`: the database / schema / table reference captured with the snapshot (optional; required before INSERT SQL can run)
- `columns`: unique column names in explicit `TableSchema` order
- `rows`: generated scalar-value records with exactly those columns; missing and unexpected fields fail closed
- `generationContext`: seed, locale, row count, and determinism profile

`createExportDataset(plan, generatedResult, { table })` snapshots the ordered columns, the rows returned by the Core, and the current database / schema / table reference. It does not retain or copy the full GenerationPlan, diagnostics, semantic mappings, or unrelated provenance. Structural errors throw an `ExportError` with a stable code; they are not silently repaired or emitted as warnings.

## Preview / export consistency

On a successful refresh, the Workbench controller calls `generateRows(plan)` once and stores the resulting `ExportDataset` as `currentDataset`. Preview is rendered from `currentDataset.rows`; CSV, JSON and INSERT SQL serialize that same object. `prepareExport()` only serializes it and never calls `generateRows()`, rebuilds a plan/mapping, or creates Person values. Mapping, controls, fixture, and seed changes replace the dataset only through the regular plan → generation refresh. Same-plan regeneration is deterministic.

## CSV

- Header is included by default; column order always comes from `dataset.columns`, never `Object.keys(row)`.
- Records use CRLF separators. Fields containing comma, double quote, CR, or LF are quoted; embedded quotes are doubled. Embedded line breaks remain inside their quoted field.
- `null` becomes an empty field by default. The Core API optionally accepts a literal `nullToken`; Workbench uses the empty default.
- Output is Unicode text intended to be encoded as UTF-8. The Core API defaults to no BOM; the production Workbench CSV export explicitly enables a UTF-8 BOM for Windows / Excel compatibility, including Chinese Safe Synthetic values.
- `mode: "raw"` preserves string values. `mode: "spreadsheet_safe"` prefixes a leading apostrophe to any string beginning with `=`, `+`, `-`, or `@` (including headers). Workbench exports use `spreadsheet_safe` by default. This is an explicit serialization-only mitigation, not a change to generated data; Preview and JSON are unchanged. It cannot guarantee uniform treatment by every spreadsheet product.

## JSON

- Output is a JSON array of row objects, pretty-printed by default (2 spaces); compact output is available with `pretty: false`.
- `dataset.columns` controls object-field serialization order.
- `null` and booleans remain their JSON types; integer values remain numbers.
- Core decimal values are exact decimal strings and remain strings; the exporter never converts them to JavaScript `Number`.
- Date and timestamp values remain Core-produced strings. JSON has no BOM.

Neither format embeds seed, locale, diagnostics, GenerationPlan, or semantic mappings. Small export summary metadata is returned separately for the Workbench UI.

## INSERT SQL

- Every preview row becomes exactly one plain `INSERT INTO ... VALUES (...)` statement; a header comment records the serializer name, the qualified table and the row count. Multi-row `VALUES (...), (...)` is deliberately not used in v0.2.2 so the output stays compatible with the widest set of statement-based import paths.
- `null` is `NULL`; strings use single quotes with `'` doubled; numbers stay unquoted; the empty string stays `''`; booleans use `TRUE` / `FALSE`; date / timestamp values are emitted as their Core-produced strings.
- A string containing a NUL character fails closed with `export_serialization_failed`; no SQL is emitted for it.
- Statements never include `UPSERT` / `MERGE` / `ON CONFLICT` / `ON DUPLICATE KEY` / `TRUNCATE` / `DELETE` / `DROP` / `CREATE TABLE` and are never executed.

### Identifier quoting and dialect boundary

DBX Host API 1.3 does not expose the target database type, so SchemaSeed cannot select a dialect-specific identifier quote. The documented minimum is:

- plain lower-case names that are not in the frozen cross-dialect reserved-word set are emitted unquoted (accepted by PostgreSQL, MySQL, SQLite, Oracle, SQL Server, GaussDB, DB2, ...);
- every other name is emitted as an ANSI double-quoted identifier with `"` doubled;
- the table is qualified as `schema.table` when the TableContext has a schema, otherwise `database.table` when only a database namespace exists, otherwise `table`; `database.schema.table` is never emitted together because drivers such as PostgreSQL reject it.

ANSI double quotes work for PostgreSQL, Oracle, GaussDB, SQLite, DB2 and SQL Server. MySQL only treats double quotes as identifier quotes in `ANSI_QUOTES` mode; with the default `sql_mode` the fallback quoting has driver-dependent behavior. SQL-standard `TRUE` / `FALSE` literals are accepted by the verified PostgreSQL / MySQL / SQLite targets; boolean columns on Oracle before 23c and SQL Server need a dialect-specific representation. Those are tracked as Future Work for a dialect-aware serializer once the Host exposes the database type, and are stated in the README, Issue and release notes rather than hidden.

## Filename and save boundary

Filenames use the deterministic form `schemaseed-<sanitized-table>-<row-count>rows.<csv|json|sql>`. Table identity is normalized to a safe basename containing Unicode letters/digits, `_`, and `-`; path separators, traversal dots, and platform-reserved punctuation are removed. Seed is deliberately excluded.

The controller returns `{ filename, mimeType, content, summary }`. The UI does not serialize data.

The production DBX Workbench runs inside a sandboxed iframe, where the browser `Blob` → object URL → `<a download>` pattern cannot reach the OS save dialog or the disk. It therefore saves through the public DBX Host bridge: `ui/generation-workbench/export-save.mjs` encodes `descriptor.content` as UTF-8 bytes and calls `window.dbxPlugin.saveFile({ fileName, contentType }, bytes)`. The host opens the native save dialog and writes the file; the UI reports saved / cancelled / failed from the host result (a null result means the user cancelled). When the runtime exposes no `saveFile` host method, the production Workbench fails closed with an upgrade hint instead of falling back to a browser download. This adapter is deliberately UI-layer: `src/export/` stays free of DBX Host API dependencies.

The standalone browser development harness (`web/`, not part of the `.dbxp` package) keeps its own Blob download path; it is a normal browser page, not the sandboxed plugin iframe.

Neither path writes arbitrary filesystem paths or uses Node filesystem APIs for user data.

## Availability and diagnostics

Export buttons are enabled only after successful preview generation with a non-blocked plan and at least one row. Both `ready` and `ready_with_warnings` are exportable; warnings remain in the Workbench and are not added as data columns. Blocked plans, generation errors, missing datasets, invalid columns, row shape mismatches, serialization failures, and host save failures fail closed with codes including `export_no_dataset`, `export_blocked_plan`, `export_invalid_columns`, `export_row_shape_mismatch`, `export_serialization_failed`, `export_no_table_reference`, `export_host_save_unavailable`, and `export_host_save_failed`.

The Safe Synthetic notice remains visible in the Workbench; no confirmation dialog is required for each export.

## DBX integration boundary

Export Core modules have no DBX, Host API or database-driver dependency. INSERT SQL needs only the database / schema / table reference already carried by the Workbench TableContext, not a live host call. Upstream `t8y2/dbx#10043` merged during Phase 1D; the consumer probe is a separate Phase 0 task and does not expand Phase 1D scope. Phase 1D does not implement `host.getTableMetadata`, `host.schema:read`, `schemaMetadataApi`, `DbxHostSchemaMetadataProvider`, or database access.

## Out of scope

- production DBX metadata adapter and Workbench packaging (implemented on the #30 / #31 tracks, not by Phase 1D)
- PK / UNIQUE / CHECK / FK, Relation Planner, and SCD
- Direct database writes or a filesystem save-path picker
- dialect-aware SQL serialization beyond the documented minimum above
