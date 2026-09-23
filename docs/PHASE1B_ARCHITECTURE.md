# Phase 1B — Semantic Mapping + Person Synthetic Generation

## Status and scope

Phase 1B extends the Phase 1A fixture-driven Core. The implementation is tracked independently by [Issue #19](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/19); Sensitive Synthetic design was frozen separately in [Issue #13](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/13).

```text
TableSchema
    ↓ schema interpretation
Semantic Detection (column name + schema type + length)
    ↓ explicit semantic override / confirmed mapping / inspectable inference
Person semantic groups
    ↓
GenerationPlan
    ↓ random-access deterministic generation
Fixture Preview + diagnostics
```

The Semantic layer consumes SchemaSeed-owned normalized facts. It does not call DBX, Tauri, a database, an external service, AI/LLM, or a Faker dependency. `FixtureSchemaMetadataProvider` remains the only metadata provider; fixtures are not a production metadata source.

## Semantic model

The implemented semantic vocabulary is deliberately small:

```text
unknown | name | gender | birthday | mobile | email | address
```

Database schema type and semantic type are independent facts. `VARCHAR(18)` is only a bounded string; it never implies an identifier or any other business meaning.

An inference result is deterministic and inspectable:

```js
{
  semanticType: "name" | "gender" | "birthday" | "mobile" | "email" | "address" | "unknown",
  confidence: "high" | "medium" | "low" | "unknown",
  evidence: [{ source, observation, explanation }],
  candidates: [],
  status: "candidate" | "ambiguous" | "incompatible" | "unknown"
}
```

The first rules use only normalized column-name aliases, interpreted schema family, and a known varchar length. Confidence is categorical; unknown names remain unknown. High-confidence Person candidates are inspectable but still require a confirmed mapping or explicit semantic override before a Person generator is selected. No sample rows, comments, model, network, or external lookup are used.

## Mapping and rule precedence

Semantic mapping precedence:

```text
semanticOverrides[column]
    > semanticMappings[column] (confirmed)
    > automatic inference candidate
    > schema-type fallback
```

`semanticOverrides` and confirmed `semanticMappings` are plain code/fixture options; they are not future UI state. The existing #12 explicit generation rule (`overrides`) remains a separate, higher rule-selection choice than semantic generation. Schema type bounds remain mandatory. Invalid explicit choices block the plan; incompatible automatic candidates remain visible with diagnostics and use schema fallback.

Inspect each `GenerationPlan.columns[]` entry for:

- `schema`: normalized schema facts;
- `inference`: detected candidate, confidence, evidence, and candidate status;
- `semanticMapping`: chosen/proposed type, confidence, evidence, source, status, and whether selected;
- `rule`: stable identity, source, and parameters;
- `personGroupIdentity` and diagnostics in the plan.

A semantic generator consumes only a resolved plan rule; it does not infer from raw schema at execution time.

## Person group contract

`Person` is a synthetic logical entity, never a real-person record. If selected Person semantics exist and no groups are supplied, they form one stable `person:default` group. When more than one Person exists in a row, options must declare groups explicitly:

```js
personGroups: [
  { id: "customer", columns: ["customer_name", "customer_mobile"] },
  { id: "contact", columns: ["contact_name", "contact_mobile"] },
]
```

There is no arbitrary automatic clustering. Duplicate roles or conflicting membership emit `person_group_conflict`. Partial groups are valid and emit non-blocking `person_group_partial`; absent roles are never generated or materialized as hidden fields.

## Deterministic identity

For a selected semantic column, the Person value identity is addressed by:

```text
seed
+ table identity
+ Person group identity
+ row identity
+ locale
+ semantic rule identity
+ value slot
```

Row identity is the current stable row ordinal. Semantic rule identities are versioned, e.g. `semantic:name:v1`, `semantic:gender:v1`, `semantic:birthday:v1`, `semantic:mobile:v1`, `semantic:email:v1`, and `semantic:address:v1`. Person values do not depend on invocation order or on the physical column's generation sequence.

Therefore same plan + seed + locale yields identical preview/regenerate/export-like generation; different seed or locale can change generated Person values. Adding a non-Person column or changing a mobile rule does not shift unrelated Person fields. Explicitly shared group context is the only coupling. Determinism does not claim uniqueness or protection against real-world collisions.

## Safe Synthetic and locale

`safe_synthetic` is the only implemented mode and the default. Locale defaults to `zh-CN`; the other supported locale is `en`. Invalid locales are diagnosed.

- Name: visibly test-marked `测试用户…` / `TestUser…`.
- Gender: test-marked `测试-女/男` / `TEST-F/M`.
- Birthday: deterministic synthetic date within the implementation's fixed date range; no age or identifier is derived.
- Mobile: non-production test marker (`测试号…` / `TEST…`), not a real-number provider.
- Email: deterministic local part at the reserved `example.com` test domain.
- Address: visibly synthetic `测试地址…` / `TestAddr…`; no real address corpus.

These markers communicate test intent but cannot mathematically prove that a string or date has never occurred in real life. The implementation makes no collision or real-person non-existence guarantee and reads no real PII.

`validator_compatible` is not implemented; selecting it produces blocking `validator_mode_unsupported`. No Chinese ID card number, region/date/sequence/checksum logic, realistic mobile validation, or external validation is part of Phase 1B.

## Diagnostics

Semantic and Person diagnostics are structured, located, and flow through the existing `GenerationPlan`:

- `semantic_low_confidence`
- `semantic_ambiguous`
- `semantic_schema_incompatible`
- `semantic_override_invalid`
- `person_group_conflict`
- `person_group_partial`
- `unsupported_semantic_type`
- `validator_mode_unsupported`
- `semantic_confirmation_required`

Automatic mismatch/ambiguity can fall back only with an explicit non-blocking diagnostic; invalid confirmed/override mappings and group conflicts block generation. Core consumers can inspect schema facts, candidate/selection, evidence, source, group, rule, and warnings without UI-specific state.

## Fixtures and verification

Semantic fixtures are stored with schema fixtures:

- `person_basic`
- `person_partial`
- `person_aliases`
- `person_ambiguous`
- `person_two_groups`
- `person_override`

Tests exercise inference, unknown names, type/length compatibility, mapping priority, partial and multiple groups, same/different seed, locale, non-Person column stability, independent rule stability, diagnostics, and the complete fixture → mapping → plan → preview chain.

## Explicit non-goals

- DBX Schema Metadata adapter, DBX Host APIs, private APIs, additional database connections, or direct insert;
- PK, UNIQUE, CHECK, FK, relation planner, SCD, or temporal datasets;
- Workbench UI, reveal/masking interaction, SQL/CSV/JSON export;
- Chinese ID card algorithms, full Validator-Compatible framework, real-data masking, real address/number datasets, AI/LLM, or external verification.

Upstream `t8y2/dbx#10043` is a prerequisite for future formal metadata integration, **not** for fixture-driven semantic or Person generation. No DBX adapter is included here even if #10043 merges during implementation.
