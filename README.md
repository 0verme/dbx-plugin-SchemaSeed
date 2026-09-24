<p align="center">
  <img src="assets/plugin.svg" width="128" alt="SchemaSeed plugin icon">
</p>

<h1 align="center">SchemaSeed</h1>

<p align="center"><strong>Schema-aware, deterministic test data generation for DBX.</strong></p>

<p align="center">
  <a href="https://github.com/t8y2/dbx/releases"><img src="https://img.shields.io/badge/DBX-runtime%20smoke%20pending%20release-8a5a0a" alt="DBX runtime smoke pending release"></a>
  <img src="https://img.shields.io/badge/Host%20API-1.3-6b7280" alt="Host API 1.3">
  <img src="https://img.shields.io/badge/Schema--aware-generation-16875b" alt="Schema-aware generation">
  <img src="https://img.shields.io/badge/Deterministic-seed-7b61a8" alt="Deterministic seed">
</p>

SchemaSeed 是一款面向 DBX 的测试数据生成插件，可从当前 DBX 表 metadata 生成 deterministic synthetic test data，并提供 Preview 与 CSV / JSON 导出。Issue #31 的正式 Workbench、Host provider wiring、`open-workbench` manifest contribution 和 `.dbxp` packaging implementation 已完成；**正式 DBX runtime smoke 尚未完成**。上游 `t8y2/dbx#10244` 已合并，但 DBX 最新正式版仍为 v0.6.22（该版本早于 #10244），所以当前 `.dbxp` 仅是 implementation candidate，不应安装到 v0.6.22 或发布。Phase 0 Gate 为 `READY_WITH_FOLLOWUPS`：DBX v0.6.21 Windows Desktop 的 MySQL、SQLite、PostgreSQL Probe runtime smoke 均 PASS，Issue #6 已由 PR #33 关闭。

> Manifest 暂保留历史 DBX floor `>=0.6.19` 与 Host API `^1.3`；该 floor **不覆盖**新增的 `context-menu.action.open-workbench` contract。DBX v0.6.22 runtime 对未知 context-menu 字段采用严格解析，会拒绝包含新 `action` 的 manifest。待上游正式 release 发布后，必须先确认实际版本、更新 floor，再做 runtime smoke；这里不猜测未发布版本号。Host API 当前未暴露 PK、FK、UNIQUE、CHECK、Comment、Identity，这些仍是非阻塞 follow-ups。

## 插件简介

SchemaSeed 要解决的是测试数据与真实 schema 脱节的问题：测试数据需要符合字段类型与长度，常见字段还需要有明确语义；同一组输入也应能重复生成相同结果。SchemaSeed 将这些逻辑放在可检查的 schema model、mapping、generation plan 和 deterministic generator 中，并默认使用 Safe Synthetic 测试数据模式。

当前实现保留两条明确隔离的路径：standalone `web/` harness 只读取仓库 fixtures；正式 DBX Workbench 直接消费 DBX TableContext 与公开 metadata Host API，经 #30 provider 接入现有 Generation Core。正式 Workbench 不 fallback fixtures；Phase 0 Probe 仍是独立 contribution。

## 工作方式

### 当前可运行：fixture-driven generation

```text
Schema Fixture
    ↓
SchemaSeed TableSchema / ColumnSchema
    ↓
Semantic Mapping + Diagnostics
    ↓
GenerationPlan
    ↓
Deterministic Generator
    ↓
Workbench Preview → CSV / JSON
```

此路径使用仓库 fixtures，不读取 DBX 表或数据库。相同 schema、plan、seed 和 row identity 可重复生成相同的逻辑数据。

### DBX production path（#31 implementation ready；runtime smoke pending release）

```text
DBX Sidebar table
  → 右键「生成测试数据」
  → #10244 declarative open-workbench（TableContext 本身）
  → DbxHostSchemaMetadataProvider
  → SchemaSeed TableSchema
  → GenerationPlan → generateRows()
  → Preview → CSV / JSON
```

正式 Workbench 使用公开 Host metadata API 与现有 Core。Preview / export 共用同一 dataset；A→B→C context refresh 会立即清空旧 metadata、plan 和 dataset，并丢弃迟到的旧请求。

## 当前能力

