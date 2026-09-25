# Manual Single-table Constraints v0.1

This is the canonical contract for Issue #37. Other project documents should link here rather than restating the semantics.

## Boundary: manual generation obligations only

A manual constraint is explicit user configuration owned by SchemaSeed. It describes what generated rows must satisfy; it is not a database declaration, metadata fact, or claim that the target table has a PK / UNIQUE constraint. The Host API currently does not expose PK / UNIQUE / CHECK metadata.

Schema facts and generation obligations remain separate. For example, `nullable=false` with its existing provenance is a schema fact; `required_unique` adds a `manual_generation_required` obligation. Editing constraints never changes `TableSchema` or its provenance. No constraint is inferred from names, database metadata, or absent metadata.

This implementation does not call `information_schema`, `pg_catalog`, `SHOW`, `PRAGMA`, private DBX APIs / Store, credentials, or a second database connection. It does not modify DBX upstream.

## Domain model and strict configuration

The only v0.1 kinds are:

```js
{ id: "email-unique", kind: "unique", column: "email" }
{ id: "tenant-user", kind: "composite_unique", columns: ["tenant_id", "user_code"] }
{ id: "id-required-unique", kind: "required_unique", column: "id" }
```

`id` is required and non-empty. Each kind accepts only the shown fields. Core rejects malformed objects, missing / unknown fields, unknown kinds, unknown columns, repeated columns, duplicate declarations and Composite Unique with fewer than two distinct columns. Composite column order is preserved in normalized configuration, identity, allocation and validation. Reversing `(a, b)` to `(b, a)` changes configuration identity; equivalent duplicate declarations are still diagnosed rather than silently deduplicated.

`ManualConstraint` is independent of `GenerationRule`. Rules continue to describe a column's value strategy; a constraint describes a row- or tuple-level obligation.

## Planning and inspectable output

The Core path is:

```text
TableSchema → GenerationPlan → ConstraintPlan
            → constrained generation → independent dataset validation → Dataset
```

`buildGenerationPlan(schema, { rules, constraints, rowCount, seed, locale })` builds the existing GenerationPlan and an independent ConstraintPlan. RPC continues through the existing `generation/preview` method; `validateOnly` builds both plans and diagnostics without materializing rows.

Each valid ConstraintPlan entry exposes its `id`, stable identity, kind, ordered columns, normalized configuration, capacity, satisfiability, active/comparable row count, requiredness provenance, allocation strategy, blocking state and diagnostics. Capacity is an explicit tagged value:

```text
{ state: "known", value: "<base-10 integer>" }
{ state: "cannot_prove", reason: "..." }
```

The decimal-string representation safely carries large finite capacities. Unknown / unsupported capacity is never encoded as zero or Infinity. `satisfiable` is `true`, `false`, or `null` when it cannot be proved. A blocked ConstraintPlan is inspectable; it cannot generate or export a Dataset.

## NULL and requiredness semantics

These are SchemaSeed generation semantics for v0.1, not a claim of exact PostgreSQL, MySQL, SQLite, or other dialect behavior:

- **Unique:** NULL values do not participate in uniqueness comparison. Multiple NULLs are allowed.
- **Composite Unique:** a tuple containing NULL in any participating column is skipped for tuple uniqueness comparison. Its ordered column list is retained.
- **Required + Unique:** every row must contain a present, non-`undefined`, non-NULL value, and those values must be unique.

`requirednessProvenance` distinguishes `schema_required` (only when the normalized schema fact says `nullable=false`) from `manual_generation_required` (the explicit Required + Unique obligation). A nullable or unknown schema fact is not rewritten to NOT NULL. Required + Unique on such a column remains a valid generation obligation unless its rule conflicts.

An explicit positive `Null Ratio` conflicts with Required + Unique. Core emits blocking `required_rule_conflict`; it does not change the ratio, ignore the constraint, or fall back to Auto. Implicit nullable defaults are handled by constrained allocation without changing the schema fact. Other explicit rules that cannot provide a provable domain are blocked during planning.

## Capacity and satisfiability

Planning precedes generation and compares the number of comparable rows with the available non-NULL domain capacity. Deterministic planned NULL rows are excluded for Unique and Composite Unique; Required + Unique compares every row. Composite capacity is the product of its participating finite non-NULL domains, not a requirement that each individual column be unique.

