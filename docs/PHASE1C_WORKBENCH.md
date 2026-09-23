# Phase 1C — Fixture-driven Workbench

## Scope and Runtime

Phase 1C closes the fixture-only product loop:

```text
FixtureSchemaMetadataProvider
        ↓
Fixture TableSchema
        ↓
WorkbenchController → buildGenerationPlan()
        ↓
Workbench ViewModel
        ↓
Column Mapping / Person Groups / Core Diagnostics
        ↓
generateRows() → Preview
```

The harness uses native HTML, CSS, browser JavaScript modules, Node.js built-ins, and the existing dependency-free Core. It adds no React, Vue, component library, or external runtime dependency.

Run it from the repository root with:

```bash
npm run workbench
```

It binds to `127.0.0.1` (default port `4173`; override with `PORT`) and serves the standalone development UI. **This fixture-driven harness remains standalone and is not packaged in DBX.** The current package separately contains a minimal Phase 0 Schema Metadata Probe Workbench using the documented UI entrypoint; this does not package or wire the fixture-driven Phase 1C UI into DBX.

## Information Architecture

The compact single page has these sections:

1. **Table Context / Dataset Controls** — selected fixture, schema table identity, Rows, Seed, Locale, `Regenerate · same seed`, and `New Seed`.
2. **Column Mapping** — Column, Schema Type, Detected Semantic, Confidence, Selected Mapping / Generator, Status, and expandable Evidence.
3. **Person Groups** — only groups and members present in the current Core plan; partial groups carry a warning.
4. **Diagnostics** — structured Core diagnostics with severity, blocking state, code, reason, and location.
5. **Preview** — horizontal-scroll table with explicit `NULL`, Core date/timestamp and decimal-string values, and a Safe Synthetic notice.

The table is the primary surface. The UI is read-only, desktop-first, compact, and avoids dashboard cards, complex editors, and hidden schema fields.

## ViewModel Boundary

`src/workbench/workbench-controller.mjs` owns:

- fixture listing/selection via `FixtureSchemaMetadataProvider`;
- dataset controls and the Workbench-only row bound;
- confirmed mappings and explicit semantic overrides;
- plan construction, Core generation, Person group options, diagnostics, and preview state;
- a display-oriented `getViewModel()` and discrete UI `dispatch()` actions.

Browser components consume that ViewModel and submit actions; they do not call inference, compatibility, plan construction, or generators. `src/workbench/workbench-server.mjs` is a loopback-only development transport for the harness, not a plugin host adapter.

## Dataset Controls and Determinism

- Rows default to `20` and Workbench limits them to `1–100`. This UI guard is outside Generation Core; the Core still receives an explicit `rowCount`.
- Seed defaults to `demo` and remains editable.
- `Regenerate · same seed` re-runs the same plan inputs. Identical results are the expected deterministic contract.
- `New Seed` uses a newly generated UUID seed and builds a new preview. It does not replace or reimplement Core RNG.
- Locale choices are exactly `zh-CN` and `en`.
- Stable cell values are produced only by the existing `generateRows()` SHA-256-addressed engine. No UI RNG or Faker is introduced.

## Mapping and Confirmation Semantics

Each row distinguishes inference from execution:

- **Detected** and **Confidence** are from Core inference (`high / medium / low / unknown`).
- **Evidence** displays Core evidence source, observation, and explanation in expandable details.
- An inference candidate remains unselected and uses schema-type fallback until an explicit user action, including high-confidence candidates.
- `Use detected` passes the candidate through Core `semanticMappings` (confirmed mapping).
- Choosing a semantic in the mapping selector passes it through Core `semanticOverrides` (explicit override).
- `Auto / Fallback` clears user mapping input and lets Core inference/fallback semantics apply again.
- Selected mapping, Core rule source, status, and compatibility diagnostics come from the resulting plan; the UI does not implement compatibility rules.

## Person Groups

Single/default grouping comes from Core when selected Person semantics exist. The `person_two_groups` fixture explicitly declares fixture-only group membership under its `workbench.personGroups` option; the controller filters those declarations through Core's selected plan mappings and passes the resulting options to Core. The Workbench does not infer multiple groups, create missing columns, or implement group drag/drop. Partial groups show a warning and remain previewable; conflict/blocking decisions are owned by Core.

## Diagnostics and States

The UI consumes Core diagnostic `severity`, `blocking`, `code`, `reason`, `table`, `column`, and `rule` without re-evaluating their business rules:

- `warning` → Warning;
- `error` → Error or Blocking according to `blocking`;
- `unsupported` → Unsupported;
- Info is reserved for explanatory UI notices such as the Safe Synthetic banner, not a rewritten Core diagnostic.

The ViewModel states are `loading`, `empty`, `ready`, `ready_with_warnings`, `blocked`, and `preview_error`. Empty fixture source and fixture loading failures are represented without inventing DBX metadata, connection, or permission states. A blocked Core plan returns no preview rows. A partial Person warning does not block generation. Fixture failures can be retried; invalid controls preserve the prior valid preview and show an action error.

## Preview Semantics and Safety

Preview rows are generated only by:

```text
buildGenerationPlan() → generateRows()
```

The Workbench does not introduce a second generation path. `null` is rendered as `NULL`; dates/timestamps retain Core string output; decimals retain exact string output; the table can scroll horizontally. The Safe Synthetic notice states:

> Generated values are test data patterns and are not sourced from real PII.

No reveal, masking, export, or direct database write workflow is included.

## Fixture-only and DBX Integration Boundary

`FixtureSchemaMetadataProvider` is the sole metadata source in this phase. The harness has no production table metadata, DBX host API, connection, credential, or database access. `manifest.json` remains unchanged; the DBX `.dbxp` build remains the Phase 0 probe package and does not contain the Workbench.

Upstream [`t8y2/dbx#10043`](https://github.com/t8y2/dbx/pull/10043) is a prerequisite for a future **production metadata integration**, not a prerequisite for this fixture-driven Workbench. Even if it merges during Phase 1C, no adapter is added here. A later integration must be handled by a separate issue and Phase 0 gate.

`Export remains a follow-up implementation.` SQL / CSV / JSON export, Direct Insert, PK / UNIQUE / CHECK / FK, Relation Planner, SCD, Validator-Compatible identity generation, real-PII masking, AI inference, and complex grouping/rule editing are explicitly out of scope.
