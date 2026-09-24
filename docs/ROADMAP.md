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

CONTEXT_MENU_TO_WORKBENCH_HANDOFF: NOT_PRODUCTIZED
Context → Workbench: public sidecar RPC + 10-minute plugin-owned in-memory handoff; user manually opens Probe
Product UX follow-up: non-blocking for the v0.1 Schema Acquisition Path

Issue #5: CLOSED (PR #28 MERGED; runtime acceptance complete)
Issue #6: OPEN until this gate-closing PR merges (`Closes #6`)
Phase 0 Gate: READY_WITH_FOLLOWUPS
Overall Phase 0: READY_WITH_FOLLOWUPS
```

### Table Context path

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

DBX's public context-menu protocol returns a native toast and does not directly open a Workbench with that context (`CONTEXT_MENU_TO_WORKBENCH_HANDOFF: NOT_PRODUCTIZED`). The Phase 0 Probe therefore uses a two-step flow: save the selected table context, then manually open the Workbench. This UX remains a DBX upstream / product follow-up and is not a metadata feasibility blocker. The handoff uses only the documented plugin backend JSONL protocol; its process is shared per plugin. The in-memory context contains only `connectionId`, optional `database`/`schema`, and `table`, expires after 10 minutes, and is consumed once. The adapter remains the only boundary that reads the DBX raw table payload.

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

Issue #5 的阻塞性 Schema Acquisition Path 已在 DBX v0.6.21 Windows Desktop 上对 MySQL、SQLite、PostgreSQL 完成实测（PR #28）。本 Gate 判定为 `READY_WITH_FOLLOWUPS`：Host API 1.3 未暴露的 PK / FK / UNIQUE / CHECK / Comment / Identity，以及未产品化的 context-menu → Workbench handoff，均为 non-blocking follow-ups。`not_exposed` 仅说明 Host API 未暴露该字段，不代表数据库或 driver 不支持。Issue #6 在本收口 PR 合并前仍为 OPEN；该 PR 使用 `Closes #6`。

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

Phase 1A fixture Core 不依赖 `t8y2/dbx#10043`。Upstream API 已可用，但 Phase 1A 仍只消费 fixtures；正式 metadata domain adapter 需在 Phase 0 Gate 后另行实现，本阶段不复制 Host DTO 或添加 workaround。

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
- Runtime 为 standalone loopback development harness only。当前 DBX `.dbxp` 另含独立 Phase 0 Schema Metadata Probe UI；fixture-driven Phase 1C Workbench 本身仍未 packaged in DBX。
- Phase 1C 完成时 Export 尚未实现；CSV / JSON 后续由 Phase 1D 单独交付。无 Direct Insert。

### Upstream boundary

Upstream `t8y2/dbx#10043` 已 merge（Host API 1.3 可用），但不扩大 Phase 1C；Phase 0 Probe 与 Gate 独立推进，production adapter 仍需后续任务。

## Phase 1D — Deterministic Export Core + Workbench Download（[#23](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/23)）

### 当前状态

- Deterministic CSV / JSON Export Core 与 Workbench Download 已随 PR #24 合并至 `main`（merge commit `1ce80821e41339aaca35cd813b3813d757aa8f86`）；Export 只消费 Workbench 当前已由 Generation Core 产生的 dataset，不重复生成。
- [Phase 1D Export](PHASE1D_EXPORT.md) 记录 dataset contract、Preview / export parity、CSV escaping / spreadsheet-safe / UTF-8 BOM、JSON decimal precision、filename 与 runtime 边界。
- `npm run build` 构建现有 JSONL consumer 与独立的 Phase 0 Metadata Probe UI；Phase 1A–1D fixture Core / Workbench 仍只通过 `npm run workbench` standalone harness 运行，不会被整体打包进 DBX。

### 明确延期 / 边界

- SQL Export deferred：fixture Workbench 没有 production database dialect；不实现 generic SQL serializer。
- 不实现 production `DbxHostSchemaMetadataProvider`、Host-backed Generation、fixture Workbench packaging、PK / UNIQUE / CHECK / FK、Relation Planner 或 SCD。
- CSV / JSON 不依赖 upstream `t8y2/dbx#10043`；该 PR 在 Phase 1D 执行期间已 merge，不扩大本 Issue。

## 后续版本规划

`t8y2/dbx#10043` 已 merge 并随 DBX v0.6.21 发布；Schema Acquisition Path 已在 MySQL / SQLite / PostgreSQL 真实验证并由 PR #28 回填，Issue #5 已关闭。Phase 0 Gate 判定为 `READY_WITH_FOLLOWUPS`；本收口 PR 合并前 Issue #6 仍为 OPEN。后续主线规划为：

```text
Production DBX Metadata Adapter
→ DBX Generation Workbench
→ Column Generation Rules
```

以上仅记录后续产品化方向，不由本 Gate 收口任务实现；约束、关系、SCD、SQL Export 与 Direct Insert 仍需各自立项。该上游 merge 不影响 fixture-driven Export。