- **Schema-aware generation（fixture）**：根据 SchemaSeed `TableSchema` / `ColumnSchema` 生成与已覆盖字段类型相容的数据；当前 Core 覆盖 integer、decimal、varchar/string、boolean、date 和 timestamp 等基础类型，并遵守已支持的长度、精度和 scale 信息。
- **Deterministic seed**：相同 schema、generation plan、seed、table identity 和 row identity 下，已实现的 plugin-owned 值可重复生成；不会依赖全局随机调用顺序。
- **Semantic mapping**：在 database type 之外，对 `name`、`gender`、`birthday`、`mobile`、`email`、`address` 等有限语义提供候选、confidence、evidence 和 diagnostics。需要确认的候选不会被静默当成确定 mapping。
- **Safe Synthetic person data**：使用明确的测试模式，不读取或复制真实 PII；邮箱使用保留的 `example.com` 测试域名，姓名、手机号和地址使用可识别的测试标记。测试标记不构成零碰撞保证。
- **Generation preview**：本地 Workbench 可检查字段类型、mapping、evidence、diagnostics 和生成样例；只有通过确认的 mapping / override 才会作为相应语义规则使用。
- **CSV / JSON export**：导出 Workbench 当前 preview 使用的同一份 deterministic dataset，不另行生成一份数据。
- **Schema Metadata consumer probe**：安装包通过公开 DBX Host API 1.3 获取 table metadata；Probe 的 Table Context → Host API → columns metadata → SchemaSeed normalization 路径已在 DBX v0.6.21 Windows Desktop 上对 MySQL、SQLite、PostgreSQL 验证通过。
- **Production metadata adapter（#30）**：`DbxHostSchemaMetadataProvider` 将公开 Host response 映射为 SchemaSeed-owned facts；现已在正式 Workbench path 中调用，并将 normalized schema 送入现有 Generation Core。
- **正式 DBX Generation Workbench（#31）**：显示当前 database / schema / table、字段类型、generator / semantic mapping、diagnostics、Rows / Seed / Locale、Preview 与 CSV / JSON。Manifest 通过 `context-menu` 的 `open-workbench` action 直接接入 #10244。
- **Runtime compatibility**：DBX v0.6.22 不含 #10244，且旧 runtime 严格拒绝未知 `action` 字段；正式版本 floor 与 runtime smoke 等上游正式 release 后确认。

## 当前界面 / Workbench

仓库保留独立 fixture-driven development harness；DBX `.dbxp` candidate 现已另外包含正式 Generation Workbench UI/runtime modules 与独立 Phase 0 Probe。由于 #10244 尚未出现在正式 DBX release，本仓库没有 runtime smoke 证据或截图，不展示伪造的 DBX 行为。

## 安装与当前验证方式

当前没有正式 GitHub Release 或 DBX Store 安装流程。需要 Node.js 22+；在仓库根目录运行：

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run workbench
```

- `npm run build` 生成 unsigned universal `.dbxp` implementation candidate，包含 Phase 0 Probe、正式 Workbench UI、production adapter / Core runtime 与 manifest contributions；内容审计会排除 `web/`、`fixtures/`、fixture provider/controller、tests 和开发 server。
- 该 candidate 不是当前正式 DBX 的安全安装包：DBX v0.6.22 不含 #10244，且旧 runtime 会拒绝新 `action` manifest contract。不要在包含 #10244 的正式 DBX release 与 floor 更新前发布或尝试 runtime smoke。
- `npm run workbench` 启动本地 fixture-only development harness（默认 loopback 地址 `http://127.0.0.1:4173`）；它不连接 DBX 或数据库。

## 使用方式

运行 `npm run workbench` 并在本地开发 harness 中：

1. 选择一个仓库内的 schema fixture，设置行数、seed 与 locale。
2. 检查 detected semantic、confidence、evidence 和 diagnostics；按需确认 mapping 或设置 explicit override。
3. 查看 preview。使用相同 seed 与相同 plan 可复现结果；更换 seed 可生成另一组数据。
4. 下载 CSV 或 JSON。导出复用当前 preview 的 dataset。

该流程是 fixture 驱动的本地开发体验，不会自动选中 DBX 中打开的表，也不会向业务数据库写入数据。

## Semantic Mapping 与 Safe Synthetic

