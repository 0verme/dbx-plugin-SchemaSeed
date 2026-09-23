# Phase 1A — Generation Core + Fixture-driven Preview

> Historical Phase 1A scope. Phase 1B now extends this Core with Semantic Mapping and Safe Synthetic Person generation; see [PHASE1B_ARCHITECTURE.md](PHASE1B_ARCHITECTURE.md) for current semantic behavior.

## Status and boundary

Phase 1A implements the offline, single-table Generation Core against repository fixtures. It is independent of DBX Host API availability:

> Upstream `t8y2/dbx#10043` is a DBX integration prerequisite, not a Generation Core implementation prerequisite.

The upstream PR is not treated as merged or frozen. This document and the SchemaSeed domain model do not copy its API names, permission, DTO, SDK type, transport, or version details. Formal DBX Schema Metadata integration still awaits upstream PR #10043 merge, validation, and the applicable Phase 0 gate.

## Architecture

```text
FixtureSchemaMetadataProvider
        ↓
SchemaSeed TableSchema / ColumnSchema
        ↓
Schema Interpretation
        ↓
GenerationPlan
        ↓
Deterministic Generation Engine
        ↓
Preview Rows + Diagnostics
```

The provider boundary is intentionally thin:

```text
SchemaMetadataProvider.getTableMetadata({ tableIdentity })
```

Only `FixtureSchemaMetadataProvider` is implemented. It reads checked-in JSON fixture files and does not inspect a local database, DBX state, credentials, or connection settings. **The fixture provider is not a production metadata source.**

A future integration path may be added outside the Core:

```text
DBX Host
   ↓ future public-API adapter (after upstream/Phase 0 validation)
SchemaSeed TableSchema
   ↓
GenerationPlan
   ↓
GenerationEngine
   ↓
Generated Rows
```

No DBX Host adapter is implemented in Phase 1A. Core modules have no DBX, Tauri, UI, Faker, database driver, or connection dependency.

## SchemaSeed domain facts

`TableSchema` and `ColumnSchema` are SchemaSeed-owned models, not Host DTOs. Facts use explicit states (`known`, `absent`, `not_applicable`, `unknown`, `unavailable`, `unsupported`, `failed`). A missing or uncertain fact is not converted to `false`, `0`, or an empty string.

The current type interpreter only identifies schema type families. It does not infer personal or business meaning from a column name. Phase 1A exposes `SemanticType: unknown` as the extension point; semantic inference and sensitive generators remain out of scope.

## Plan and rule selection

`buildGenerationPlan(schema, { seed, rowCount, overrides })` resolves schema facts before execution and returns an inspectable plan containing table, per-column facts, semantic slot, generation rules, seed, row count, diagnostics, status, and determinism profile.

Implemented rule selection for this phase is:

```text
explicit user rule > schema-type fallback
```

The plan keeps a neutral semantic slot between schema interpretation and rule execution, so future confirmed / inferred semantic rules can be inserted without moving semantic logic into column generators. No inference/plugin framework is introduced now.

Supported schema families:

- integer
- decimal (exact decimal strings preserve precision and scale)
- varchar / string (output is bounded by schema length and rule cap)
- boolean
- date
- timestamp

Known nullable columns use a deterministic null probability (default 0.1, overridable); `NOT NULL` columns never emit `null`. Unknown nullability remains visible as a diagnostic and uses non-null values without claiming the schema is `NOT NULL`.

## Deterministic identity

Each value is addressed independently by:

```text
seed + table identity + column identity + row identity + rule identity + value slot
```

The implementation derives SHA-256 values per identity; it does not use `Math.random()`, global Faker state, or a shared RNG cursor. Adding/reordering another column or changing one column's rule therefore does not shift unrelated columns' values. The current profile is `sha256-addressed-v1`; no cross-profile compatibility promise is made.

Preview, repeated generation, and export-like direct engine consumption of the same plan and seed yield identical logical rows. No exporter is implemented.

## Diagnostics and failure behavior

Diagnostics include severity (`warning`, `error`, `unsupported`), table, optional column, rule, reason, and blocking status. Phase 1A reports unsupported data types, unknown required bounds, invalid precision/scale, invalid length, invalid overrides, and generation-impossible cases. A blocked plan returns no generated rows; unsupported columns are never represented by fake `null`, empty string, or zero values.

## Fixtures and Preview

Shared schema fixtures live in `fixtures/schemas/`:

- `simple_customer`
- `financial_transaction`
- `mixed_nullable`
- `precision_boundary`
- `long_varchar`

The fixture provider is the common schema input for Core tests and Preview. `previewFixture()` is a consumer of the Core; its default 20 rows is a Preview-layer setting. `buildGenerationPlan()` requires an explicit row count and has no UI defaults.

## Explicit non-goals

Phase 1A does not implement DBX Host API integration, a second database connection, Direct Insert, SQL/CSV/JSON export, Workbench UI, Faker, Person/identity/mobile generators, PK/UNIQUE/CHECK/FK, Relation Planner, SCD, AI inference, real-data masking, or a plugin / DI framework. Track future requirements in their related design issues rather than adding them to this Core.
