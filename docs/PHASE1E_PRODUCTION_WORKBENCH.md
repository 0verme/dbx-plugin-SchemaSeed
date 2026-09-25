# Phase 1E — Production DBX Generation Workbench (#31)

## Status

- Workbench UI, provider wiring, manifest contribution and `.dbxp` implementation: **IMPLEMENTATION_READY**.
- Runtime smoke / Issue #31 acceptance: **PENDING MANUAL DBX v0.6.23 RUNTIME SMOKE**.
- Runtime floor: **DBX v0.6.23**, the first official released runtime containing upstream `t8y2/dbx#10244` (released 2026-09-25; release notes explicitly list the table context-menu → Workbench entry). The previous `>=0.6.19` floor did not cover `context-menu.action.open-workbench` and has been removed.
- Historical note: DBX v0.6.22 predates #10244 and its manifest parser rejects unknown context-menu fields (`deny_unknown_fields`). v0.6.22 is **not** a valid install target for this candidate.

## Architecture

```text
DBX Sidebar table
  → table context-menu: “生成测试数据”
  → host-handled `open-workbench` action
  → direct TableContext (not `{ table: TableContext }`)
  → DbxHostSchemaMetadataProvider
  → SchemaSeed TableSchema / ColumnSchema
  → GenerationPlan + per-column GenerationRules (existing Core, via local sidecar RPC)
  → generateRows() (existing deterministic Core)
  → ExportDataset
  → Preview / CSV / JSON / INSERT SQL
```

The browser Workbench invokes the public `window.dbxPlugin.getTableMetadata()` bridge through `DbxHostSchemaMetadataProvider`. It passes the normalized SchemaSeed-owned schema, column rules and generation settings to the package's local JSONL runtime; that runtime calls the existing `buildGenerationPlan()` and `generateRows()`. Rule validation-only calls reuse the `generation/preview` RPC contract and return Core plan diagnostics without rows. It performs no network request, database access, credential lookup, or second connection. The Phase 0 Probe remains a separate UI surface and RPC method on the same plugin process; neither path is used as a fallback for the other. The historical Probe table context-menu contribution has been removed from the production manifest, so the legacy sidecar handoff is no longer reachable from the table menu; the Probe Workbench itself is retained and can be opened manually from the plugin details page.

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

The production UI displays database / schema / table, column name, normalized schema type, current Core generator / semantic mapping, evidence / diagnostics, Rows, Seed, Locale, Generate, Regenerate Same Seed, New Seed, Preview and CSV / JSON / INSERT SQL export. Issue #32 replaces the prior Rule Editor integration slot with one Core-driven per-column editor for the frozen 13 tagged GenerationRules. Core compatibility choices, field descriptors and diagnostics are rendered without a duplicate UI schema; rules remain table-session state and are cleared on context refresh. Any edit immediately invalidates Preview and Export until the current rule plan is validated and generated; invalid rules block Generate/Export and never fall back silently. See [COLUMN_GENERATION_RULES.md](COLUMN_GENERATION_RULES.md) for the full contract.

The page is result-first: current table / generation parameters, then the always-visible data Preview, then three collapsed advanced sections (columns / generation strategy, generation constraints, diagnostics). Collapsed headers keep one-line localized summaries (field count with pending confirmations, configured constraint count, diagnostic severity) so collapsing never hides state. `src/workbench/workbench-sections.mjs` owns the DOM-free part of that disclosure behavior: the three advanced sections start collapsed on every open, a manual toggle survives re-renders, plain warnings never auto-expand Diagnostics, and a newly appeared blocking error opens it. No generation, plan, dataset, Core contract or Host API behavior changes.

UI state includes `loading`, `dirty`, `ready`, `warning`, `blocked`, and `error`. Provider errors retain the provider's actionable diagnostic; planning/generation diagnostics come from existing Core APIs. Metadata capability unavailable and invalid context are blocked states; Host request/runtime failures are errors; Core warning plans remain previewable/exportable; blocked plans cannot produce or export a dataset.

### Preview / Export

A successful Core generation result creates one `ExportDataset`. Preview renders that dataset. CSV / JSON / INSERT SQL serialize that same object and never call `generateRows()`, rebuild a plan, or re-run inference/mapping. Regenerate Same Seed repeats the deterministic Core call with unchanged schema/plan/settings; New Seed updates the seed and creates a new current dataset.

## Manifest and package boundary

The manifest declares:

- Workbench: `io.github.0verme.schema-seed.generation-workbench`;
- table action: `io.github.0verme.schema-seed.generate-test-data`;
- action contract: `{ "type": "open-workbench", "workbench": "io.github.0verme.schema-seed.generation-workbench" }`.