The v0.1 indexable domains include:

- Constant and Enum finite candidate domains;
- non-zero-step Sequence values for this row plan (zero-step Sequence has capacity one);
- Boolean / Boolean Ratio (`1` at ratios 0 or 1, otherwise up to `2`);
- finite Random Integer and exact scaled-integer Random Decimal ranges;
- fixed-length Random String and bounded varchar fallback domains;
- UUID via an injective indexed mapping over the 122-bit UUID value space, not collision probability;
- bounded date and timestamp ranges, and finite integer / decimal / boolean / varchar schema fallbacks.

Composite allocation uses a stable mixed-radix tuple domain. Capacity is computed before generation; e.g. domains of 10 and 5 values have tuple capacity 50. A required count above known capacity yields blocking `constraint_capacity_insufficient`. If a strategy cannot be stably enumerated or indexed, planning returns `constraint_capacity_unknown` or `constraint_strategy_unsupported` and blocks. Semantic generators without a provable finite collision-free mapping are unsupported for uniqueness in v0.1.

Constraints sharing columns are analyzed together. A proven unique subset may satisfy a containing tuple constraint. Overlapping incomparable constraints without a proven joint allocation strategy are blocked with `constraint_conflict`; constraint list iteration order never chooses a winner.

## Determinism and allocation

Allocation is planned, deterministic and limited to participating columns. It is addressed by seed, table identity, stable constraint identity and logical row identity. Finite domains use direct index allocation; composite values use mixed-radix decomposition. A deterministic seed-addressed offset can change stochastic constrained values without a shared RNG cursor. An intrinsically injective Sequence remains governed by its existing row identity.

There is no generate/collide/retry loop, collision repair, silent de-duplication, or probabilistic uniqueness claim. Changing an unrelated constraint does not perturb an unrelated column. If two constraints cannot be jointly proven satisfiable, planning blocks before generation.

## Independent dataset validation and failure

`validateDatasetConstraints(rows, constraintPlan)` independently rechecks the final rows; allocation is not trusted. Identity is type-tagged, so numeric `1` differs from string `"1"`. Composite keys are canonical ordered typed tuples. NULL exemptions follow the semantics above; Required + Unique also detects missing / `undefined` values.

Violations produce stable diagnostics including `constraint_unique_violation`, `constraint_composite_unique_violation` and `constraint_required_violation`. A validation failure invalidates the whole result: generation returns no rows as a successful dataset, performs no repair, and does not delete or regenerate duplicate rows. `createExportDataset` also rejects a failed constraint validation, so an invalid dataset cannot be exported.

Configuration / planning diagnostics include `invalid_constraint_config`, `invalid_constraint_kind`, `unknown_constraint_column`, `duplicate_constraint_column`, `duplicate_constraint`, `constraint_conflict`, `constraint_capacity_insufficient`, `constraint_capacity_unknown`, `constraint_strategy_unsupported` and `required_rule_conflict`.

## Workbench, RPC and package

The production Workbench provides a minimal Constraints editor with add, edit and delete, Core diagnostics and an inspectable capacity / satisfiability summary. UI code owns only form state and rendering; validation, capacity, requiredness and tuple semantics remain in Core.

Edits use the existing `generation/preview` validation-only path and immediately clear the old Plan / Preview / Export dataset. Invalid plans show Core diagnostics and block Generate / Export. A successful Generate creates a fresh Preview / Export dataset. Constraints are scoped to the current table session; A→B→C context refresh clears constraints and all old generated state.

The `.dbxp` package includes the constraint domain, planner, allocator, validator, runtime integration and production Workbench assets. It excludes tests, fixtures, fixture providers and standalone development resources. This local implementation does not verify the separate #31 runtime smoke or #32 runtime E2E gate and does not change either gate's status.

## Non-goals

```text
Database PK / UNIQUE / CHECK discovery or claims
CHECK evaluation / SQL or dialect parser
Identity generation
Foreign Keys / relation planner / relational datasets
SCD / temporal generation
SQL Export / direct insert / database writes
AI constraint generation / persistence
DBX upstream changes or another database connection
```
