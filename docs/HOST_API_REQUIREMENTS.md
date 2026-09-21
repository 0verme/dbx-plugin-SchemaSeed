# SchemaSeed Host API Requirements

> Status: Minimal Host API Consumer Contract v0.1
>
> 本文件定义 SchemaSeed 作为 **consumer** 所需要的最小语义契约，不是 DBX 已接受、已实现或已承诺的 Host API 设计。文中的 TypeScript 形状只用于表达消费侧需求，不冻结 DBX 的 method name、namespace、permission、SDK package、RPC、Rust enum、wire representation、版本策略或错误类型。

本契约基于已合并的 Phase 0 审计事实：

- [Table Context 审计](HOST_API_AUDIT.md#table-context) 的结论是 `NOT_PUBLICLY_SUPPORTED`：正式 Plugin Context Menu 目前只覆盖 saved connection，没有 table-scoped contribution，也没有向第三方插件公开完整 table context。
- [Schema Metadata 审计](HOST_API_AUDIT.md#schema-metadata) 的结论是 `NOT_PUBLICLY_SUPPORTED`：DBX 内部已有 schema core、`ColumnInfo` 及目标 driver 路径，但当前没有公开的 metadata Host API、permission、SDK type 或 Plugin Host bridge dispatch。
- DBX 内部 capability 存在，不等于 Plugin Host capability 已存在。DBX 的 private store、frontend module、Tauri command、HTTP schema route 和 Object Browser state 都不是本契约允许 SchemaSeed 依赖的 API。

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

### TableContext conceptual shape

以下是消费侧的概念形状，不是 DBX SDK interface 或最终 wire schema：

```ts
interface TableContext {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
}
```

`database?` 和 `schema?` 只表示这两个维度对所有目标数据库不是统一必有字段；它们的缺省、不可用和错误语义不能由 TypeScript optional property 单独决定。上游必须提供足够的语义，使 SchemaSeed 能区分这些状态；最终使用 `null`、`undefined`、discriminated result 或其他表示方式属于 upstream design pending。

### Field decisions

| Field | Consumer role | Required consumer semantics | 不允许的替代来源 |
| --- | --- | --- | --- |
| `connectionId` | DBX 稳定 connection identity 的引用 | **Required**。必须是 DBX 可稳定识别现有 connection/session 的 identity；不是 credential、connection string，也不是临时 UI node id。SchemaSeed 只把它交还给 Host 边界使用。当前 saved connection menu 已有 `connection.id`，但尚无完整 table-scoped context contract。 | private store、临时 node id、连接配置文本、credential |
| `database` | 数据库命名空间（若该 driver/连接模型有此维度） | **Optional**。PostgreSQL、MySQL、SQLite 对 database 的语义不完全相同；consumer 必须能区分 value exists、legitimately not applicable / absent、driver 或 Host 未暴露，而不能把 missing 和空字符串当成同一语义。 | 从 route、DOM、display label 或连接字符串猜测 |
| `schema` | schema 命名空间（若该 driver/连接模型有此维度） | **Optional**。PostgreSQL 有明确 schema 语义；MySQL 的 database/schema 关系不能未经契约直接等同；SQLite 不提供相同的 server schema 维度。consumer 必须能区分 value exists、legitimately not applicable / absent、driver 未提供和 Host capability 不支持。 | private Vue state、Object Browser state、UI 默认值 |
| `table` | 被调用对象的稳定 table name | **Required**。必须是稳定的数据库对象名，不是 display label、拼接后的 node id、DOM 文本、route 参数或 clipboard 内容。缺少该值时不能由 SchemaSeed 推断。 | DOM、route、clipboard、display label、private Vue state |

因此，`connectionId` 与 `table` 是 v0.1 context 的必需消费能力；`database` 与 `schema` 是可选维度，但 optional 不等于可以静默丢失其缺失原因。

### Context source boundary

SchemaSeed 需要的合法路径是：

```text
DBX table-scoped invocation
→ stable TableContext
→ DBX existing connection/session
```

当前 DBX 的 connection context menu payload 中存在 `connection.id` 和 connection-level `database`，但该入口只对应 saved connection，不是被点击 table 的 context。DBX 内部已有 database/schema/table node 和 native menu，仍不能把它们当作第三方插件可访问的 table-scoped API。

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
| table-scoped invocation | Yes | 从具体 table 入口获得 context | DBX internal table node/native menu；无 plugin target | DBX internal table node/native menu；无 plugin target | DBX internal table node/native menu；无 plugin target | `NOT_PUBLICLY_SUPPORTED` |
| `connectionId` | Yes | 稳定引用 DBX existing connection/session | saved connection identity internal/public connection payload；无 table-scoped payload | 同上；无 table-scoped payload | 同上；无 table-scoped payload | `NOT_PUBLICLY_SUPPORTED`（仅有 saved-connection `connection.id`，不满足 table scope） |
| `database` | Optional | value / legitimately absent / driver or Host unavailable 必须可区分 | connection/tree model 可携带；table-scoped public payload 缺失 | connection/tree model 可携带；database 与 schema 语义不能直接等同；table-scoped public payload 缺失 | 可能不适用同一 database 维度；table-scoped public payload 缺失 | `NOT_PUBLICLY_SUPPORTED`（当前字段不是 table context） |
| `schema` | Optional | value / legitimately absent / driver or Host unavailable 必须可区分 | internal tree/object model 可选；无 table-scoped public payload | internal tree/object model 可选；无 table-scoped public payload | 不保证存在与 PG 相同的 schema 维度 | `NOT_PUBLICLY_SUPPORTED` |
| `table` | Yes | stable database object name，不是 display label | internal table object name；无 table-scoped public payload | internal table object name；无 table-scoped public payload | internal table object name；无 table-scoped public payload | `NOT_PUBLICLY_SUPPORTED` |
| `columns` | Yes | `TableMetadata.columns` 来自 DBX schema abstraction | `ColumnInfo` / schema core：internal PASS | `ColumnInfo` / schema core：internal PASS | `ColumnInfo` / schema core：internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| column name | Yes | stable column name | internal PASS | internal PASS | internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| data type | Yes | native/general database type text；不引入 semantic type | `format_type(...)` 等 native/general path：internal PASS | `COLUMN_TYPE` 等 native/general path：internal PASS | `PRAGMA table_info.type`：internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| nullable | Yes | explicit boolean nullability | internal PASS | internal PASS | internal PASS | `NOT_PUBLICLY_SUPPORTED` |
| length | Yes, when structured value exists | structured number 或明确 unavailable；不能用 `0` 表示 missing | internal PASS | internal PASS | structured value `MISSING`；declared type text 可能仍含信息 | `NOT_PUBLICLY_SUPPORTED` |
| precision | Yes, when structured value exists | structured number 或明确 unavailable；不能用 `0` 表示 missing | internal PASS | internal PASS | structured value `MISSING` | `NOT_PUBLICLY_SUPPORTED` |
| scale | Yes, when structured value exists | structured number 或明确 unavailable；不能用 `0` 表示 missing | internal PASS | internal PASS | structured value `MISSING` | `NOT_PUBLICLY_SUPPORTED` |
| default | Yes, when a default is exposed | minimal text/expression text，并区分 absent、unsupported 和 failed | internal PASS；可能是 expression text | internal PASS；raw default text | internal PASS；`dflt_value` text | `NOT_PUBLICLY_SUPPORTED` |

**Matrix reading rule：** DBX internal `PASS` 只表示 audited driver/schema path 已有能力；它绝不升级为 Plugin API `PASS`。当前没有任何一项完整的 v0.1 table-scoped acquisition contract 达到 public Plugin Host `PASS`。

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
| **Host API does not support capability** | DBX 内部可能有路径，但 public Plugin Host 没有该 capability | 当前 table-scoped context 和 metadata API | 标记为 Host API gap，不读取 private DBX boundary |
| **Host / driver call failed** | 本次获取发生调用、session 或 driver failure | 连接/session 错误或 metadata 调用失败 | 保留 failure 语义；不降级为 missing 或 legitimately absent |

特别规则：

- `database` / `schema` 的 missing 不能简单等价于 `""`；当前 saved connection menu 对缺省 `connection.database` 的空字符串归一化是 existing payload 行为，不是 table context contract。
- `length` / `precision` / `scale` 的 missing 不能简单等价于 `0`。
- `default` 的 absent 不能与空文本、driver unsupported、Host unsupported 或调用失败混为一个 optional omission。
- SchemaSeed 不要求上游现在采用 `null`、`undefined`、tagged union、error object 或 capability negotiation；这些表示法都是 **upstream design pending**。
- Required fields (`connectionId`、`table`、column `name` / `dataType` / `nullable`) 如果无法提供，必须进入可识别的 invalid/unavailable/failure 语义，不能静默使用 display label、默认值或推断值。

## Future Capabilities

以下能力不属于 v0.1 required contract，只记录已审计的 DBX internal 状态和 roadmap 归类。它们仍没有 public Plugin Host capability。

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

以下是从 consumer contract 提炼出的两个独立、可直接转为 upstream requirement 的 gap。本轮只记录需求，不创建 `t8y2/dbx` Issue，也不预先指定 DBX 的实现 API。

### Gap A — Table-scoped Plugin Context

DBX 需要提供一种正式、公开、版本可兼容的 table-scoped plugin invocation/context 能力，使 SchemaSeed 能够：

```text
从具体 table 入口被调用
→ 获得稳定 connection identity
→ 获得适用时的 database
→ 获得适用时的 schema
→ 获得稳定 table name
```

最低要求：

- `connectionId` 必须引用 DBX existing connection/session，不暴露 credential、connection string 或 private store。
- `database`、`schema` 必须能表达 present、legitimately absent/not applicable、driver/Host unavailable；不要求所有 driver 强行提供同一语义。
- `table` 必须是稳定 object name，不得要求插件从 DOM、route、clipboard、display label 或 private Vue state 反推。
- 该 gap 的 contribution target、manifest permission、SDK type、payload nesting、RPC method、namespace 和 version name 均 **upstream design pending**。

### Gap B — Schema Metadata Host Boundary

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

本文件只完成 Issue #4 的 consumer contract 收敛，不关闭 Phase 0 Gate，也不把任何假想 API 写成 DBX 已实现事实。

根据已完成审计，当前应保持：

```text
Schema Acquisition Path:
BLOCKED BY PUBLIC HOST API GAPS
```

最终 `BLOCKED` / `READY` / `READY_WITH_FOLLOWUPS` 仍由 Issue #5 / #6 在 Probe 和 Gate 阶段正式确认。

## Evidence references

- [DBX Host API Audit — Table Context](HOST_API_AUDIT.md#table-context)
- [DBX Host API Audit — Schema Metadata](HOST_API_AUDIT.md#schema-metadata)
- [DBX Host API Audit — Public Host API evidence](HOST_API_AUDIT.md#public-host-api-evidence)
- [DBX Host API Audit — Future Capability Matrix](HOST_API_AUDIT.md#future-capability-matrix)
- [Phase 0 Roadmap](ROADMAP.md)
