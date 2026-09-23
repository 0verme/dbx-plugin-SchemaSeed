# SchemaSeed

SchemaSeed 是一款 DBX 测试数据生成插件。

当前仓库包含 **Phase 0：Table Context Consumer Probe**、已合并的 **Phase 1A：Fixture-driven Generation Core**，并在推进 **Phase 1B：Semantic Mapping + Person Synthetic Generation**。Phase 1A/1B 只消费 SchemaSeed 内部 `TableSchema` 与本地 fixtures，不依赖 DBX metadata、数据库连接、真实 PII 或 Workbench。

## 当前状态

```text
Table Context:
  source audit: VERIFIED (#9918, latest t8y2/dbx origin/main)
  consumer probe: IMPLEMENTED
  real DBX manual smoke: PENDING USER VERIFICATION

Schema Metadata:
  WAITING_UPSTREAM_9917

Overall Phase 0:
  NOT_CLOSED

Phase 1A:
  fixture Generation Core: IMPLEMENTED (PR #18 merged)
  fixture Preview: IMPLEMENTED

Phase 1B:
  Semantic Mapping + Safe Synthetic Person Preview: IMPLEMENTED in fixture-driven Core (#19)
  DBX Schema Metadata integration: WAITING_UPSTREAM_10043 / Phase 0 Gate
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
```

`npm run build` creates an unsigned `universal` `.dbxp` candidate for the existing Phase 0 probe only; the Phase 1A/1B Core is fixture-tested but is not packaged or wired into DBX. The package uses the DBX-supported JSONL sidecar protocol and a small Unix/Windows launcher pair; the Windows launcher requires Node.js 22+ on the test machine. Enable DBX's **Allow unsigned development package** option before installing the candidate. The current DBX SDK CLI's native backend builder is Rust/Go-only, so this Node sidecar uses the repository-local deterministic packager instead of pretending to be a native backend build.

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

## Boundaries

- Phase 0 Probe 只消费 `t8y2/dbx#9918` table context。
- Generation Core、Semantic / Person generation 与 Preview 只消费 fixture / SchemaSeed domain，不调用 DBX、Tauri 或数据库。
- 不消费 `host.schema.*`、`host.metadata.*`、`getColumns`、`describeTable` 或任何尚未正式验证的 Host method。
- 不执行 `information_schema`、`pg_catalog`、`SHOW COLUMNS`、`SHOW CREATE TABLE` 或 `PRAGMA table_info`。
- 不打开 PostgreSQL、MySQL 或 SQLite 连接。
- 不读取 DBX private Store、credentials、connection strings、private frontend modules、private Tauri commands 或 undocumented APIs。
- 正式 DBX Schema Metadata integration 仍等待 `t8y2/dbx#9917` / upstream PR #10043 merge；该 prerequisite 不阻塞 fixture Core。

## Phase 1 design documents

- [Generation Model（Issue #12）](docs/GENERATION_MODEL.md)：冻结 Column / Semantic / Consistency-Constraint 三层职责、GenerationPlan、deterministic seed 与 diagnostics 边界。
- [Sensitive Synthetic Data（Issue #13，Design Freeze）](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/13)：冻结 Safe Synthetic、Validator-Compatible 边界与 Person identity。

## Long-term direction

以下内容属于 roadmap，不代表当前已经可用：

- Schema-aware generation
- Deterministic seed
- Constraint-aware values
- Relational datasets
- SQL / CSV / JSON export
- Read-only by default

本轮不读取 DBX 私有 Store、Credential 文件或未公开前端模块，不维护第二套数据库连接体系，也不修改 `t8y2/dbx`。Phase 0 Gate 仍是正式 DBX Metadata acquisition/integration 的前置条件；它不阻塞离线 fixture-driven Core 的实现。

## Phase 0 documents

- [Roadmap](docs/ROADMAP.md)
- [Host API Audit](docs/HOST_API_AUDIT.md)
- [Host API Requirements](docs/HOST_API_REQUIREMENTS.md)
- [Phase 0 Feasibility Report](docs/PHASE0_FEASIBILITY_REPORT.md)