schema type 与业务语义是两类信息。例如 `VARCHAR(18)` 只表示受长度约束的字符串，不代表身份证号。SchemaSeed 的语义识别使用列名、schema family 和已知长度等有限 evidence；unknown、ambiguous、low-confidence 或不兼容候选会保留 diagnostics，并回退到 schema-type generation 或要求显式确认，而不是大胆猜测。

当前 Person 语义生成只提供 Safe Synthetic 模式。它不读取真实行样本、不访问外部服务、不依赖 AI / Faker，也不复制真实个人信息。生成值带测试标记（邮箱使用 `example.com`）；这些约定用于降低误用风险，不承诺测试值在现实世界中绝无碰撞。`validator_compatible`（包括中国身份证号校验等）当前不支持。

## Deterministic Seed

生成值按 seed、table / column / row identity 和 rule identity 派生，而不是依赖“随机函数被调用了几次”。在 schema、plan、seed、locale 等影响因素不变时，same-seed regenerate、Preview 与 Export 使用同一套逻辑值。改变 seed、mapping、rule 或 identity 时，相应值可能变化；这不是跨 schema 重命名或跨未来算法版本的永久兼容承诺。

## Export

当前实现 CSV 与 JSON Export，序列化 Workbench 已生成的数据集：

- CSV 保持 schema 列顺序，处理分隔符与引号；Workbench 下载默认使用 UTF-8 BOM 和 spreadsheet-safe 字符串处理。
- JSON 保留 `null` / boolean 等类型；decimal 值以精确字符串保留。
- Preview 和两种导出格式使用相同的当前 dataset。

SQL export deferred：在没有正式 DBX metadata / dialect 集成及可靠方言语义前，不生成通用 INSERT SQL。

## 安全边界

### 不直接读取数据库凭据

DBX 负责连接、凭据和 Host 能力；正式 Workbench 只通过公开 Host API 消费当前 TableContext / Schema Metadata，不维护第二套 Connection / Credential 系统。standalone harness 则仅使用仓库 fixtures。

### 不用私有 introspection workaround 获取 metadata

Production metadata 路径不得绕过 DBX Host API 去执行 `information_schema`、`pg_catalog`、`SHOW COLUMNS`、`SHOW CREATE TABLE` 或 `PRAGMA table_info`。当前没有这类 workaround，也没有自行建立数据库连接的实现。

### Safe Synthetic by default

不读取真实 PII，不复制真实个人信息；测试 email 使用 `example.com`，其他 person 值采用明确测试标记。语义不确定时保留 diagnostics、回退或要求确认，不把推断包装成事实。

### Read-only by default

当前功能仅生成、preview 和 export，不执行 database write。正式 Workbench 使用 DBX Host metadata、不读取真实行样本；独立 Probe 仅读取 metadata。

## 当前限制

- Phase 0 Gate 为 `READY_WITH_FOLLOWUPS`，Issue #6 已关闭：已验证范围是 DBX v0.6.21 Windows Desktop 上的 Probe metadata acquisition path；这不代表 SchemaSeed production-ready。
- `.dbxp` packaging implementation 已包含正式 Generation Workbench；由于 DBX v0.6.22 未包含 #10244，目前保持 `IMPLEMENTATION_READY_RUNTIME_SMOKE_PENDING`，不作为正式发行包。
- Fixture-driven Workbench 仍只是独立开发 harness；production Workbench 不包含 fixture fallback 或 fixture runtime dependency。
- SQL export deferred；当前不生成 relational datasets，不实现 PK / UNIQUE / CHECK / FK 等复杂 constraint engine。
- `validator_compatible` 与中国身份证号校验等能力 unsupported / future；当前 Safe Synthetic 不承诺真实号码校验。
- ambiguous / low-confidence semantic mapping 不会自动作为确定事实；需要 fallback、diagnostics 或显式确认。
- 当前不执行 database write，也不自动导入生成数据。

## 当前开发状态

