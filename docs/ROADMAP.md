# SchemaSeed Roadmap

> 本文件同步已验证的 Phase 0 Gate 决定和真实进度；不把 DBX 未公开 API 写成已实现事实。

## Phase 0 — Feasibility / Host API

### 目标

确认 DBX 能通过正式插件协议提供：

- Table Context
- Schema Metadata

### 当前状态

```text
Table Context:
  source audit: VERIFIED (#9918 public table context-menu contract)
  consumer probe: IMPLEMENTED
  DBX runtime: v0.6.21 Windows Desktop
  real DBX manual smoke: PASS (MySQL / SQLite / PostgreSQL)

Schema Metadata:
  t8y2/dbx#10043: MERGED (d5a05a98840e54726bfec0c7dadabb8dc9a4c755)
  Schema Metadata Host API: RELEASED in DBX v0.6.21 (Host API 1.3)
  consumer probe: IMPLEMENTED / RUNTIME_VALIDATED
  real DBX smoke: PASS on MySQL / SQLite / PostgreSQL
  automated one-shot replay: missing_table_context (not manually runtime-tested)

CONTEXT_MENU_TO_WORKBENCH_HANDOFF: RELEASED in DBX v0.6.23 (upstream #10244)
DBX v0.6.21 Probe runtime: public sidecar RPC + 10-minute in-memory handoff; user manually opens Probe (historical Phase 0 evidence)
Current contract: table/connection context-menu → `open-workbench` passes context and refreshes reused tabs
Runtime smoke for DBX v0.6.23: #31 (pending manual execution)

Issue #5: CLOSED (PR #28 MERGED; runtime acceptance complete)
Issue #6: CLOSED (PR #33 MERGED)
Phase 0 Gate: READY_WITH_FOLLOWUPS
Overall Phase 0: READY_WITH_FOLLOWUPS
```

### Table Context path（historical Phase 0, DBX v0.6.21）

> Historical evidence only. The production table context-menu entry `io.github.0verme.schema-seed.table-context-probe` (zh-CN「SchemaSeed：保存 Table Context」) was removed from the manifest in the DBX v0.6.23 runtime-validation cleanup. The Schema Metadata Probe Workbench is retained and can still be opened manually from the plugin details page; the sidecar RPC below is no longer reachable through a production table-menu entry.

```text
DBX Sidebar Table Node
  → `context-menu` + `menu: "table"`
  → `contextMenu/io.github.0verme.schema-seed.table-context-probe`
  → JSONL backend normalizes and temporarily stores identity-only TableContext
  → user opens the declared Schema Metadata Probe Workbench
  → `window.dbxPlugin.invoke("schemaMetadataProbe/takeTableContext")`
  → `window.dbxPlugin.getTableMetadata(TableContext)`
  → Raw Host API response + normalized metadata + diagnostics
```

