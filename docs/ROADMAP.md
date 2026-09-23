# SchemaSeed Roadmap

> 本文件只同步本任务真实进度，不提前关闭 Phase 0，也不把 DBX 未公开 API 写成已实现事实。

## Phase 0 — Feasibility / Host API

### 目标

确认 DBX 能通过正式插件协议提供：

- Table Context
- Schema Metadata

### 当前状态

```text
Table Context:
  source audit: VERIFIED (#9918, latest t8y2/dbx origin/main)
  consumer probe: IMPLEMENTED
  real DBX manual smoke: PENDING USER VERIFICATION

Schema Metadata:
  UPSTREAM_READY_FOR_NEXT_PHASE (#10043 merged; Phase 0 Gate pending)

Overall Phase 0:
  NOT_CLOSED
```

### Table Context path

```text
DBX Sidebar Table Node
  → `context-menu` + `menu: "table"`
  → `contextMenu/io.github.0verme.schema-seed.table-context-probe`
  → SchemaSeed JSONL backend
  → TableContext adapter
  → native DBX toast
```

The adapter is the only boundary that reads the DBX raw table payload. SchemaSeed's internal consumer shape is intentionally separate from the DBX wire shape.

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

当前不是 `READY`：Table Context 仍需 Windows DBX 手工验证，Schema Metadata 等待 `t8y2/dbx#9917`。

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

Phase 1A fixture Core 不依赖 `t8y2/dbx#10043` merge。Upstream PR #10043 已在 Phase 1D 执行期间 merge；正式 DBX Schema Metadata acquisition / adapter 仍需独立验证与 Phase 0 Gate。该状态记为 `UPSTREAM_READY_FOR_NEXT_PHASE`；本仓库不得在 Phase 1A 中提前复制 Host API / DTO 或添加 workaround。

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
- Runtime 为 standalone loopback development harness only。当前 DBX `.dbxp` build / manifest 仍只包含 Phase 0 JSONL probe；Workbench 未 packaged in DBX。
- Phase 1C 完成时 Export 尚未实现；CSV / JSON 后续由 Phase 1D 单独交付。无 Direct Insert。

### Upstream boundary

Upstream `t8y2/dbx#10043` 已 merge 并记录为 `UPSTREAM_READY_FOR_NEXT_PHASE`，但不扩大 Phase 1C；正式 adapter 需独立 Issue 与 Phase 0 Gate。

## Phase 1D — Deterministic Export Core + Workbench Download（[#23](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/23)）

### 当前状态

- Deterministic CSV / JSON Export Core 与 Workbench Download 已在 `feat/phase1d-export` 实现并完成检查，PR review pending；Export 只消费 Workbench 当前已由 Generation Core 产生的 dataset，不重复生成。
- [Phase 1D Export](PHASE1D_EXPORT.md) 记录 dataset contract、Preview / export parity、CSV escaping / spreadsheet-safe / UTF-8 BOM、JSON decimal precision、filename 与 runtime 边界。
- `npm run build` 仍仅构建 Phase 0 `.dbxp` probe；Workbench 继续通过 `npm run workbench` 运行 standalone harness。

### 明确延期 / 边界

- SQL Export deferred：fixture Workbench 没有 production database dialect；不实现 generic SQL serializer。
- 不实现 DBX metadata adapter、DBX Workbench packaging、PK / UNIQUE / CHECK / FK、Relation Planner 或 SCD。
- CSV / JSON 不依赖 upstream `t8y2/dbx#10043`；该 PR 在 Phase 1D 执行期间已 merge，仅记录 `UPSTREAM_READY_FOR_NEXT_PHASE`，不扩大本 Issue。

## 后续版本规划

`t8y2/dbx#10043` 已 merge；后续顺序仍为 Phase 0 Metadata Consumer Probe → Phase 0 Gate → 独立实现 `DbxHostSchemaMetadataProvider` → DBX packaged Workbench。本轮只记录 `UPSTREAM_READY_FOR_NEXT_PHASE`，不提前消费或猜测其 method、permission、SDK type 或 wire shape；该上游 merge 不影响 fixture-driven Export。