| Phase | Status | Scope |
| --- | --- | --- |
| Phase 0 | READY_WITH_FOLLOWUPS | DBX v0.6.21 Windows Desktop：MySQL / SQLite / PostgreSQL PASS；Issue #6 已由 PR #33 关闭 |
| Phase 1A | Implemented | Generation Core + fixture Preview |
| Phase 1B | Implemented | Semantic Mapping + Safe Synthetic |
| Phase 1C | Implemented | Fixture-driven standalone Workbench |
| Phase 1D | Implemented | CSV / JSON Export |
| Production DBX metadata adapter (#30) | Implemented | Public Host metadata → SchemaSeed facts → existing Generation Core |
| Generation Workbench (#31) | Implementation ready | Packaged production UI / runtime / direct table action; official DBX runtime smoke pending release containing #10244 |

`Implemented` 表示代码与 package implementation 已完成，不表示 runtime smoke 或 Issue #31 acceptance 已完成。详细状态见 [Roadmap](docs/ROADMAP.md)。

## 工作原理：DBX Host integration

正式 Generation Workbench path：

```text
DBX Sidebar Table
  → context-menu: open-workbench（#10244）
  → Workbench receives direct TableContext
  → DbxHostSchemaMetadataProvider → TableSchema
  → GenerationPlan → generateRows() → Preview / CSV / JSON
```

#10244 合同传给 Workbench 的是 TableContext 本身（不是 legacy `{ table: ... }` envelope）；`database` / `schema` 仍为 optional。重用 Workbench tab 时 `onContext` 刷新触发 metadata / plan / preview 失效，并保护免于迟到请求覆盖新表。Phase 0 Probe 仍保留为单独入口，历史 v0.6.21 smoke 曾使用 legacy 暂存 context 的两步流程。当前正式 DBX 仍为 v0.6.22，发布晚于 #10244 merge 前，因此 release smoke 与最终 manifest DBX floor pending next official release。两条路径均不读取 private Store、credential、private frontend/Tauri API，也不建立第二连接。

## 开发

需要 Node.js 22+。核心验证、静态检查、类型契约检查和 candidate 打包命令见[安装与当前验证方式](#安装与当前验证方式)。本地 fixture harness 可通过 `npm run workbench` 启动。改动 metadata adapter 或 package contract 时，应同时复核 Phase 0 边界和打包内容。

## 项目结构

```text
assets/          SchemaSeed 插件图标
backend/         Probe 与 Workbench runtime JSONL entrypoint
src/             Core、production provider、export、generation runtime 与 Workbench controller
ui/              打包进 .dbxp 的 Workbench UI 与独立 Phase 0 Probe UI
web/             fixture-driven Workbench 的 standalone UI（不打包）
fixtures/schemas/ standalone harness / tests 使用的 fixtures（不打包）
scripts/         build、workbench、lint 与验证脚本
tests/           Core、Workbench、Probe 与 package contract tests
docs/            architecture、Host API 与 roadmap 文档
manifest.json    DBX plugin manifest
dbx-plugin.toml  DBX plugin package configuration
```

## 文档

- [Roadmap](docs/ROADMAP.md)：阶段状态、Gate 与后续方向。
- [Generation Model](docs/GENERATION_MODEL.md)：schema / semantic / constraints / deterministic seed 的模型边界。
- [Phase 1A Architecture](docs/PHASE1A_ARCHITECTURE.md)：Generation Core 与 fixture Preview。
- [Phase 1B Architecture](docs/PHASE1B_ARCHITECTURE.md)：Semantic Mapping 与 Safe Synthetic。
- [Phase 1C Workbench](docs/PHASE1C_WORKBENCH.md)：fixture Workbench、UI 状态与运行时边界。
- [Phase 1D Export](docs/PHASE1D_EXPORT.md)：CSV / JSON dataset 与 Export 约定。
- [Phase 1E Production Workbench](docs/PHASE1E_PRODUCTION_WORKBENCH.md)：DBX runtime 架构、context refresh、package 边界与 release smoke gate。
- [Host API Audit](docs/HOST_API_AUDIT.md)：公开 Host API 能力审计。
- [Host API Requirements](docs/HOST_API_REQUIREMENTS.md)：DBX schema metadata 集成要求。
- [Phase 0 Feasibility Report](docs/PHASE0_FEASIBILITY_REPORT.md)：Phase 0 可行性与 Gate 边界。
- [DBX 插件开发文档](https://dbxio.com/en/docs/plugin-development)。

## Roadmap

SchemaSeed 的正式 Workbench/package implementation 已完成；包含 #10244 的正式 DBX release runtime smoke 与兼容 floor 仍 pending。后续 Column Rule Editor 由 #32 单独推进；路线图状态见 [docs/ROADMAP.md](docs/ROADMAP.md)。
