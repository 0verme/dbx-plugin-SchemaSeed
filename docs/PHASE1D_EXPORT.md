# Phase 1D — Deterministic Export Core + Workbench Download

## Scope and runtime

Phase 1D exports CSV and JSON from the fixture-driven Workbench's already-generated dataset. It does not introduce generation rules, a second random path, a provider, a database connection, or a DBX adapter. The Workbench remains a standalone browser development harness started with `npm run workbench`; it is not packaged in DBX.

## Architecture and dataset contract

```text
GenerationPlan
      ↓ generateRows(plan) — once per preview refresh
Generated result
      ↓ createExportDataset(plan, result)
ExportDataset
   ├─ exportCsv(dataset)
   └─ exportJson(dataset)
      ↓ WorkbenchController download descriptor
Browser Blob → object URL → <a download>
```

Export Core lives under `src/export/` and has no Workbench DOM, fixture-provider, DBX, host API, or database-driver dependency.

`ExportDataset` contains only:

- `tableIdentity`
- `columns`: unique column names in explicit `TableSchema` order
- `rows`: generated scalar-value records with exactly those columns; missing and unexpected fields fail closed
- `generationContext`: seed, locale, row count, and determinism profile

`createExportDataset(plan, generatedResult)` snapshots the ordered columns and the rows returned by the Core. It does not retain or copy the full GenerationPlan, diagnostics, semantic mappings, or unrelated provenance. Structural errors throw an `ExportError` with a stable code; they are not silently repaired or emitted as warnings.

## Preview / export consistency

On a successful refresh, `WorkbenchController` calls `generateRows(plan)` once and stores the resulting `ExportDataset` as `currentDataset`. Preview is rendered from `currentDataset.rows`; CSV and JSON serialize that same object. `prepareExport()` only serializes it and never calls `generateRows()`, rebuilds a plan/mapping, or creates Person values. Mapping, controls, fixture, and seed changes replace the dataset only through the regular plan → generation refresh. Same-plan regeneration is deterministic.

## CSV

- Header is included by default; column order always comes from `dataset.columns`, never `Object.keys(row)`.
- Records use CRLF separators. Fields containing comma, double quote, CR, or LF are quoted; embedded quotes are doubled. Embedded line breaks remain inside their quoted field.
- `null` becomes an empty field by default. The Core API optionally accepts a literal `nullToken`; Workbench uses the empty default.
- Output is Unicode text intended to be encoded as UTF-8. The Core API defaults to no BOM; Workbench CSV download explicitly enables a UTF-8 BOM for Windows / Excel compatibility, including Chinese Safe Synthetic values.
- `mode: "raw"` preserves string values. `mode: "spreadsheet_safe"` prefixes a leading apostrophe to any string beginning with `=`, `+`, `-`, or `@` (including headers). Workbench downloads use `spreadsheet_safe` by default. This is an explicit serialization-only mitigation, not a change to generated data; Preview and JSON are unchanged. It cannot guarantee uniform treatment by every spreadsheet product.

## JSON

- Output is a JSON array of row objects, pretty-printed by default (2 spaces); compact output is available with `pretty: false`.
- `dataset.columns` controls object-field serialization order.
- `null` and booleans remain their JSON types; integer values remain numbers.
- Core decimal values are exact decimal strings and remain strings; the exporter never converts them to JavaScript `Number`.
- Date and timestamp values remain Core-produced strings. JSON has no BOM.

Neither format embeds seed, locale, diagnostics, GenerationPlan, or semantic mappings. Small export summary metadata is returned separately for the Workbench UI.

## Filename and download boundary

Filenames use the deterministic form `schemaseed-<sanitized-table>-<row-count>rows.<csv|json>`. Table identity is normalized to a safe basename containing Unicode letters/digits, `_`, and `-`; path separators, traversal dots, and platform-reserved punctuation are removed. Seed is deliberately excluded.

The controller returns `{ filename, mimeType, content, summary }`. The UI does not serialize data. In this standalone browser runtime it downloads through `Blob`, `URL.createObjectURL()`, and an `<a download>` element. It does not write arbitrary filesystem paths or use Node filesystem APIs for user data.

## Availability and diagnostics

Download buttons are enabled only after successful preview generation with a non-blocked plan and at least one row. Both `ready` and `ready_with_warnings` are exportable; warnings remain in the Workbench and are not added as data columns. Blocked plans, generation errors, missing datasets, invalid columns, row shape mismatches, and serialization failures fail closed with codes including `export_no_dataset`, `export_blocked_plan`, `export_invalid_columns`, `export_row_shape_mismatch`, and `export_serialization_failed`.

The Safe Synthetic notice remains visible in the Workbench; no confirmation dialog is required for each download.

## SQL Export — deferred

SQL export is intentionally deferred. A generic `INSERT INTO table VALUES (...)` is not safe across database systems. A production-quality SQL serializer needs, at minimum, a target dialect, identifier quoting, string literal escaping, boolean/date/timestamp/NULL/decimal representation, schema/database qualification, reserved-word handling, generated/default/identity-column behavior, and batch sizing. The fixture-driven Workbench still has no reliable selected production database dialect. The Host API 1.3 metadata response alone does not define safe SQL serialization; do not add a generic SQL exporter until dialect and serialization semantics are separately specified.

## DBX integration boundary

CSV / JSON export does not depend on DBX Schema Metadata integration. Upstream `t8y2/dbx#10043` merged during Phase 1D; the consumer probe is a separate Phase 0 task and does not expand Phase 1D scope. Phase 1D does not implement `host.getTableMetadata`, `host.schema:read`, `schemaMetadataApi`, `DbxHostSchemaMetadataProvider`, or database access. The current `.dbxp` includes a separate minimal Phase 0 Probe Workbench, not the fixture-driven Workbench.

## Out of scope

- SQL export
- production DBX metadata adapter and fixture-driven Workbench packaging
- PK / UNIQUE / CHECK / FK, Relation Planner, and SCD
- Direct database writes or a filesystem save-path picker
