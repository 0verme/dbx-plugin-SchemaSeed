# SchemaSeed

SchemaSeed 是一款 DBX 测试数据生成插件。

当前仓库包含 **Phase 0：Table Context Consumer Probe**、已合并的 **Phase 1A：Fixture-driven Generation Core**、已合并的 **Phase 1B：Semantic Mapping + Person Synthetic Generation**、已合并的 **Phase 1C：Fixture-driven Workbench**，以及 **Phase 1D：Deterministic CSV / JSON Export**。Phase 1A–1D 只消费 SchemaSeed 内部 `TableSchema` 与本地 fixtures，不依赖 DBX metadata、数据库连接或真实 PII。

## 当前状态

```text
Table Context:
  source audit: VERIFIED (#9918, latest t8y2/dbx origin/main)
  consumer probe: IMPLEMENTED
  real DBX manual smoke: PENDING USER VERIFICATION

Schema Metadata:
  UPSTREAM_READY_FOR_NEXT_PHASE (#10043 merged; Phase 0 Gate pending)

Overall Phase 0:
  NOT_CLOSED

Phase 1A:
  fixture Generation Core: IMPLEMENTED (PR #18 merged)
  fixture Preview: IMPLEMENTED

Phase 1B:
  Semantic Mapping + Safe Synthetic Person Preview: IMPLEMENTED (PR #20 merged)
  DBX Schema Metadata integration: UPSTREAM_READY_FOR_NEXT_PHASE / Phase 0 Gate pending

Phase 1C:
  fixture-driven Workbench: IMPLEMENTED (#21)
  runtime: STANDALONE DEVELOPMENT HARNESS ONLY (not packaged in DBX)
  Export: CSV / JSON via the current generated dataset; SQL deferred

Phase 1D:
  Deterministic CSV / JSON Export: READY (Issue #23; PR review pending)
  SQL export: DEFERRED
```

## Probe architecture

```text
DBX Sidebar Table Node
  → native `context-menu` contribution (`menu: "table"`)
  → `contextMenu/io.github.0verme.schema-seed.table-context-probe`
  → JSONL sidecar
  → `normalizeTableContextPayload`
  → internal `TableContext`
  → native DBX toast with JSON
```

The adapter consumes only the #9918 payload:

```json
{
  "table": {
    "connectionId": "...",
    "database": "...",
    "schema": "...",
    "table": "..."
  }
}
```

`TableContext` is SchemaSeed's internal consumer contract. It is not a claim that DBX's wire payload has the same top-level shape. The probe is stateless, drops unknown fields, fails closed on missing required fields, and never reads credentials or metadata.

## Local verification

Node.js 22+ is used only for this lightweight probe sidecar and its tests:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run workbench
```

`npm run build` creates an unsigned `universal` `.dbxp` candidate for the existing Phase 0 probe only; the Phase 1A–1C Core and Workbench are not packaged or wired into DBX. `npm run workbench` starts a standalone fixture-only UI harness at `http://127.0.0.1:4173`; it is not a DBX Workbench runtime. The probe package uses the DBX-supported JSONL sidecar protocol and a small Unix/Windows launcher pair; the Windows launcher requires Node.js 22+ on the test machine. Enable DBX's **Allow unsigned development package** option before installing the candidate. The current DBX SDK CLI's native backend builder is Rust/Go-only, so this Node sidecar uses the repository-local deterministic packager instead of pretending to be a native backend build.

## Phase 1A — Generation Core + Fixture Preview（Issue #17）

```text
FixtureSchemaMetadataProvider
   ↓
SchemaSeed TableSchema
   ↓ Schema Interpretation
GenerationPlan
   ↓
Deterministic Generation Engine
   ↓
Preview Rows + Diagnostics
```

- [Phase 1A Architecture](docs/PHASE1A_ARCHITECTURE.md) 说明 domain、plan、seed、fixtures 与边界。
- 当前唯一 metadata provider 是 `FixtureSchemaMetadataProvider`；**fixtures 不是 production metadata source**。
- 未来 DBX Host metadata 必须在独立 adapter 中转换为 SchemaSeed domain；本次没有实现该 adapter，也不复制 upstream DTO。

## Phase 1B — Semantic Mapping + Person Synthetic Generation（Issue #19）

```text
TableSchema
   ↓ deterministic inference + explicit/confirmed mapping
Person semantic group
   ↓
GenerationPlan
   ↓ random-access, per-rule generation
Safe Synthetic fixture preview
```

- Semantic type 不等于 database type；inference 输出离散 confidence、evidence 与 source。Person semantic mapping 需显式 override 或 confirmed mapping 后才启用生成；未知/歧义保留 schema fallback 与 diagnostics。
- 支持 `name / gender / birthday / mobile / email / address`；Person group 可部分存在，多组由 options 显式声明，不做复杂自动聚类或生成隐藏字段。
- Safe Synthetic 默认；邮箱使用 `example.com`，mobile/name/address 使用显式测试 pattern。确定性 identity 包含 seed、table、group、row、locale 与 semantic rule identity；不承诺现实世界绝无碰撞。
- [Phase 1B Architecture](docs/PHASE1B_ARCHITECTURE.md) 记录 mapping、group、locale、diagnostics 与范围边界。
- 本期不实现 Validator-Compatible 中国身份证算法、DBX metadata adapter、Workbench UI 或 exporter。

