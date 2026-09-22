# SchemaSeed Host API Requirements

> Status: Minimal Host API Consumer Contract v0.1
>
> 本文件定义 SchemaSeed 作为 **consumer** 所需要的最小语义契约。Table Context 已按 `t8y2/dbx#9918` 的最终公开实现对齐；Schema Metadata 仍等待未合并的 `t8y2/dbx#9917`。文中的 TypeScript 形状区分 SchemaSeed 内部消费形状与 DBX wire nesting，不冻结尚未公开的 metadata method、namespace、permission、SDK package、RPC、Rust enum、版本策略或错误类型。

本契约基于已审计的 Phase 0 事实：

- [Table Context 审计](HOST_API_AUDIT.md#table-context) 已验证 #9918：Desktop Sidebar Tree 支持 `menu: "table"`，wire payload 为 `{ table: { connectionId, database?, schema?, table } }`；Object Browser / Web UI 不从该证据外推。
- [Schema Metadata 审计](HOST_API_AUDIT.md#schema-metadata) 的结论仍是 `NOT_PUBLICLY_SUPPORTED`：DBX 内部已有 schema core、`ColumnInfo` 及目标 driver 路径，但没有公开的 metadata Host API、permission、SDK type 或 Plugin Host bridge dispatch；严格等待 #9917。
- DBX internal capability 不等于 Plugin Host capability。DBX 的 private store、frontend module、Tauri command、HTTP schema route 和 Object Browser state 都不是本契约允许 SchemaSeed 依赖的 API。

## Contract principles

SchemaSeed 的最小消费契约必须保持：

- **Small**：只冻结 table context 和 v0.1 column metadata。
- **DB-neutral**：表达跨 PostgreSQL、MySQL、SQLite 的共同消费语义，不把某个 driver 的内部模型冒充通用 wire shape。
- **Evidence-backed**：每项要求都以 `HOST_API_AUDIT.md` 已确认的 DBX 内部事实和公开 API 缺口为依据。
- **Version-minimal**：v0.1 只需要 columns；约束、comment、identity 等能力进入后续版本矩阵。
- **No credentials**：不需要也不得暴露 `host`、`port`、`username`、`password`、`credential` 或 `connectionString`。
- **No private DBX dependency**：不读取 DBX private store、private frontend state、未公开 Tauri/HTTP 接口或 UI route。
- **No second connection**：SchemaSeed 必须复用 DBX 已有 connection/session、schema abstraction 和 driver，不自行建立 PG/MySQL/SQLite 连接。

本文不规定一个假想的 API 调用名。特别是，`host.metadata.getTable(...)`、`host.schema.getTable(...)` 等名称均不是本契约的正式 API。

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
| `columns` | Yes | `TableMetadata.columns` 来自 DBX schema abstraction | `ColumnInfo` / schema core：internal PASS | `ColumnInfo` / schema core：internal PASS | `ColumnInfo` / schema core：internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| column name | Yes | stable column name | internal PASS | internal PASS | internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| data type | Yes | native/general database type text；不引入 semantic type | `format_type(...)` 等 native/general path：internal PASS | `COLUMN_TYPE` 等 native/general path：internal PASS | `PRAGMA table_info.type`：internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| nullable | Yes | explicit boolean nullability | internal PASS | internal PASS | internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| length | Yes, when structured value exists | structured number 或明确 unavailable；不能用 `0` 表示 missing | internal PASS | internal PASS | structured value `MISSING`；declared type text 可能仍含信息 | `NOT_PUBLICLY_SUPPORTED` |
| precision | Yes, when structured value exists | structured number 或明确 unavailable；不能用 `0` 表示 missing | internal PASS | internal PASS | structured value `MISSING` | `NOT_PUBLICLY_SUPPORTED` |
| scale | Yes, when structured value exists | structured number 或明确 unavailable；不能用 `0` 表示 missing | internal PASS | internal PASS | structured value `MISSING` | `NOT_PUBLICLY_SUPPORTED` |
| default | Yes, when a default is exposed | minimal text/expression text，并区分 absent、unsupported 和 failed | internal PASS；可能是 expression text | internal PASS；raw default text | internal PASS；`dflt_value` text | `NOT_PUBLICLY_SUPPORTED` |

**Matrix reading rule：** Table Context 的 `A / VERIFIED` 只适用于 DBX #9918 已公开的 Desktop Sidebar Tree payload；Metadata 的 DBX internal `PASS` 仍绝不升级为 Plugin API `PASS`。Object Browser / Web table menu 不从该矩阵外推。

## Driver Differences

### PostgreSQL

- DBX internal schema path 可以提供 native/general `data_type`、nullable、结构化 length、precision、scale 和 default expression text。
- database 与 schema 都可能是有意义的命名空间，但 consumer 仍不能假设它们永远存在；缺省语义必须由 Host/driver 明确表达。
- comment、constraints、identity 等内部能力不进入 v0.1 required contract。
- 以上均是 DBX internal evidence；当前没有向第三方插件公开的 metadata Host boundary。

### MySQL

- DBX internal schema path 可以提供 native/general type、nullable、结构化 length、precision、scale、`COLUMN_DEFAULT` 和相关 column metadata。
- MySQL 的 database/schema 使用方式不能未经上游契约直接套用 PostgreSQL 的二层命名空间假设。
- default 在 v0.1 保留为最小文本语义，不把 `EXTRA` 重新设计成 typed default/identity model。
- 以上均是 DBX internal evidence；当前没有向第三方插件公开的 metadata Host boundary。

### SQLite

- DBX internal path 可以提供 column name、declared type text、nullable 和 `dflt_value`。
- 当前结构化 length、precision、scale 为 missing；declared type string 可能包含 `VARCHAR(100)` 或 `DECIMAL(18,2)` 等信息，但这不等于 DBX 已提供结构化 numeric fields。SchemaSeed 不得把 `None`、空值或 `0` 当作真实的 length/precision/scale。
- SQLite 不提供与 PostgreSQL 相同的 server database/schema 语义；这些 context 维度可能 legitimately not applicable 或 unavailable。
- 以上均是 DBX internal evidence；当前没有向第三方插件公开的 metadata Host boundary。

## Missing / Unsupported Semantics

SchemaSeed 至少需要区分以下五类 consumer 语义。这里定义的是语义要求，不定义 DBX 最终 wire-level result 或 error schema：

| Semantic state | Consumer meaning | Example | Consumer behavior |
| --- | --- | --- | --- |
| **value exists** | Host/driver 返回了可消费的稳定值 | column `name`、PostgreSQL 的 numeric precision | 消费该值，不再从 UI 或 type text 反推 |
| **legitimately absent / not applicable** | 该维度对当前 database model 不适用，或数据库明确没有该值 | SQLite 的 server-style schema/database 维度；没有 default 的 column | 作为正常语义处理，不当作调用失败 |
| **driver does not expose structured value** | driver 可能有声明文本或内部线索，但没有结构化字段 | SQLite 的 length / precision / scale | 保留 unavailable 语义，不把它转成 `0`，也不要求 SchemaSeed 解析 workaround |
| **Host API does not support capability** | DBX 内部可能有路径，但 public Plugin Host 没有该 capability | 当前 schema metadata API；Object Browser / Web table menu 也不在 #9918 范围 | 标记为 Host API gap，不读取 private DBX boundary |
| **Host / driver call failed** | 本次获取发生调用、session 或 driver failure | 连接/session 错误或 metadata 调用失败 | 保留 failure 语义；不降级为 missing 或 legitimately absent |

特别规则：

- `database` / `schema` 在 #9918 table context 中无值时被省略；不能从 saved connection menu 的 `connection.database` 或空字符串占位推断 table scope。
- `length` / `precision` / `scale` 的 missing 不能简单等价于 `0`。
- `default` 的 absent 不能与空文本、driver unsupported、Host unsupported 或调用失败混为一个 optional omission。
- SchemaSeed 不要求上游现在采用 `null`、`undefined`、tagged union、error object 或 capability negotiation；这些表示法都是 **upstream design pending**。
- Required fields (`connectionId`、`table`、column `name` / `dataType` / `nullable`) 如果无法提供，必须进入可识别的 invalid/unavailable/failure 语义，不能静默使用 display label、默认值或推断值。

## Future Capabilities

以下 metadata 能力不属于 v0.1 required contract，只记录已审计的 DBX internal 状态和 roadmap 归类。它们仍没有 public Plugin Host capability；Table Context 不在此 future list 中。

| Version | Capability | Current DBX internal fact | Consumer contract status |
| --- | --- | --- | --- |
| v0.2 | comment | PostgreSQL / MySQL 有内部路径；SQLite 缺少统一 comment 能力 | Future only；`NOT_PUBLICLY_SUPPORTED` |
| v0.3 | primary key | 三个目标 driver 有一定 column/index/constraint 能力，但 composite shape 不统一 | Future only；`NOT_PUBLICLY_SUPPORTED` |
| v0.3 | unique | `IndexInfo` 提供较好的内部基础，但 column-level / constraint-level 形状不完全统一 | Future only；`NOT_PUBLICLY_SUPPORTED` |
| v0.3 | check | PostgreSQL 有 structured path；MySQL / SQLite 当前缺少统一 structured path | Future only；`NOT_PUBLICLY_SUPPORTED` |
| v0.3 | identity / auto increment | 主要落在自由文本 `extra`，没有 typed cross-driver abstraction | Future only；`NOT_PUBLICLY_SUPPORTED` |
| v0.4 | foreign key | 三类目标 driver 均有内部读取能力，但 composite FK grouping 不统一 | Future only；`NOT_PUBLICLY_SUPPORTED` |

本轮不为这些 future capability 设计字段、permission、API method、wire shape 或错误模型。

## Upstream Gaps

以下记录剩余的 metadata upstream requirement；Table Context 的 Sidebar Tree gap 已由 #9918 关闭。本轮只记录需求，不创建 `t8y2/dbx` Issue，也不预先指定 DBX 的 metadata 实现 API。

### Table Context outcome

`t8y2/dbx#9918` 已提供正式、公开、版本化的 Sidebar Tree table-scoped invocation/context：

```text
具体 table 入口
→ stable connection identity
→ optional database/schema
→ stable table name
→ `{ table: { ... } }` sidecar invocation
```

SchemaSeed 已实现薄 adapter 与 probe；不把该能力外推到 Object Browser 或 Web UI。真实 Windows DBX smoke 仍待用户环境验证。

### Gap A — Schema Metadata Host Boundary

DBX 需要提供一个正式、公开的 metadata Host boundary，使 SchemaSeed 在已有 `TableContext` 下复用：

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

- 复用 DBX 已有 connection/session、schema core 和 driver path。
- 将 DBX internal capability 与 public Plugin Host capability 分开，不把 Tauri command、HTTP schema route、Object Browser state 或 private frontend module 作为插件 API。
- 保留 absent、driver structured value missing、Host unsupported 和 call failure 的可区分语义。
- 不要求插件建立自己的 PostgreSQL、MySQL 或 SQLite connection，不执行 `information_schema`、`pg_catalog`、`PRAGMA` 等 workaround。
- 将 error type、result shape、capability negotiation、nullability representation、permission 名称、SDK package、API namespace、RPC method 和 version policy 留给 upstream design。

## Explicit non-goals

本契约不实现也不冻结：

- Generator、Faker、Semantic Inference、SchemaModel、Constraint Engine、Relation Planner。
- SQL / CSV / JSON exporter、Workbench、Direct Insert、Rust sidecar 或 AI。
- 数据库 direct connection、第二套连接体系、credential 读取。
- `information_schema`、`pg_catalog`、`PRAGMA`、`SHOW CREATE TABLE` 等数据库 introspection workaround。
- DBX private store、private frontend module、未公开 Tauri/HTTP API 或 Object Browser state。
- DBX upstream 的 method name、namespace、manifest permission、SDK package、RPC shape、Rust enum、wire representation、error model 或最终版本策略。

## Phase 0 position

本文件只完成 consumer contract 收敛，不关闭 Phase 0 Gate，也不把任何假想 Metadata API 写成 DBX 已实现事实。

根据已完成审计，当前应保持：

```text
Table Context / Desktop Sidebar Tree:
VERIFIED_SOURCE_CONTRACT

Schema Metadata:
WAITING_UPSTREAM_9917

Schema Acquisition Path:
BLOCKED BY PUBLIC HOST API GAPS
```

真实 Windows DBX smoke 与后续 Metadata API 仍是独立 gate；本 Probe 不消费未合并的 #9917。

## Evidence references

- [DBX Host API Audit — Table Context](HOST_API_AUDIT.md#table-context)
- [DBX Host API Audit — Schema Metadata](HOST_API_AUDIT.md#schema-metadata)
- [DBX Host API Audit — Public Host API evidence](HOST_API_AUDIT.md#public-host-api-evidence)
- [DBX Host API Audit — Future Capability Matrix](HOST_API_AUDIT.md#future-capability-matrix)
- [Phase 0 Roadmap](ROADMAP.md)