The production manifest exposes exactly one `menu: "table"` contribution: `io.github.0verme.schema-seed.generate-test-data` (「生成测试数据」). The historical Phase 0 `io.github.0verme.schema-seed.table-context-probe` right-click entry and its zh-CN localization were removed so the table menu no longer shows 「SchemaSeed：保存 Table Context」. The Schema Metadata Probe Workbench is retained for manual diagnostics from the plugin details page; its legacy sidecar RPC is retained only as historical Phase 0 machinery and is not a production table-menu entry.

The action is host-handled and does not route through `contextMenu/<id>` or require a sidecar handoff before opening the Workbench.

Package allowlist includes the production Workbench UI, production provider, Generation Core/runtime modules, Probe modules and icon. It excludes `web/`, `fixtures/`, tests, fixture provider/controller, fixture Preview and standalone HTTP server. `scripts/build.mjs` and package contract tests inspect the resulting `.dbxp` contents and checksums.

## DBX sandbox asset contract

The production `ui/index.html` deliberately declares **no** Content-Security-Policy and **no** `base` element. DBX v0.6.23 injects its own sandbox CSP, the Host Bridge SDK and the plugin asset origin as the document `base`; multiple CSP policies intersect, so a plugin policy that lacks `'unsafe-inline'` and the asset origin blocks the injected SDK and the inlined entry module, and `base-uri 'none'` discards the host base. The Host sandbox CSP remains the only security boundary.

DBX serves UI files from `entrypoints.ui.root` (`ui`), so runtime module URLs are rooted at the ui directory (`<origin>/<plugin-id>/<ui-path>`). The entry document must reference every script/stylesheet at the ui root: the host derives its injected base from the first subdirectory it sees, and a subdirectory entry asset would move lazy module resolution away from the root. Shared Generation Core modules are vendored under `ui/src/**` by `scripts/build.mjs` so `ui/generation-workbench/app.mjs` can import them through the asset origin; the same walk rejects `node:` builtins and `Buffer`, which do not exist in the sandboxed WebView (the sha256-addressed identity/rule/constraint helpers use the isomorphic `src/generation/sha256.mjs` instead of `node:crypto`). `tests/package-contract.test.mjs` reconstructs the host `<base>`, inlining and module-fetch resolution from the built `.dbxp` and fails on any unresolved or Node-only module.

## DBX compatibility decision

DBX v0.6.23 (released 2026-09-25) is the first official released runtime containing `t8y2/dbx#10244`; its release notes explicitly list the right-click → plugin Workbench entry. The manifest floor was therefore set to `engines.dbx: ">=0.6.23"`, and the previous `>=0.6.19` historical floor was removed because it does not cover the `open-workbench` action. The floor exists only to guarantee the table context-menu `open-workbench` contract is present; it makes no claim that SchemaSeed runtime smoke has completed.

DBX v0.6.22 predates #10244 and does **not** contain it. Its context-menu contribution struct uses strict unknown-field parsing (`deny_unknown_fields`); an `action` field is rejected rather than ignored. v0.6.22 is not a valid install target for this candidate and must not be used for smoke.

No upstream DBX source was modified or compiled for this work.

## #32 implementation / non-goals

Issue #32 implements the frozen 13-rule v0.1 model and Rule Editor in the existing Core, production Workbench, RPC and `.dbxp` package. It does not add a second generator, DBX connection, rule persistence/profile, constraints, relational datasets, Direct Insert, SQL Export, AI rules, production masking or real-data sampling. Runtime E2E release gate is satisfied by DBX v0.6.23; runtime E2E remains pending manual execution.

## Runtime smoke gate

DBX v0.6.23 is published. Install the updated `.dbxp` on v0.6.23 and verify:

1. table right-click shows only the SchemaSeed 「生成测试数据」 entry and no 「SchemaSeed：保存 Table Context」 entry;
2. table context menu opens the declared Workbench with direct TableContext;
3. current metadata and schema types load and Generate produces Preview;
4. CSV / JSON / INSERT SQL equal the current Preview dataset;
5. opening table B while table A's Workbench is reused refreshes context, metadata, plan, preview and exports;
6. repeat table switch (A→B→C) and confirm no stale response survives.

Until the manual DBX v0.6.23 click-through is recorded, status remains `READY_FOR_DBX_0.6.23_RUNTIME_SMOKE` for #31 and `IMPLEMENTATION_READY_RUNTIME_E2E_PENDING` for #32; do not close either Issue based solely on package/tests or claim runtime validation.
