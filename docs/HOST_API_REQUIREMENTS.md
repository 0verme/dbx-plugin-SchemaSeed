# SchemaSeed Host API Requirements

> Status: Minimal Host API Consumer Contract v0.1; upstream API verified at Host API 1.3
>
> 本文件定义 SchemaSeed 作为 **consumer** 所需要的最小语义契约。Table Context 以 `t8y2/dbx#9918` 的公开实现为准；Schema Metadata 已由 `t8y2/dbx#10043`（merge commit `d5a05a98840e54726bfec0c7dadabb8dc9a4c755`）正式公开。PR #28 已在 DBX v0.6.21 Windows Desktop 上完成 MySQL / SQLite / PostgreSQL runtime smoke；Phase 0 Gate 为 `READY_WITH_FOLLOWUPS`，Issue #6 已由 PR #33 关闭。Production `DbxHostSchemaMetadataProvider` 及其 Core contract/integration tests 已由 #30 实现；本文件仍仅定义 consumer contract，不扩大为 Workbench / Phase 1 UI 规格。

本契约基于已审计的 Phase 0 事实：

- [Table Context 审计](HOST_API_AUDIT.md#table-context) 已验证 #9918：Desktop Sidebar Tree 支持 `menu: "table"`，wire payload 为 `{ table: { connectionId, database?, schema?, table } }`；Object Browser / Web UI 不从该证据外推。
- [Schema Metadata contract](PHASE0_FEASIBILITY_REPORT.md#host-api-13-contract) 已由 merge 后源码与官方文档核实：`host.schema:read`、`schemaMetadataApi`、`window.dbxPlugin.getTableMetadata(...)`，要求 Host API `^1.3`。
- DBX internal capability 不等于 Plugin Host capability。DBX 的 private store、frontend module、Tauri command、HTTP schema route 和 Object Browser state 都不是本契约允许 SchemaSeed 依赖的 API。

## Contract principles

SchemaSeed 的最小消费契约必须保持：

- **Small**：只冻结 table context 和 v0.1 column metadata。
- **DB-neutral**：表达跨 PostgreSQL、MySQL、SQLite 的共同消费语义，不把某个 driver 的内部模型冒充通用 wire shape。
- **Evidence-backed**：要求与 status 以 DBX merge commit 源码、官方 plugin-development 文档和 Phase 0 feasibility report 为依据。
- **Version-minimal**：v0.1 只需要 columns；约束、comment、identity 等能力进入后续版本矩阵。
- **No credentials**：不需要也不得暴露 `host`、`port`、`username`、`password`、`credential` 或 `connectionString`。
- **No private DBX dependency**：不读取 DBX private store、private frontend state、未公开 Tauri/HTTP 接口或 UI route。
- **No second connection**：SchemaSeed 必须复用 DBX 已有 connection/session、schema abstraction 和 driver，不自行建立 PG/MySQL/SQLite 连接。

正式 consumer API 为 `window.dbxPlugin.getTableMetadata({ connectionId, database?, schema?, table })`。`host.metadata.getTable(...)`、`host.schema.getTable(...)` 等相似名称并非该 contract 中的公开方法。

## TableContext Contract

### TableContext internal consumer shape

这是 SchemaSeed 内部 adapter 输出的最小形状；DBX #9918 的 wire payload 将其嵌套在 `params.table` 下：

```ts
interface TableContext {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
}
```

对应 invocation params：

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

`database` 和 `schema` 有值时发送、无值时省略；`connectionId` 与 `table` 必须是 non-empty string。SchemaSeed 不把 display label、connection summary 或空字符串占位转换成 table context。

### Field decisions

| Field | Consumer role | Required consumer semantics | 不允许的替代来源 |
| --- | --- | --- | --- |
| `connectionId` | DBX 稳定 connection identity 的引用 | **Required / VERIFIED**。来自 canonical table node；不是 credential、connection string 或临时 UI node id。 | private store、临时 node id、连接配置文本、credential |
| `database` | 数据库命名空间（若该 driver/连接模型有此维度） | **Optional / VERIFIED**。#9918 有值才发送；无值由 host 省略，SchemaSeed 不从 connection summary 猜测。 | 从 route、DOM、display label 或连接字符串猜测 |
| `schema` | schema 命名空间（若该 driver/连接模型有此维度） | **Optional / VERIFIED**。#9918 有值才发送；无值由 host 省略，driver-specific 适用性仍由 host contract 表达。 | private Vue state、Object Browser state、UI 默认值 |
| `table` | 被调用对象的稳定 table name | **Required / VERIFIED**。来自 canonical `TreeNode.tableName`，不是 display label、拼接后的 node id、DOM 文本、route 参数或 clipboard 内容。 | DOM、route、clipboard、display label、private Vue state |

因此，`connectionId` 与 `table` 是 v0.1 context 的必需消费能力；`database` 与 `schema` 是可选维度，但 optional 不等于可以静默丢失其缺失原因。

### Context source boundary

SchemaSeed 当前合法的 table context 路径是：

```text
DBX Desktop Sidebar Tree table node
→ `contextMenu/<contributionId>`
→ `{ table: { connectionId, database?, schema?, table } }`
→ thin adapter
→ stable internal TableContext
```

该路径只消费 #9918 正式 payload。SchemaSeed 不读取 DBX private state、connection config、display label 或 Object Browser state；Table Context 不因此授权 Metadata API。

## TableMetadata Contract

### TableMetadata conceptual shape

v0.1 只冻结最小 column metadata，不把 SchemaSeed 绑定到大而全的 Schema AST：

```ts
interface TableMetadata {
  columns: ColumnMetadata[];
}

interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;

  length?: number;
  precision?: number;
  scale?: number;

  default?: string;
}
```

这些 interface 是 consumer-side conceptual shape：

- `columns` 是 v0.1 所需的列集合；其来源必须是 DBX existing schema abstraction 和 driver/session path。
- `name`、`dataType`、`nullable` 是每个 column 的 required consumer capability。
- `length`、`precision`、`scale` 是需要被支持并表达缺失语义的 optional structured values；它们不是所有 driver 都必然有值。
- `default` 是最小文本语义，允许是 literal text 或 expression text；v0.1 不定义 `default_kind`，也不区分 `LiteralDefault`、`ExpressionDefault`、`GeneratedDefault` 或 `SequenceDefault`。
- `dataType` 保留 DBX driver 当前提供的 native/general database type 表达。本阶段不引入 `SemanticType`、`LogicalType` 或 `GeneratorType`。
- v0.1 不要求 `TableMetadata` 现在携带 primary key、foreign key、unique、check、comment、identity / auto increment 或 indexes；这些能力见 [Future Capabilities](#future-capabilities)。

### v0.1 Required

下列七项是 SchemaSeed v0.1 的 required consumer capabilities：

- **name**：稳定的 column name；不能用 display label 或 UI 顺序标识替代。
- **data type / `dataType`**：DBX driver 的 native/general type 表达；不在 Host boundary 做 semantic inference。
- **nullable**：必须能明确表示 nullability；unknown 不能静默转换为 `false`。
- **length**：若 driver 提供结构化长度则可消费；没有结构化值时必须表达 unavailable，而不是 `0`。
- **precision**：若 driver 提供结构化 precision 则可消费；没有结构化值时必须表达 unavailable，而不是 `0`。
- **scale**：若 driver 提供结构化 scale 则可消费；没有结构化值时必须表达 unavailable，而不是 `0`。
- **default**：若存在，提供最小文本或 expression text；没有 default、driver 未提供、Host 不支持和调用失败不能被同一个空值静默混淆。

这里的 “required” 是对 consumer contract 的能力要求，不宣称每个数据库、每个 column 都有每一项的 concrete value。对于 driver 合法缺失的值，Host boundary 必须保留可区分的语义；具体 result shape、error type、capability negotiation 和 nullability representation 留给 upstream design。

## Capability Matrix

下表中的 PostgreSQL / MySQL / SQLite 列只描述 `HOST_API_AUDIT.md` 已确认的 **DBX internal capability**，不表示第三方插件当前可以调用。`Current Plugin API` 专门表示 public Plugin Host 状态。

| Capability | v0.1 Required | Consumer Requirement | PostgreSQL | MySQL | SQLite | Current Plugin API |
| --- | --- | --- | --- | --- | --- | --- |
| table-scoped invocation | Yes | 从具体 table 入口获得 context | DBX internal table node/native menu；Sidebar Tree 已接入 #9918 | 同上 | 同上 | **A / VERIFIED（Desktop Sidebar Tree）** |
| `connectionId` | Yes | 稳定引用 DBX existing connection/session | canonical table node field | canonical table node field | canonical table node field | **A / VERIFIED** |
| `database` | Optional | value exists 时消费；未提供时保持 omitted | table node 可携带 | table node 可携带 | 可能不适用同一 database 维度 | **A / VERIFIED（optional）** |
| `schema` | Optional | value exists 时消费；未提供时保持 omitted | table node 可选 | table node 可选 | 不保证存在与 PG 相同的 schema 维度 | **A / VERIFIED（optional）** |
| `table` | Yes | stable database object name，不是 display label | canonical `TreeNode.tableName` | canonical `TreeNode.tableName` | canonical `TreeNode.tableName` | **A / VERIFIED** |
| `columns` | Yes | `PluginTableMetadata.columns` 由 Host API 1.3 返回 | `ColumnInfo` / schema core：internal PASS | `ColumnInfo` / schema core：internal PASS | `ColumnInfo` / schema core：internal PASS | `RUNTIME_VERIFIED` (PR #28) |
| column name | Yes | required `name` string | internal PASS | internal PASS | internal PASS | `RUNTIME_VERIFIED` (PR #28) |
| data type | Yes | required `dataType` string；不引入 semantic type | `format_type(...)` 等 native/general path：internal PASS | `COLUMN_TYPE` 等 native/general path：internal PASS | `PRAGMA table_info.type`：internal PASS | `RUNTIME_VERIFIED` (PR #28) |
| nullable | Yes | required boolean `nullable` | internal PASS | internal PASS | internal PASS | `RUNTIME_VERIFIED` (PR #28) |
| length | Yes, when structured value exists | optional integer/null；`fieldCapabilities.length` preserves provenance | internal PASS | internal PASS | structured value `MISSING`；declared type text 可能仍含信息 | `RUNTIME_VERIFIED`; provider values vary |
| precision | Yes, when structured value exists | optional integer/null；`fieldCapabilities.precision` preserves provenance | internal PASS | internal PASS | structured value `MISSING` | `RUNTIME_VERIFIED`; provider values vary |
| scale | Yes, when structured value exists | optional integer/null；`fieldCapabilities.scale` preserves provenance | internal PASS | internal PASS | structured value `MISSING` | `RUNTIME_VERIFIED`; provider values vary |
| default | Yes, when a default is exposed | optional string/null；`fieldCapabilities.default` preserves provenance | internal PASS；可能是 expression text | internal PASS；raw default text | internal PASS；`dflt_value` text | `RUNTIME_VERIFIED`; provider values vary |

**Matrix reading rule：** Table Context 的 `A / VERIFIED` 只适用于 DBX #9918 已公开的 Desktop Sidebar Tree payload。Host API 1.3 提供窄化 Metadata response；具体 optional-field provenance 由 `fieldCapabilities` 返回。PR #28 已在 DBX v0.6.21 Windows Desktop 对 PostgreSQL / MySQL / SQLite 完成 smoke。Object Browser / Web table menu 不从该矩阵外推。

## Driver Differences

### PostgreSQL

- DBX Host API 1.3 对外返回 common `dataType`、`nullable` 与可选 structured fields；PR #28 已在 DBX v0.6.21 Windows Desktop 的 PostgreSQL smoke 中验证调用与规范化结果。
- database 与 schema 是可选 identity scope；省略时 DBX 使用已知的配置/default scope（若可用），没有匹配已打开 session 时拒绝请求。
- comment、constraints、identity 不在 Host API 1.3 response 中，也不进入 v0.1 required contract。

### MySQL

- DBX Host API 1.3 对外返回 common `dataType`、`nullable` 与可选 structured fields；PR #28 已在 DBX v0.6.21 Windows Desktop 的 MySQL smoke 中验证调用与规范化结果。
- MySQL 的 database/schema scope 由 canonical Table Context 与 DBX 已打开的 session 解析；SchemaSeed 不重建命名空间或连接语义。
- default 在 v0.1 保留为 Host 返回的 optional text，不把 `EXTRA` 重新设计成 typed default/identity model。

### SQLite

- DBX Host API 1.3 返回窄化的 column metadata；optional numeric fields 仍可能省略或为 `null`，`fieldCapabilities` 提供 upstream provenance，不能从 declared type string 自行推断数值。
- SQLite 不提供与 PostgreSQL 相同的 server database/schema 语义；这些 context 维度可能 legitimately not applicable 或 unavailable。
- PR #28 已在 DBX v0.6.21 Windows Desktop 的 SQLite smoke 中验证实际 metadata response 与 provenance。

## Missing / Unsupported Semantics

SchemaSeed 至少需要区分以下五类 consumer 语义。这里将实际 Host API 1.3 response 中的 omitted/null、field provenance 与 Promise rejection 分开处理：

| Semantic state | Consumer meaning | Example | Consumer behavior |
| --- | --- | --- | --- |
| **value exists** | Host/driver 返回了可消费的稳定值 | column `name`、PostgreSQL 的 numeric precision | 消费该值，不再从 UI 或 type text 反推 |
| **legitimately absent / not applicable** | 该维度对当前 database model 不适用，或数据库明确没有该值 | SQLite 的 server-style schema/database 维度；没有 default 的 column | 作为正常语义处理，不当作调用失败 |
| **driver does not expose structured value** | driver 可能有声明文本或内部线索，但没有结构化字段 | SQLite 的 length / precision / scale | 保留 unavailable 语义，不把它转成 `0`，也不要求 SchemaSeed 解析 workaround |
| **Host API does not support capability** | 当前宿主缺少该 Host capability，或某字段被明确标记 unsupported | `capabilities.schemaMetadataApi` 缺失/false；或 `fieldCapabilities` 为 `unsupported`。PK/FK 等字段不在 API 1.3 response | 保留 unavailable / not-exposed provenance，不读取 private DBX boundary |
| **Host / driver call failed** | 本次获取发生调用、session 或 driver failure | 连接/session 错误或 metadata 调用失败 | 保留 failure 语义；不降级为 missing 或 legitimately absent |

特别规则：

- `database` / `schema` 在 #9918 table context 中无值时被省略；不能从 saved connection menu 的 `connection.database` 或空字符串占位推断 table scope。
- `length` / `precision` / `scale` 的 missing 不能简单等价于 `0`。
- `default` 的 absent 不能与空文本、driver unsupported、Host unsupported 或调用失败混为一个 optional omission。
- Host API 1.3 已定义 optional values 与 `fieldCapabilities`。Probe 保留 DTO 的 omitted/null；#30 adapter 映射 `supported + value → known`、`supported + null → absent`、`supported + omitted → unavailable`、`unknown → unknown`、`unsupported → unsupported`，并在 domain fact 上保留 capability provenance。`unknown` 下的显式非空值仍保留为 known，同时记录 unknown provenance；不会凭 omission 推断 `not_applicable`。
- Host 调用失败仍以 Promise rejection 暴露，没有独立结构化 error-code enum；#30 将其转换为带 actionable diagnostic 的 provider error，不返回空 schema 或 fixture。
- Required fields (`connectionId`、`table`、column `name` / `dataType` / `nullable`) 如果无法提供，必须进入可识别的 invalid/unavailable/failure 语义，不能静默使用 display label、默认值或推断值。

## Future Capabilities

以下 metadata 能力不属于 v0.1 required contract。Host API 1.3 明确不在 response 中返回它们；本 Probe 记录为 `not_exposed`，不宣称 provider `unsupported`，也不实现消费逻辑。Table Context 不在此 future list 中。

| Version | Capability | Host API 1.3 response status | Consumer scope |
| --- | --- | --- | --- |
| v0.2 | comment | `NOT_EXPOSED_BY_HOST_API_1_3` | Future only |
| v0.3 | primary key | `NOT_EXPOSED_BY_HOST_API_1_3` | Future only |
| v0.3 | unique | `NOT_EXPOSED_BY_HOST_API_1_3` | Future only |
| v0.3 | check | `NOT_EXPOSED_BY_HOST_API_1_3` | Future only |
| v0.3 | identity / auto increment | `NOT_EXPOSED_BY_HOST_API_1_3` | Future only |
| v0.4 | foreign key | `NOT_EXPOSED_BY_HOST_API_1_3` | Future only |

本轮不为这些 future capabilities 增加 Host contract 或实现消费逻辑。

## Upstream Contract and Runtime Validation

`t8y2/dbx#9918` 与 `t8y2/dbx#10043` 均已 merge。Table Context 与 Host API 1.3 的 public source contract 已确认；PR #28 已在 DBX v0.6.21 Windows Desktop 对 PostgreSQL / MySQL / SQLite 完成 runtime smoke。没有新的 v0.1 blocking upstream API gap 被本 Probe 发现。

### Table Context outcome

`t8y2/dbx#9918` 已提供正式、公开、版本化的 Sidebar Tree table-scoped invocation/context：

```text
具体 table 入口
→ stable connection identity
→ optional database/schema
→ stable table name
→ `{ table: { ... } }` sidecar invocation
```

SchemaSeed 已实现薄 adapter 与 probe；不把该能力外推到 Object Browser 或 Web UI。DBX v0.6.21 Probe runtime 通过 10 分钟 plugin-owned in-memory state 和公开 backend RPC 完成两步传递，该路径已纳入 PR #28 runtime evidence（historical Phase 0 evidence）。上游 #10244 已 merge 并随 DBX v0.6.23 正式发布，正式提供 context-menu → `open-workbench` handoff；其 runtime smoke 属于 #31 且仍 pending manual execution。production manifest 已移除遗留的 table context-menu probe 入口；Schema Metadata Probe Workbench 保留为插件详情页手动入口。

### Host API 1.3 — Resolved Metadata Host Boundary

`t8y2/dbx#10043` 已提供正式、公开的 metadata Host boundary，使 SchemaSeed 在已有 `TableContext` 下复用；#30 的 production adapter 已按此契约将返回 DTO 映射到 SchemaSeed-owned facts：

```text
TableContext
→ DBX existing connection/session
→ DBX schema abstraction
→ DBX driver
→ normalized consumer metadata
```

最低 v0.1 metadata requirement：

- `columns`
- column `name`
- native/general `dataType`
- explicit `nullable`
- structured `length`、`precision`、`scale`（可按 driver 合法 unavailable）
- minimal text `default`（可为 expression text）

该 boundary 必须：

- 复用 DBX 已有 connection/session、schema core 和 driver path，不把 Tauri command、HTTP schema route、Object Browser state 或 private frontend module 作为插件 API。
- response 通过 `fieldCapabilities` 与 omitted/null 表达 optional-field provenance；call/session failures 以 Promise rejection 返回。#30 将上述状态保留在 SchemaSeed facts 与 provider diagnostic 中，不伪造数字、布尔值或空文本。
- 插件不得建立自己的 PostgreSQL、MySQL 或 SQLite connection，也不得执行 `information_schema`、`pg_catalog`、`PRAGMA` 等 workaround。
- 正式 permission、capability、request/response 和版本策略见 [Phase 0 report](PHASE0_FEASIBILITY_REPORT.md#host-api-13-contract)。

### #30 adapter mapping status

```text
fieldCapabilities = supported + concrete value  → known
fieldCapabilities = supported + explicit null   → absent
fieldCapabilities = supported + omitted         → unavailable
fieldCapabilities = unknown                     → unknown (non-null returned value remains known)
fieldCapabilities = unsupported                 → unsupported
identity not present in Host API 1.3             → unknown, provenance=not_exposed
Host/API failure                                → typed provider error + blocking diagnostic
```

`not_exposed` 是来源 / 暴露边界，不转换成 `unsupported`；该 adapter 不从数据库类型文本推导缺失的结构化字段，也不把缺失字段标为 `not_applicable`。

## Explicit non-goals

本契约文档不实现也不冻结：

- Generator、Faker、Semantic Inference、SchemaModel、Constraint Engine、Relation Planner。
- SQL / CSV / JSON exporter、正式/fixture-driven Workbench、Direct Insert、Rust sidecar 或 AI；本仓库另有范围受限的 Phase 0 Probe Workbench。
- 数据库 direct connection、第二套连接体系、credential 读取。
- `information_schema`、`pg_catalog`、`PRAGMA`、`SHOW CREATE TABLE` 等数据库 introspection workaround。
- DBX private store、private frontend module、未公开 Tauri/HTTP API 或 Object Browser state。
- 在本契约中定义 production adapter / Host-backed Generation、future constraint consumption，以及正式/fixture Workbench packaging；production adapter / Core contract path 由 #30 实现，正式 Workbench/package 实现由 #31 交付（参见 [Phase 1E](PHASE1E_PRODUCTION_WORKBENCH.md)）。

## Phase 0 position

本文件记录 consumer requirements 与已验证的正式 API contract；Phase 0 Gate 决定见 feasibility report。Runtime evidence 来自已合并的 PR #28。

```text
Table Context: VERIFIED_SOURCE_CONTRACT
Schema Metadata Host API: RELEASED (DBX v0.6.21, Host API 1.3)
Consumer Probe: IMPLEMENTED / RUNTIME_VALIDATED (PR #28)
Production metadata adapter: IMPLEMENTED (#30)
Runtime Matrix: MySQL PASS / SQLite PASS / PostgreSQL PASS (Probe, DBX v0.6.21)
Issue #5: CLOSED (PR #28)
Issue #6: CLOSED (PR #33)
Phase 0 Gate: READY_WITH_FOLLOWUPS
Upstream context-menu → open-workbench: RELEASED in DBX v0.6.23 (t8y2/dbx#10244)
```

`t8y2/dbx#10043` 已 merge；PR #28 验证了 DBX v0.6.21 Windows Desktop 上的 PostgreSQL / MySQL / SQLite Probe 路径。#30 实现 production adapter 与 Generation Core contract tests；#31 已完成正式 Workbench integration/package implementation。DBX v0.6.23 是首个正式包含 #10244 的 release，manifest floor 已对齐 `>=0.6.23`；正式 runtime smoke 仍 pending manual execution，详见 [Phase 1E](PHASE1E_PRODUCTION_WORKBENCH.md)。

## Evidence references

- [DBX Host API Audit — Table Context](HOST_API_AUDIT.md#table-context)
- [DBX Host API Audit — Schema Metadata](HOST_API_AUDIT.md#schema-metadata)
- [DBX Host API Audit — Public Host API evidence](HOST_API_AUDIT.md#public-host-api-evidence)
- [DBX Host API Audit — Future Capability Matrix](HOST_API_AUDIT.md#future-capability-matrix)
- [Phase 0 Roadmap](ROADMAP.md)