The DBX v0.6.21 Phase 0 Probe runtime used a two-step flow: save the selected table context, then manually open the Workbench. That is historical runtime evidence, not the current upstream contract. Upstream [t8y2/dbx#10244](https://github.com/t8y2/dbx/pull/10244) is merged and released in DBX v0.6.23; it supports table/connection context-menu → `open-workbench`, passes the current context, and refreshes context when reusing a Workbench tab. SchemaSeed has not yet runtime-smoked DBX v0.6.23; #31 owns that validation and uses the direct table-level entry. #30 does not implement a Workbench UI or manifest contribution. The retained Phase 0 Probe Workbench keeps its historical sidecar RPC contract, but its production table context-menu entry is removed.

### 审计范围

- `connectionId`
- `database`
- `schema`
- `table`
- `columns`
- `type`
- `nullable`
- `length`
- `precision`
- `scale`
- `default`
- `comment`
- `primary key`
- `foreign key`
- `unique`
- `check`
- `identity / auto increment`

### Gate

必须明确：

```text
Schema Acquisition Path
```

Issue #5 的阻塞性 Schema Acquisition Path 已在 DBX v0.6.21 Windows Desktop 上对 MySQL、SQLite、PostgreSQL 完成实测（PR #28）。本 Gate 判定为 `READY_WITH_FOLLOWUPS`：Host API 1.3 未暴露的 PK / FK / UNIQUE / CHECK / Comment / Identity 仍为 non-blocking follow-ups。`not_exposed` 仅说明 Host API 未暴露该字段，不代表数据库或 driver 不支持。context-menu → Workbench handoff 已由上游 #10244 实现并随 DBX v0.6.23 正式发布；#6 已由 PR #33 合并关闭。

### 禁止事项

- 读取 DBX private Store
- 读取 Credential 文件
- 调用 private frontend module
- 为获取 Metadata 建立第二套数据库连接系统
- 执行数据库 introspection workaround
- Phase 0 Probe 不实现 Host-backed Generator、Faker、Constraint Engine、Relation Planner 或 Exporter
- 修改 `t8y2/dbx`

## Phase 1A — Generation Core + Fixture-driven Preview（[#17](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/17)）

### 目标链路

```text
Fixture TableSchema
        ↓
Schema Interpretation
        ↓
GenerationPlan
        ↓
Deterministic Generation Engine
        ↓
Preview Rows + Diagnostics
```

### 实施边界

- Core 只认识 SchemaSeed 内部 `TableSchema` / `ColumnSchema`，不直接认识 DBX DTO、Tauri、UI 或数据库连接。
- 当前 `FixtureSchemaMetadataProvider` 只从仓库 fixtures 读取 schema，是 Core / Preview / Tests 的共同输入，**不是 production metadata source**。
- 覆盖 integer、decimal、varchar/string、boolean、date、timestamp；seed 按 table / column / row / rule identity 派生，不依赖全局随机调用顺序。
- Phase 1A 不实现 semantic person generators、constraints、relations、SCD、Workbench、export 或 database write。

### Upstream boundary

Phase 1A 的实现保持 fixture-only，不依赖 `t8y2/dbx#10043`；production metadata adapter 已由 #30 新增，将真实 Host schema 映射到同一 SchemaSeed domain，不改变 Phase 1A 的原始范围或 Core 边界。

## Phase 1B — Semantic Mapping + Person Synthetic Generation（[#19](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/19)）

### 目标链路

```text
TableSchema
   ↓ Schema Interpretation
Semantic Detection (column name + type + length)
   ↓ explicit override / confirmed mapping / inspectable inference
Person semantic group
   ↓
GenerationPlan
   ↓ deterministic Safe Synthetic values
Fixture Preview + Diagnostics
```

### 当前实现边界

- SemanticType 与 schema type 分离；支持 `unknown / name / gender / birthday / mobile / email / address`。
- Inference 为离线 deterministic 规则，提供 confidence、evidence、source；low-confidence、ambiguous、incompatible candidate 不会静默变成 semantic generator。
- 显式 semantic override > confirmed mapping > automatic inference > schema fallback；显式 Generation Rule 仍按 #12 独立优先。
- Person 是 synthetic logical entity；字段可选，partial group 有 warning，不生成隐藏字段；多组通过显式 `personGroups` 声明。
- Safe Synthetic 为默认 mode。姓名、性别、手机号、地址使用 test marker；email 使用 `example.com`；不读取真实 PII，也不保证现实世界绝不碰撞。
- 稳定上下文是 seed + table + group + row + locale，每个字段使用稳定 semantic rule identity；Fixture Preview 是 GenerationPlan/Engine 的 consumer。
- Validator-Compatible 只保留 unsupported-mode diagnostic；不实现中国身份证/checksum、真实号码验证、Workbench UI 或 exporter。

## Phase 1C — Fixture-driven Workbench（[#21](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/21)）

### 当前状态

- Fixture-driven Workbench 已实现；设计 Issue [#14](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/14) 已 Design Freeze 并关闭。
- `WorkbenchController` 使用现有 `buildGenerationPlan()` 与 `generateRows()`；只消费 `FixtureSchemaMetadataProvider`。
- Rows 默认 20、限制 1–100；支持 seed、same-seed Regenerate、New Seed、`zh-CN` / `en`、显式 mapping confirmation / override、Person groups、Core diagnostics 与 preview。
- Runtime 为 standalone loopback development harness only。Phase 1C fixture-driven Workbench 本身仍未 packaged in DBX；#31 的正式 DBX Workbench 是独立生产 consumer，不依赖此 fixture UI。
- Phase 1C 完成时 Export 尚未实现；CSV / JSON 后续由 Phase 1D 单独交付。无 Direct Insert。

### Upstream boundary

Upstream `t8y2/dbx#10043` 已 merge（Host API 1.3 可用），但不扩大 Phase 1C；Phase 0 Probe 与 Gate 独立推进。Production adapter 由 #30 单独交付，正式 Workbench implementation/package 由 #31 完成；DBX v0.6.23 已正式包含 #10244，runtime smoke 仍 pending manual execution。

## Phase 1D — Deterministic Export Core + Workbench Download（[#23](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/23)）

### 当前状态

- Deterministic CSV / JSON Export Core 与 Workbench Download 已随 PR #24 合并至 `main`（merge commit `1ce80821e41339aaca35cd813b3813d757aa8f86`）；Export 只消费 Workbench 当前已由 Generation Core 产生的 dataset，不重复生成。
- [Phase 1D Export](PHASE1D_EXPORT.md) 记录 dataset contract、Preview / export parity、CSV escaping / spreadsheet-safe / UTF-8 BOM、JSON decimal precision、filename 与 runtime 边界。
- Phase 1D 原始实现只通过 `npm run workbench` standalone harness 使用；#31 后 `.dbxp` 选择性打包 production Core / provider / Workbench UI。Phase 1C fixture Workbench、fixture providers 与 fixtures 仍不进入 production package。

### 明确延期 / 边界

- SQL Export deferred：fixture Workbench 没有 production database dialect；不实现 generic SQL serializer。
- Phase 1D 当时未实现 production `DbxHostSchemaMetadataProvider` / Host-backed Generation；#30 后续另行完成。fixture Workbench packaging、PK / UNIQUE / CHECK / FK、Relation Planner 或 SCD 仍不在 Phase 1D 范围。
- CSV / JSON 不依赖 upstream `t8y2/dbx#10043`；该 PR 在 Phase 1D 执行期间已 merge，不扩大本 Issue。

## Production DBX Metadata Adapter — #30

- `DbxHostSchemaMetadataProvider` 是唯一 production DTO → SchemaSeed domain adapter；它复用公开 `getTableMetadata()` contract，将 DBX columns 与 `fieldCapabilities` 映射为现有 `TableSchema` / `ColumnSchema` facts，并保留 optional-field 状态与 provenance。
- Contract tests 覆盖 MySQL、PostgreSQL、SQLite，以及 TableContext → provider → TableSchema → `buildGenerationPlan()` → `generateRows()`。SQLite 未暴露的 structured length / precision / scale 保持 `unsupported`，不会伪造 0；获取失败返回 actionable diagnostic，不 fallback 到 fixtures。
- `FixtureSchemaMetadataProvider` 仍只属于 tests / standalone development harness。#30 不包含 Workbench UI / context-menu contribution；#31 负责正式 consumer、package contribution 与 runtime smoke。

## Phase 1E — Production DBX Generation Workbench（#31）

### Production path

```text
DBX Sidebar table
  → context-menu “生成测试数据”
  → declarative `open-workbench` (#10244)
  → direct TableContext (not legacy `{ table: ... }` envelope)
  → DbxHostSchemaMetadataProvider
  → SchemaSeed TableSchema
  → GenerationPlan → generateRows()
  → Preview → CSV / JSON
```

- Formal Workbench obtains TableContext directly from DBX and calls the public `getTableMetadata()` provider; `database` / `schema` remain optional.
- The current dataset is created from the same Core generation result used by Preview. Export serializes only that dataset and never calls `generateRows()` again.
- Context change synchronously invalidates old metadata, plan, preview and export dataset. `A → B → C` calls are revision-guarded so late responses cannot replace C.
- UI states distinguish `loading`, `ready`, `warning`, `blocked` and `error`; provider/Core diagnostics remain the single diagnostic source.
- `ui/` includes both the production Workbench UI and the separate Phase 0 Probe Workbench (manual plugin-details entry only; its historical table context-menu contribution was removed). The `.dbxp` package explicitly excludes `web/`, `fixtures/`, fixture providers/controllers, tests and standalone harness server.
- Issue #32 implements the frozen 13-rule v0.1 Core contract and production Rule Editor; see [COLUMN_GENERATION_RULES.md](COLUMN_GENERATION_RULES.md). The release gate is satisfied by DBX v0.6.23; runtime E2E remains pending manual execution.

### DBX release compatibility decision

- Latest official DBX release audited: `v0.6.23` (released 2026-09-25), the first release containing `t8y2/dbx#10244`; its release notes list the right-click → plugin Workbench entry.
- `v0.6.22` predates #10244 and denies unknown fields on context-menu contributions. It rejects a manifest containing `context-menu.action.open-workbench`; it is not a valid install target.
- `manifest.json` now declares `engines.dbx: ">=0.6.23"`; the historical `>=0.6.19` floor (which did not cover the action) was removed. This floor is a runtime prerequisite only and does not claim completed smoke.
- Runtime smoke remains pending manual execution on DBX v0.6.23: table launch, metadata, Preview / exports and reused-workbench context refresh. Do not compile DBX locally for this gate.

### Issue #32 — Column Generation Rules v0.1 and Rule Editor

- Exactly 13 tagged rules are frozen, Core-validated and available through existing GenerationPlan diagnostics. Plan and generator reuse existing deterministic cell/row identity; no parallel RNG engine is introduced.
- Rule availability and config fields are Core-provided. The production Workbench Rule Editor edits table-session state, uses validation-only calls, invalidates the old Preview/Export immediately, and blocks invalid rules rather than falling back.
- Existing `generation/preview` RPC carries rules and validation-only options; package allowlist/contract tests include the Core module while preserving fixture-free production runtime boundaries.
- Focused and full local Node tests validate tagged contracts, schema bounds, exact decimal arithmetic, UTC ranges, stable identities, controller invalidation, RPC and `.dbxp` packaging. These are not DBX runtime E2E evidence.
- State: `IMPLEMENTATION_READY_RUNTIME_E2E_PENDING`. Keep Issue #32 open until the formal Workbench + rules flow passes runtime validation on DBX v0.6.23. No release fabrication or local upstream compilation.

### Issue #37 — Manual Single-table Constraint Engine v0.1

- Core accepts only explicit `unique`, ordered `composite_unique` and `required_unique` configuration; it builds an independent inspectable ConstraintPlan, proves finite domain / tuple capacity, allocates deterministically without collision retry, and independently validates the final dataset.
- The production Workbench editor uses the existing `generation/preview` validation-only path. Constraint edits invalidate Preview / Export; constraints are cleared on context refresh and are not persisted. `.dbxp` includes the new Core and Workbench assets while excluding test / fixture / standalone resources.
- This capability is a SchemaSeed generation obligation, not database PK / UNIQUE discovery. No host schema provenance is rewritten and no database catalog, private API, credential or second connection is used. See the canonical [Manual Constraints contract](MANUAL_CONSTRAINTS.md).
- #37 does not depend on or alter #31 runtime smoke / #32 runtime E2E gates, and does not claim either gate verified.

### Current status / next step

`#30` production metadata adapter and Core contract path are implemented. `#31` Workbench / manifest / package implementation is ready; the runtime release gate is satisfied by DBX v0.6.23, and official runtime smoke / acceptance-based Issue closure still require manual execution. `#32` Core + production Rule Editor implementation is ready; runtime E2E remains pending on the same release. The production table context-menu now exposes only the `generate-test-data` entry; the historical Phase 0 probe entry was removed. Manual Unique / Composite Unique / Required + Unique are the explicit #37 scope; automatic database-constraint discovery, CHECK, Identity, FK datasets, SCD, SQL Export and Direct Insert remain non-goals.
