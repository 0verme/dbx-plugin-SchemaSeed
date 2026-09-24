<p align="center">
  <img src="assets/plugin.svg" width="128" alt="SchemaSeed plugin icon">
</p>

<h1 align="center">SchemaSeed</h1>

<p align="center"><strong>Schema-aware, deterministic test data generation for DBX.</strong></p>

<p align="center">
  <a href="https://github.com/t8y2/dbx"><img src="https://img.shields.io/badge/DBX-%3E%3D0.6.19-4c8bf5" alt="DBX >=0.6.19"></a>
  <img src="https://img.shields.io/badge/Host%20API-1.3-6b7280" alt="Host API 1.3">
  <img src="https://img.shields.io/badge/Schema--aware-generation-16875b" alt="Schema-aware generation">
  <img src="https://img.shields.io/badge/Deterministic-seed-7b61a8" alt="Deterministic seed">
</p>

SchemaSeed 是一款面向 DBX 的测试数据生成插件，目标是依据表结构与字段语义生成可复现、安全的测试数据，而不是让用户手工拼接 Faker 脚本。**目前 Schema-aware generation、Workbench Preview 和 CSV / JSON Export 在本地 fixture-driven 开发 Workbench 中运行；DBX 安装包当前只包含独立的 Schema Metadata Probe，不包含生成 Workbench。** Schema Acquisition Path 已在 DBX v0.6.21 Windows Desktop 上通过 MySQL、SQLite、PostgreSQL 真实运行时验证；Phase 0 Gate 仍由独立 Issue #6 评估，因此项目仍处于 early-stage / development 状态。

> Manifest 声明的最低要求为 DBX `>=0.6.19`、Host API `^1.3`。以上真实运行时证据适用于 DBX v0.6.21 Windows Desktop 上的 Phase 0 Probe；不代表生成 Workbench 已集成，也不代表 Phase 0 Gate 已关闭。

## 插件简介

SchemaSeed 要解决的是测试数据与真实 schema 脱节的问题：测试数据需要符合字段类型与长度，常见字段还需要有明确语义；同一组输入也应能重复生成相同结果。SchemaSeed 将这些逻辑放在可检查的 schema model、mapping、generation plan 和 deterministic generator 中，并默认使用 Safe Synthetic 测试数据模式。

当前实现要区分两条路径：离线 fixture 路径已经可以执行 generation、preview 与 export；DBX 生产 metadata 到 generation 的完整链路尚未完成。安装包中的 Phase 0 Probe 用于验证 DBX 的 Table Context / Schema Metadata 获取路径，不会把 fixture generation 伪装成 DBX 已集成能力。

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

### 目标中的 DBX integration path（尚未闭环）

```text
DBX Table Context
    ↓
DBX Host Schema Metadata
    ↓
待实现 / 待验证的 production metadata adapter
    ↓
SchemaSeed TableSchema
    ↓
GenerationPlan → Generator → Preview / Export
```

`getTableMetadata()` consumer probe 已进入当前 `.dbxp` candidate，并已在 DBX v0.6.21 Windows Desktop 上通过 MySQL、SQLite、PostgreSQL 实测；production metadata adapter 及与 generation Workbench 的连接尚未实现。Phase 0 Gate 仍未关闭，等待独立 Issue #6 评估。

## 当前能力

- **Schema-aware generation（fixture）**：根据 SchemaSeed `TableSchema` / `ColumnSchema` 生成与已覆盖字段类型相容的数据；当前 Core 覆盖 integer、decimal、varchar/string、boolean、date 和 timestamp 等基础类型，并遵守已支持的长度、精度和 scale 信息。
- **Deterministic seed**：相同 schema、generation plan、seed、table identity 和 row identity 下，已实现的 plugin-owned 值可重复生成；不会依赖全局随机调用顺序。
- **Semantic mapping**：在 database type 之外，对 `name`、`gender`、`birthday`、`mobile`、`email`、`address` 等有限语义提供候选、confidence、evidence 和 diagnostics。需要确认的候选不会被静默当成确定 mapping。
- **Safe Synthetic person data**：使用明确的测试模式，不读取或复制真实 PII；邮箱使用保留的 `example.com` 测试域名，姓名、手机号和地址使用可识别的测试标记。测试标记不构成零碰撞保证。
- **Generation preview**：本地 Workbench 可检查字段类型、mapping、evidence、diagnostics 和生成样例；只有通过确认的 mapping / override 才会作为相应语义规则使用。
- **CSV / JSON export**：导出 Workbench 当前 preview 使用的同一份 deterministic dataset，不另行生成一份数据。
- **Schema Metadata consumer probe**：安装包通过公开 DBX Host API 1.3 获取 table metadata；Probe 的 Table Context → Host API → columns metadata → SchemaSeed normalization 路径已在 DBX v0.6.21 Windows Desktop 上对 MySQL、SQLite、PostgreSQL 验证通过。

> **Fixture-driven Workbench 不等于已打包进正式 DBX runtime。** 生成、Preview 和 CSV / JSON Export 当前只在 standalone development harness 中可用。

## 当前界面 / Workbench

仓库提供本地 fixture-driven Workbench，可用于选择 schema fixture、配置 row count / seed / locale、检查字段 mapping 与 diagnostics、预览数据并下载 CSV / JSON。当前没有可证明正式 DBX runtime 行为的截图，因此此处不展示伪造的 DBX 截图。DBX 包内的 UI 是独立的 Phase 0 Schema Metadata Probe UI，不是 generation Workbench。

## 安装与当前验证方式

