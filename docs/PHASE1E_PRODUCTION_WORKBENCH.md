# Phase 1E — Production DBX Generation Workbench (#31)

## Status

- Original Workbench UI, Host provider wiring, manifest contribution and `.dbxp` implementation: **IMPLEMENTED**.
- Original sidecar-based runtime smoke / Issue #31 acceptance: **PASSED — DBX v0.6.23 Desktop, 2026-09-26, SchemaSeed v0.2.4 candidate** (historical; see [Runtime smoke record](#runtime-smoke-record)).
- Node-free frontend-only migration: **IMPLEMENTED in the current Draft PR**; the new `.dbxp` still requires current Windows/macOS DBX runtime acceptance. Until then, mark `MAC_RUNTIME_PENDING`.
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
  → GenerationPlan + per-column GenerationRules (existing Core, local in the WebView)
  → generateRows() (existing deterministic Core)
  → ExportDataset
  → Preview / CSV / JSON / INSERT SQL
```

The browser Workbench reads table metadata through the public `window.dbxPlugin.getTableMetadata()` bridge and `DbxHostSchemaMetadataProvider`. It passes the normalized SchemaSeed-owned schema, column rules and generation settings directly to the shared local `executeGenerationPreview()` entrypoint; that entrypoint validates the former `generation/preview` request contract and calls the existing `buildGenerationPlan()` and `generateRows()`. Rule-validation-only calls use the same function and return Core plan diagnostics without rows. Generation performs no Host invoke, sidecar startup, network request, database connection, credential lookup or second connection. Optional sample profiling remains a separate consent-gated Host `queryData()` operation and all failures fall back to metadata-only behavior. The former manually opened Schema Metadata Probe UI depended on the removed backend handoff and has therefore been removed along with the obsolete sidecar RPC; its historical Host API contract evidence remains documented separately.

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

Export saving is host-owned: `ui/generation-workbench/export-save.mjs` turns the `prepareExport()` descriptor into UTF-8 bytes and calls the public `window.dbxPlugin.saveFile({ fileName, contentType }, bytes)` method, so DBX opens the native save dialog and writes the file. The Workbench reports saved / cancelled / failed from the host result and never renders success from the click itself; a missing host save method fails closed with an upgrade hint instead of a sandboxed browser download. `src/export/` stays host-free.

## Manifest and package boundary

The manifest declares:

- Workbench: `io.github.0verme.schema-seed.generation-workbench`;
- table action: `io.github.0verme.schema-seed.generate-test-data`;
- action contract: `{ "type": "open-workbench", "workbench": "io.github.0verme.schema-seed.generation-workbench" }`.

The production manifest exposes exactly one `menu: "table"` contribution: `io.github.0verme.schema-seed.generate-test-data` (「生成测试数据」). The historical Phase 0 `io.github.0verme.schema-seed.table-context-probe` right-click entry, the manually opened Schema Metadata Probe Workbench and their backend RPC handoff are removed; the metadata Host contract and runtime evidence remain in the audit documents. Opening the generation Workbench without table context produces the controller's visible `table_context_invalid` diagnostic rather than a blank screen.

The action is host-handled and does not route through `contextMenu/<id>` or require a sidecar handoff before opening the Workbench.

The manifest is frontend-only and the package uses the DBX official plugin CLI. `scripts/build.mjs` stages the manifest, icon, UI and every reachable browser-safe module from the existing Generation Core under `ui/src/`, then invokes `dbx-plugin package` for one universal artifact. The package excludes backend/launcher files, the obsolete Probe UI, `web/`, `fixtures/`, tests, fixture provider/controller, fixture Preview and standalone HTTP server. Contract tests inspect the actual `.dbxp`, runtime module graph, artifact metadata and checksums.

## DBX sandbox asset contract

The production `ui/index.html` deliberately declares **no** Content-Security-Policy and **no** `base` element. DBX v0.6.23 injects its own sandbox CSP, the Host Bridge SDK and the plugin asset origin as the document `base`; multiple CSP policies intersect, so a plugin policy that lacks `'unsafe-inline'` and the asset origin blocks the injected SDK and the inlined entry module, and `base-uri 'none'` discards the host base. The Host sandbox CSP remains the only security boundary.

DBX serves UI files from `entrypoints.ui.root` (`ui`), so runtime module URLs are rooted at the UI directory (`<origin>/<plugin-id>/<ui-path>`). The entry document references script and stylesheet assets at the UI root; the host derives its injected base from entry resources. Shared Generation Core modules are staged under `ui/src/**` by `scripts/build.mjs` and packaged by the official CLI. The graph walk rejects Node builtins and Node-only globals. Both UUID formatting and Person-synthetic digest operations now use the existing isomorphic SHA-256 helpers instead of `Buffer` or `node:crypto`, preserving deterministic output. `tests/package-contract.test.mjs` inspects actual `.dbxp` contents, the complete reachable module graph, the host asset contract and checksums.

## DBX compatibility decision

DBX v0.6.23 (released 2026-09-25) is the first official released runtime containing `t8y2/dbx#10244`; its release notes explicitly list the right-click → plugin Workbench entry. The manifest floor was therefore set to `engines.dbx: ">=0.6.23"`, and the previous `>=0.6.19` historical floor was removed because it does not cover the `open-workbench` action. The floor exists only to guarantee the table context-menu `open-workbench` contract is present; it makes no claim that SchemaSeed runtime smoke has completed.

DBX v0.6.22 predates #10244 and does **not** contain it. Its context-menu contribution struct uses strict unknown-field parsing (`deny_unknown_fields`); an `action` field is rejected rather than ignored. v0.6.22 is not a valid install target for this candidate and must not be used for smoke.

No upstream DBX source was modified or compiled for this work.

## #32 implementation / non-goals

Issue #32 implements the frozen 13-rule v0.1 model and Rule Editor in the existing Core, production Workbench, RPC and `.dbxp` package. It does not add a second generator, DBX connection, rule persistence/profile, constraints, relational datasets, Direct Insert, SQL Export, AI rules, production masking or real-data sampling. Runtime E2E release gate is satisfied by DBX v0.6.23; the 2026-09-26 v0.6.23 workbench smoke exercised the rules-driven Generate → Preview → Export path. The per-rule Rule Editor interaction (edit → invalidation → validation-only diagnostics) belongs to the same Workbench session but is not itemized in the smoke record below.

## Runtime smoke record

Historical environment: **DBX v0.6.23 Desktop (Windows)**, using the SchemaSeed `v0.2.4` unsigned universal `.dbxp` (`io.github.0verme.schema-seed-0.2.4-universal.dbxp`, SHA-256 `6cc5dd874cce5cbe92ad47c5092ebe4613631ebe4d354d39fa2bbf722af73b10`, 679971 bytes). Verified manually on **2026-09-26**. This record applies only to the earlier sidecar-based artifact and is not evidence for the current Node-free package; the latter needs a fresh Windows/macOS DBX smoke.

| # | Check | Result |
| --- | --- | --- |
| 1 | table right-click shows only the SchemaSeed 「生成测试数据」 entry and no historical 「SchemaSeed：保存 Table Context」 entry | PASS |
| 2 | table context menu opens the declared Workbench with the direct TableContext | PASS |
| 3 | current metadata and schema types load, and Generate produces Preview | PASS |
| 4 | CSV / JSON / INSERT SQL equal the current Preview dataset; since v0.2.4 each export opens the host native save dialog and writes the file (cancel reports cancelled, not saved) | PASS |
| 5 | opening table B while table A's Workbench is reused refreshes context, metadata, plan, preview and exports | PASS |
| 6 | repeated table switch (A→B→C) leaves no stale response | PASS |
| 7 | the Phase 0 Probe Workbench still opens manually from the plugin details page | PASS for the historical v0.2.4 candidate only; the Probe UI is removed from the Node-free candidate |

Consequences:

- the DBX v0.6.23 runtime gate for #31 is satisfied; closing #31 (and the #29 epic) is a maintainer decision based on this record;
- the same session covered the rules-driven Generate → Preview → Export path used by #32; the per-rule Rule Editor interaction is not itemized above;
- the Workbench i18n surfaces (#39) were displayed during the session; no separate visual checklist is recorded;
- this is manual runtime evidence: it must not be replaced by `npm test`, `npm run build` or a release-workflow result, and no upstream DBX build was used.
