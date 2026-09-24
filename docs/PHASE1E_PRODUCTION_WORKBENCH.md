# Phase 1E — Production DBX Generation Workbench (#31)

## Status

- Workbench UI, provider wiring, manifest contribution and `.dbxp` implementation: **IMPLEMENTATION_READY**.
- Runtime smoke / Issue #31 acceptance: **PENDING UPSTREAM RELEASE** containing `t8y2/dbx#10244`.
- Latest official DBX release audited: **v0.6.22**, published before #10244 merged. Do not infer a future release number or install this candidate on v0.6.22.

## Architecture

```text
DBX Sidebar table
  → table context-menu: “生成测试数据”
  → host-handled `open-workbench` action
  → direct TableContext (not `{ table: TableContext }`)
  → DbxHostSchemaMetadataProvider
  → SchemaSeed TableSchema / ColumnSchema
  → GenerationPlan (existing Core, via local sidecar RPC)
  → generateRows() (existing deterministic Core)
  → ExportDataset
  → Preview / CSV / JSON
```

The browser Workbench invokes the public `window.dbxPlugin.getTableMetadata()` bridge through `DbxHostSchemaMetadataProvider`. It passes the normalized SchemaSeed-owned schema and generation settings to the package's local JSONL runtime; that runtime calls the existing `buildGenerationPlan()` and `generateRows()`. It performs no network request, database access, credential lookup, or second connection. The Phase 0 Probe remains a separate UI surface and RPC method on the same plugin process; neither path is used as a fallback for the other.

### TableContext and refresh

The #10244 table-menu contract passes an identity object directly:

```json
{
  "connectionId": "...",
  "database": "...",
  "schema": "...",
  "table": "..."
}
```

`database` and `schema` remain optional and are omitted when absent. The legacy Probe backend envelope `{ "table": { ... } }` is unrelated and is not accepted by the production Workbench.

The Workbench subscribes to Host `onContext`. A changed context immediately clears the prior schema, GenerationPlan, preview rows and export dataset; field mapping state is not carried across tables. Each metadata/generation operation is revision-guarded, so a slow A or B response cannot replace the latest C state. Tests cover A→B→C, synchronous invalidation, and late A/B responses.

### UI and state

The production UI displays database / schema / table, column name, normalized schema type, current Core generator / semantic mapping, evidence / diagnostics, Rows, Seed, Locale, Generate, Regenerate Same Seed, New Seed, Preview and CSV / JSON export. It exposes only a labeled Rule Editor integration slot for #32; it does not implement a Column Rule Editor.

UI state is `loading`, `ready`, `warning`, `blocked`, or `error`. Provider errors retain the provider's actionable diagnostic; planning/generation diagnostics come from existing Core APIs. Metadata capability unavailable and invalid context are blocked states; Host request/runtime failures are errors; Core warning plans remain previewable/exportable; blocked plans cannot produce or export a dataset.

### Preview / Export

A successful Core generation result creates one `ExportDataset`. Preview renders that dataset. CSV / JSON serialize that same object and never call `generateRows()`, rebuild a plan, or re-run inference/mapping. Regenerate Same Seed repeats the deterministic Core call with unchanged schema/plan/settings; New Seed updates the seed and creates a new current dataset.

## Manifest and package boundary

The manifest declares:

- Workbench: `io.github.0verme.schema-seed.generation-workbench`;
- table action: `io.github.0verme.schema-seed.generate-test-data`;
- action contract: `{ "type": "open-workbench", "workbench": "io.github.0verme.schema-seed.generation-workbench" }`.

The action is host-handled and does not route through `contextMenu/<id>` or require a sidecar handoff before opening the Workbench. The older Phase 0 Probe contribution remains a separate legacy flow.

Package allowlist includes the production Workbench UI, production provider, Generation Core/runtime modules, Probe modules and icon. It excludes `web/`, `fixtures/`, tests, fixture provider/controller, fixture Preview and standalone HTTP server. `scripts/build.mjs` and package contract tests inspect the resulting `.dbxp` contents and checksums.

## DBX compatibility decision

DBX v0.6.22 was the newest release at implementation time and does **not** contain #10244. Its context-menu contribution struct uses strict unknown-field parsing (`deny_unknown_fields`); an `action` field is rejected rather than ignored. Therefore an implementation candidate carrying the new manifest contract is not safe to install on v0.6.22.

The manifest's existing `engines.dbx: ">=0.6.19"` remains unchanged rather than guessing an unpublished version number. It is the historical floor and is not sufficient for this new action. Do not release the candidate until the official #10244-containing release is identified; then set the verified floor and perform runtime smoke. No upstream DBX compilation is part of this work.

## #32 boundary / non-goals

#31 displays existing Core mapping and generator decisions but does not implement Constant, Sequence, random rules, enum/boolean ratios, date/timestamp ranges, UUID, Null Ratio or a semantic Rule Editor. It also does not implement constraints, relational datasets, Direct Insert, SQL Export, AI rules, production masking or real-data sampling.

## Runtime smoke gate

When the official DBX release containing #10244 is published, install the updated `.dbxp` and verify:

1. table context menu opens the declared Workbench with direct TableContext;
2. current metadata and schema types load and Generate produces Preview;
3. CSV / JSON equal the current Preview dataset;
4. opening table B while table A's Workbench is reused refreshes context, metadata, plan, preview and exports;
5. repeat table switch (A→B→C) and confirm no stale response survives.

Until then, status remains `IMPLEMENTATION_READY_RUNTIME_SMOKE_PENDING`; do not close #31 based solely on package/tests or claim runtime validation.