当前没有正式 GitHub Release 或 DBX Store 安装流程。需要 Node.js 22+；在仓库根目录运行：

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run workbench
```

- `npm run build` 生成 unsigned universal `.dbxp` candidate；该包主要用于 Phase 0 Schema Metadata Probe，包含 probe sidecar 和 probe UI，不包含 fixture-driven Generation Workbench。
- DBX 安装这个开发 candidate 时，需要开启允许未签名开发包的选项。它不是正式 release 安装包。
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

DBX 负责连接、凭据和 Host 能力；SchemaSeed 只通过公开 Host API 消费 Table Context / Schema Metadata，不维护第二套 Connection / Credential 系统。当前 generation harness 则仅使用仓库 fixtures。

### 不用私有 introspection workaround 获取 metadata

Production metadata 路径不得绕过 DBX Host API 去执行 `information_schema`、`pg_catalog`、`SHOW COLUMNS`、`SHOW CREATE TABLE` 或 `PRAGMA table_info`。当前没有这类 workaround，也没有自行建立数据库连接的实现。

### Safe Synthetic by default

不读取真实 PII，不复制真实个人信息；测试 email 使用 `example.com`，其他 person 值采用明确测试标记。语义不确定时保留 diagnostics、回退或要求确认，不把推断包装成事实。

### Read-only by default

当前功能仅生成、preview 和 export，不执行 database write。Workbench 是本地开发 harness；`.dbxp` 的 Schema Metadata Probe 只获取 metadata，不写业务数据。

## 当前限制

- 已验证的范围仅为 DBX v0.6.21 Windows Desktop 上 Probe metadata acquisition path；Phase 0 Gate 仍未关闭，不能称为 production-ready。
- 当前 `.dbxp` 只打包 Phase 0 metadata probe；没有 production `DbxHostSchemaMetadataProvider`，fixture generation 与 DBX metadata 尚未打通。
- Fixture-driven Workbench 是 standalone development harness，不是正式 DBX runtime，也没有打包进 `.dbxp`。
- SQL export deferred；当前不生成 relational datasets，不实现 PK / UNIQUE / CHECK / FK 等复杂 constraint engine。
- `validator_compatible` 与中国身份证号校验等能力 unsupported / future；当前 Safe Synthetic 不承诺真实号码校验。
- ambiguous / low-confidence semantic mapping 不会自动作为确定事实；需要 fallback、diagnostics 或显式确认。
- 当前不执行 database write，也不自动导入生成数据。

## 当前开发状态

| Phase | Status | Scope |
| --- | --- | --- |
| Phase 0 | In progress | DBX Table Context + Schema Metadata integration；released-DBX smoke / Gate 待完成 |
| Phase 1A | Implemented | Generation Core + fixture Preview |
| Phase 1B | Implemented | Semantic Mapping + Safe Synthetic |
| Phase 1C | Implemented | Fixture-driven standalone Workbench |
| Phase 1D | Implemented | CSV / JSON Export |

`Implemented` 表示对应阶段的代码已实现，不表示 fixture-driven Generation Workbench 已进入 DBX packaged runtime。详细进度和后续计划见 [Roadmap](docs/ROADMAP.md)。

## 工作原理：DBX Host integration

当前 Probe 的设计路径保留 DBX 原生入口和公开 API 边界：

```text
DBX Sidebar Table Node
  → table context-menu contribution
  → JSONL sidecar 暂存 identity-only TableContext（最多 10 分钟）
  → 用户手动打开 Schema Metadata Probe Workbench
  → sidecar RPC 取回 TableContext
  → window.dbxPlugin.getTableMetadata(TableContext)
  → normalized metadata + diagnostics
```

context-menu → Workbench 的 context handoff 尚未产品化，因此 Phase 0 Probe 使用“右键表并保存 Table Context / 暂存 context，再手动打开 Probe”的两步流程；这是后续 DBX upstream / product UX follow-up，不是 Schema Acquisition Path 技术 blocker。Probe 消费公开 Host API，不读取 private Store、credentials、private frontend module 或 undocumented API。该 runtime evidence 不代表 Phase 0 Gate 已关闭。

## 开发

需要 Node.js 22+。核心验证、静态检查、类型契约检查和 candidate 打包命令见[安装与当前验证方式](#安装与当前验证方式)。本地 fixture harness 可通过 `npm run workbench` 启动。改动 metadata adapter 或 package contract 时，应同时复核 Phase 0 边界和打包内容。

## 项目结构

```text
assets/          SchemaSeed 插件图标
backend/         Phase 0 JSONL sidecar
src/             SchemaSeed Core、semantic、export 与 Host probe 实现
ui/              打包进 .dbxp 的 Phase 0 Probe UI
web/             fixture-driven Workbench 的 standalone UI
fixtures/schemas/ schema fixtures（供 Generation / Workbench 使用）
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
- [Host API Audit](docs/HOST_API_AUDIT.md)：公开 Host API 能力审计。
- [Host API Requirements](docs/HOST_API_REQUIREMENTS.md)：DBX schema metadata 集成要求。
- [Phase 0 Feasibility Report](docs/PHASE0_FEASIBILITY_REPORT.md)：Phase 0 可行性与 Gate 边界。
- [DBX 插件开发文档](https://dbxio.com/en/docs/plugin-development)。

## Roadmap

SchemaSeed 的 DBX metadata integration、generation Workbench packaged runtime 与未来 constraint / relational capabilities 仍按阶段推进。路线图只代表计划，不代表已发布功能；详见 [docs/ROADMAP.md](docs/ROADMAP.md)。