## Phase 1C — Fixture-driven Workbench（Issue #21）

- [Phase 1C Workbench](docs/PHASE1C_WORKBENCH.md) 记录 Information Architecture、ViewModel boundary、confirmation、diagnostics、preview 与 fixture-only/runtime 边界。
- Native HTML/CSS/JS + Node built-ins；通过 `npm run workbench` 启动 loopback standalone harness，不新增外部 UI dependency。
- `WorkbenchController` 使用 `FixtureSchemaMetadataProvider`，构建现有 `GenerationPlan` 并调用现有 `generateRows()`；不复制 inference、RNG 或 generation rules。
- Rows 默认 20、限制 1–100；支持 seed、same-seed Regenerate、New Seed 和 Core 支持的 `zh-CN` / `en`。
- Mapping candidate 保持未确认，用户通过 confirmed mapping 或 explicit override 操作；Person Groups、evidence 和 diagnostics 来自 Core plan。
- **未 packaged in DBX**：当前 manifest / `.dbxp` 仍只包含 Phase 0 JSONL probe。Phase 1D 在 Workbench 层序列化既有 generated dataset；upstream #10043 已 merge，但 metadata adapter 仍需独立 Phase 0 Gate 与后续阶段。

## Phase 1D — Deterministic Export Core + Workbench Download（Issue #23）

- [Phase 1D Export](docs/PHASE1D_EXPORT.md) 记录 ExportDataset contract、Preview / export parity、CSV / JSON semantics 与 runtime 边界。
- CSV / JSON 只序列化 Workbench 已通过 `generateRows(plan)` 生成的同一份 dataset；独立 Export Core 不依赖 UI、fixture provider、DBX 或 database driver。
- CSV 明确支持 UTF-8、Workbench UTF-8 BOM、column order、escaping、empty-field NULL 和默认 spreadsheet-safe 下载；JSON 保留 null / boolean 类型、精确 decimal string 与稳定列顺序。
- Workbench 使用 browser Blob / object URL 下载。`npm run build` 与 Phase 0 `.dbxp` probe packaging 不变。
- **SQL Export deferred**：没有可靠 production dialect 时不实现 generic SQL serializer。Upstream #10043 在 Phase 1D 执行期间已 merge；记录为 `UPSTREAM_READY_FOR_NEXT_PHASE`，本 Issue 不加入 metadata adapter 或 Workbench packaging，Phase 0 Gate 仍需单独完成。

## Boundaries

- Phase 0 Probe 只消费 `t8y2/dbx#9918` table context。
- Generation Core、Semantic / Person generation、Preview 与 Workbench 只消费 fixture / SchemaSeed domain，不调用 DBX、Tauri 或数据库。
- 不消费 `host.schema.*`、`host.metadata.*`、`getColumns`、`describeTable` 或任何尚未正式验证的 Host method。
- 不执行 `information_schema`、`pg_catalog`、`SHOW COLUMNS`、`SHOW CREATE TABLE` 或 `PRAGMA table_info`。
- 不打开 PostgreSQL、MySQL 或 SQLite 连接。
- 不读取 DBX private Store、credentials、connection strings、private frontend modules、private Tauri commands 或 undocumented APIs。
- Upstream `t8y2/dbx#10043` 已 merge；记录状态为 `UPSTREAM_READY_FOR_NEXT_PHASE`。正式 DBX Schema Metadata integration 仍需独立 Phase 0 Gate 与后续阶段，不阻塞 fixture-driven Workbench / Export。

## Phase 1 design documents

- [Generation Model（Issue #12）](docs/GENERATION_MODEL.md)：冻结 Column / Semantic / Consistency-Constraint 三层职责、GenerationPlan、deterministic seed 与 diagnostics 边界。
- [Sensitive Synthetic Data（Issue #13，Design Freeze）](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/13)：冻结 Safe Synthetic、Validator-Compatible 边界与 Person identity。

## Long-term direction

以下内容属于 roadmap，不代表当前已经可用：

- Schema-aware generation
- Deterministic seed
- Constraint-aware values
- Relational datasets
- SQL export (deferred; CSV / JSON delivered in Phase 1D)
- Read-only by default

本轮不读取 DBX 私有 Store、Credential 文件或未公开前端模块，不维护第二套数据库连接体系，也不修改 `t8y2/dbx`。Phase 0 Gate 仍是正式 DBX Metadata acquisition/integration 的前置条件；它不阻塞离线 fixture-driven Core 的实现。

## Phase 0 documents

- [Roadmap](docs/ROADMAP.md)
- [Host API Audit](docs/HOST_API_AUDIT.md)
- [Host API Requirements](docs/HOST_API_REQUIREMENTS.md)
- [Phase 0 Feasibility Report](docs/PHASE0_FEASIBILITY_REPORT.md)
