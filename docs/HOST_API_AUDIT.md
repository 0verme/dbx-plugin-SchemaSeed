# DBX Host API Audit

本文件记录 Phase 0 的源码级 Host API 审计。本文只更新 `Table Context`；`Schema Metadata` 仍保留为 Issue #3 的独立审计范围。

## Baseline

- DBX repository: `E:\AI生成代码\dbx`
- audited commit: `882bd130abf7c5d67583ab4cea6e03fb47e0b488` (`origin/main`)
- audit date: `2026-09-21`
- 审计期间未修改 DBX working tree；DBX 当前分支上的既有未跟踪文件未删除、未 reset、未覆盖。

## Table Context

### Verdict

```text
NOT_PUBLICLY_SUPPORTED
```

DBX 当前可以通过正式 Plugin API 在**已保存连接（saved connection）**的 sidebar context menu 中触发插件，但不能从某一张具体 table 的操作入口触发同一插件 contribution，也没有向插件公开完整的 `connectionId`、`database`、`schema`、`table` table-scoped payload。

### Context Menu target matrix

`context-menu v1` 的正式 contribution target 只有 saved connection sidebar menu。`connection` 是 manifest 中的 menu surface 名称，不是一个可由插件自行扩展的任意 target。

| Target | Formal contribution | Classification | Source evidence | Finding |
| --- | --- | --- | --- | --- |
| connection | `context-menu` + `menu: "connection"` | A | `plugins/manifest.schema.json` — `contextMenuContribution`; `crates/dbx-plugin-runtime/src/plugins/manifest.rs` — `PluginContextMenuContribution` / `validate_contributions`; `apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `appendPluginConnectionMenuItems` | 正式支持；实际挂载在 `node.type === "connection"`。 |
| saved connection | 同上 | A | `plugins/README.md` — `### \`context-menu\``；`apps/desktop/src/lib/sidebar/sidebarLayout.ts` — `makeConnectionNode` | 正式支持；这是 `connection` target 的实际 UI 语义。 |
| database | 无 database-specific contribution | B | `apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `buildDatabaseSidebarMenu`；`apps/desktop/src/types/database.ts` — `TreeNode` | DBX 内部有 database menu/node，但没有公开的 plugin menu target。 |
| schema | 无 schema-specific contribution | B | `apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `buildDatabaseSidebarMenu`；`apps/desktop/src/stores/connectionStore.ts` — `loadSchemas` | DBX 内部有 schema menu/node，但没有公开的 plugin menu target。 |
| table | 无 table-specific contribution | B | `apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `buildObjectSidebarMenu`；`apps/desktop/src/lib/table/tableTree.ts` — `buildTableTreeNodes` / `makeTableTreeEntry` | DBX 内部有 table menu/node，但没有公开的 plugin menu target。 |
| column | 无 column-specific contribution | B | `apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `buildObjectSidebarMenu` 的 `node.type === "column"` 分支；`apps/desktop/src/types/database.ts` — `TreeNodeType` | DBX 内部有 column menu/node，但没有公开的 plugin menu target。 |

本轮未将 database/schema/table/column 判为 C：源码中已有 `TreeNode` 与 native menu 分支；当前证据显示缺口是 Plugin API 未暴露，而不是 DBX 内部完全没有对象或菜单抽象。

### Table Context matrix

以下分类按**插件可获得的正式 table context**判断。`A` 行中的 `database` 仅表示当前 connection-menu payload 有这个公开字段，不代表它已经是被点击 table 的 database；因此不能据此将完整 Table Context 判为通过。

| Capability | Classification | Public Plugin API | DBX Internal | Evidence |
| --- | --- | --- | --- | --- |
| `connectionId` | A | 当前 connection menu 的 payload 为 `connection.id`；语义上是 DBX saved connection identity。 | connection node 由 `config.id` 同时写入 `id` 和 `connectionId`。 | `apps/desktop/src/lib/sidebar/sidebarLayout.ts` — `makeConnectionNode`；`apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `appendPluginConnectionMenuItems` 发送 `id: config.id`。公开字段嵌套在 `connection` 下，不是顶层 `connectionId`。 |
| `database` | A | 当前公开 payload 为 `connection.database`，缺省值被 host 归一化为空字符串；这是 connection context 的字段，不是被点击 table 的 database。 | 被点击 database/table 的 `TreeNode.database` 是另一份 table-scoped 内部值。`buildDatabaseTreeNodes`、`loadSchemas` 和 `buildTableTreeNodes` 会沿树节点传递它。 | `plugins/README.md` — payload `{ id, dbType, name, database }`；`apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `database: config.database`（缺省回退为空字符串）；`apps/desktop/src/types/database.ts` — `TreeNode.database?: string`。 |
| `schema` | B | 当前 context-menu payload 没有 `schema` 字段，也没有 table-specific public context type。 | `TreeNode.schema?`、`ObjectBrowserRow.schema?` 和 table tree 的 `schema?: string` 在 DBX 内部存在。 | `apps/desktop/src/types/database.ts` — `TreeNode`；`apps/desktop/src/lib/table/objectBrowserRows.ts` — `ObjectBrowserRow`；`apps/desktop/src/lib/table/tableTree.ts` — `buildTableTreeNodes`。 |
| `table` | B | 当前 context-menu payload 没有 `table` / `tableName` 字段，也没有 table-specific public context type。 | table node 的稳定对象名在 `makeTableTreeEntry` 中作为 `label`/node id 构造；`TreeNode.tableName?` 与 `ObjectBrowserRow.name` 也只属于 DBX 内部 UI 模型。 | `apps/desktop/src/lib/table/tableTree.ts` — `makeTableTreeEntry`；`apps/desktop/src/types/database.ts` — `TreeNode`；`apps/desktop/src/components/objects/ObjectBrowser.vue` — `getObjectBrowserMenuItems`。 |
| table context menu | B | `PluginContextMenuContribution` 的正式 schema 只接受 `menu: "connection"`；插件不能声明 database/schema/table/column target。 | DBX native sidebar menu 分别处理 database/schema、table/view 和 column；central `ObjectBrowser` 也有本地 `CustomContextMenu`，但都没有接入 plugin registry。 | `plugins/manifest.schema.json` — `contextMenuContribution.menu`；`crates/dbx-plugin-runtime/src/plugins/manifest.rs` — `validate_contributions`；`apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue` — `buildDatabaseSidebarMenu` / `buildObjectSidebarMenu` / `appendPluginConnectionMenuItems`；`apps/desktop/src/components/objects/ObjectBrowser.vue` — `getObjectBrowserMenuItems`。 |

#### Payload semantics

- `connectionId`：`makeConnectionNode` 将 `config.id` 同时作为 sidebar node `id` 和 `connectionId`；插件 payload 再从 `connectionStore.getConfig(node.connectionId)` 取回 `config.id`。这是 DBX connection identity，不是临时 UI node id；但 wire shape 是 `connection.id`。
- `database`：公开字段来自保存连接的 `config.database`，不是右键点击 node 的 `node.database`。同一表达式对 PostgreSQL、MySQL、SQLite 都适用，但语义并不因此变成统一的 table scope：MySQL 的 tree 可以有多个 database node，SQLite 的持久化 connection database 会由 `normalizeStoredConnectionDatabase` 归一为 `undefined`，最终 payload 变成 `""`。
- `schema`：内部 `TreeNode.schema` 和 table/object browser row schema 都是 optional；当前公开 payload 完全没有该字段，因此 SQLite / MySQL 是否为 `undefined`、空字符串或某个内部默认值没有 public contract 可供插件依赖。
- `table`：内部 table name 可从 tree node 的 `label`/node id 或 `ObjectBrowserRow.name` 得到，但这些值没有跨插件边界发送；不能把 display label、private store 或 UI route 当作 public table name。

### Invocation path

#### Sidebar tree（唯一接入 plugin context-menu 的 UI path）

```text
TreeItem.onTreeItemContextMenu
→ ConnectionTree.openSidebarContextMenu
→ sidebarTreeRuntime.buildContextMenu
→ SidebarTreeRuntimeHost.buildContextMenu
→ treeItemMenuItems
→ buildConnectionSidebarMenu（仅 node.type === "connection"）
→ appendPluginConnectionMenuItems
→ FrontendPluginRegistry.listContextMenuItems("connection")
→ api.invokePlugin(pluginId, `contextMenu/${contribution.id}`, {
    connection: { id, dbType, name, database }
  })
→ POST /api/plugins/invoke（或 Tauri invoke_plugin）
→ dbx-web routes::invoke_plugin
→ plugin_host.invoke
→ plugin sidecar backend
```

对 database/schema，`buildDatabaseSidebarMenu` 在内部 menu 分支直接 `return true`；对 table/view，`buildObjectSidebarMenu` 直接 `return true`；对 column 也有独立 `return true` 分支。它们都不会调用 `appendPluginConnectionMenuItems`。

#### Central Object Browser

```text
ContentArea
→ ObjectBrowser（接收 connection / database / schema）
→ CustomContextMenu
→ getObjectBrowserMenuItems
→ getTableMenuItems / getViewMenuItems / ...
→ native DBX action
```

`ObjectBrowser.vue` 的 table row context menu 没有 `FrontendPluginRegistry`、`listContextMenuItems` 或 `invokePlugin` 调用。此处链路明确停止：

```text
STOP: central Object Browser 的 table menu 不是 plugin contribution surface。
```

### Rejected workarounds

以下路径即使技术上可能，也不属于本审计的 PASS：

- 读取 `connectionStore`、private store 或 DBX 内部 `selectedTable` 状态。
- `import` 未公开 frontend module 或依赖 DBX 私有组件 props。
- 解析 DOM、UI route、浏览器内部状态或 clipboard 反推 table。
- 读取 credential 文件、连接配置私有存储或生产连接串。
- 让 SchemaSeed 自己维护第二套数据库连接以补齐 table context。

### Recommended upstream gap

为 DBX Host API 增加一个正式、版本化的 **table-scoped context-menu contribution target**：从 sidebar/Object Browser 的具体 table 操作入口触发插件，并公开稳定的 DBX connection identity 与 `database`、可选 `schema`、稳定 `table` name；同时明确 PostgreSQL / MySQL / SQLite 中缺省 database/schema 的 optional/null/empty 语义。不要暴露 credential，也不要求插件读取 DBX private state 或重新维护连接。

## Schema Metadata

### Verdict scope

本节同时回答两个问题：

- **Question A — DBX 自己是否有 metadata：YES，但跨 driver 的字段完整度是 PARTIAL。** DBX 已有统一的 `ColumnInfo`、`IndexInfo`、`ForeignKeyInfo`、`ConstraintInfo`，并由 schema core、Tauri command、HTTP route 和 Object Browser 消费。
- **Question B — 第三方插件是否能通过正式 Host API 获取：NO。** 当前没有 `host.metadata.*`、`getTableMetadata` 或等价的公开 Plugin Host API、permission、SDK 类型和 bridge dispatch。SchemaSeed 不能把 DBX 内部接口当作插件能力。

本矩阵中的 `PASS` 表示 DBX 内部针对该 driver 有源码路径；`PARTIAL` 表示字段存在但 driver、返回形状或语义不完整；`MISSING` 表示本轮没有统一的结构化内部返回。`B` / `C` 是下方 Classification 的分类。

| Capability | Public Host API | DBX Internal | PostgreSQL | MySQL | SQLite | v0.1 Blocking |
|---|---|---|---|---|---|---|
| `columns` | `NOT_PUBLICLY_SUPPORTED` — 无 metadata Host method | `B` — `ColumnInfo` + `get_columns_core_for_session` | `PASS` | `PASS` | `PASS` | **YES** |
| data type | `NOT_PUBLICLY_SUPPORTED` | `B` — `ColumnInfo.data_type` | `PASS` — `format_type(...)` | `PASS` — `COLUMN_TYPE` | `PASS` — `PRAGMA table_info.type` | **YES** |
| `nullable` | `NOT_PUBLICLY_SUPPORTED` | `B` — `ColumnInfo.is_nullable` | `PASS` | `PASS` | `PASS` | **YES** |
| `length` | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `character_maximum_length` 存在，但不由所有 driver 填充 | `PASS` — `varchar` / `bpchar` typmod | `PASS` — `CHARACTER_MAXIMUM_LENGTH` | `MISSING` — structured field 为 `None`；声明类型字符串可能仍含 typmod | **YES** |
| `precision` | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `numeric_precision` 存在，但不由所有 driver 填充 | `PASS` — numeric typmod | `PASS` — `NUMERIC_PRECISION` | `MISSING` | **YES** |
| `scale` | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `numeric_scale` 存在，但不由所有 driver 填充 | `PASS` — numeric typmod | `PASS` — `NUMERIC_SCALE` | `MISSING` | **YES** |
| `default` | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `column_default` 为原始/渲染文本，generated 细节落在 `extra`；没有 `default_kind` | `PASS` — 可返回 expression 文本 | `PASS` — `COLUMN_DEFAULT` | `PASS` — `dflt_value` | **YES** |
| `comment` | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `ColumnInfo.comment` 存在，但不由所有 driver 填充 | `PASS` — `col_description` | `PASS` — `COLUMN_COMMENT` | `MISSING` | NO |
| primary key | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `is_primary_key` + `IndexInfo` / PG `ConstraintInfo`；复合键形状不统一 | `PASS` | `PASS` | `PASS` | NO |
| foreign key | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `ForeignKeyInfo` 存在；通用记录按列返回，复合关系不总是分组 | `PASS` — `ConstraintInfo` 可保留复合列 | `PASS` — `ForeignKeyInfo` 按列 | `PARTIAL` — `PRAGMA foreign_key_list` 按列，缺少通用复合聚合 | NO |
| unique | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — `IndexInfo.is_unique` 统一存在，column-level `is_unique` 并不由所有路径填充 | `PASS` — indexes / constraints | `PASS` — indexes / `COLUMN_KEY` | `PASS` — `index_list` | NO |
| check | `NOT_PUBLICLY_SUPPORTED` | `C/PARTIAL` — `ConstraintInfo` 模型存在，但 core 当前只对部分 driver 调用结构化实现 | `PASS` — `list_constraints` 含 `CHECK` expression | `MISSING` — core 没有 MySQL structured constraints path | `MISSING` — core 没有 SQLite structured constraints path | NO |
| identity / auto increment | `NOT_PUBLICLY_SUPPORTED` | `B/PARTIAL` — PG/MySQL/SQLite 都借助自由文本 `extra`，没有 typed identity strategy | `PASS` — identity / serial / generated 写入 `extra` | `PASS` — `auto_increment` / generated 写入 `extra` | `PARTIAL` — 识别 rowid/autoincrement PK；remote path 和复杂声明不提供等价 typed 字段 | NO |

### Column semantics

- 共享 `ColumnInfo` 有 native/general 语义中的 `data_type`，没有独立的 logical/general type 字段；本轮不把前端展示推断当作 metadata contract。
- PostgreSQL 的 `POSTGRES_COLUMNS_SQL` 使用 `format_type` 并从 catalog typmod 计算 precision、scale、character length；MySQL 的 `columns_sql` 保留 `COLUMN_TYPE`，同时读取 information schema 的数值字段；SQLite 的 `get_columns` 只把 `PRAGMA table_info` 的 `type`、`notnull`、`dflt_value`、`pk` 写入模型。
- `VARCHAR(100)` / `DECIMAL(18,2)` 的保留情况因此不是统一的 wire contract：PG/MySQL 有结构化 length/precision/scale，SQLite 只保留声明类型文本，结构化数值为空。
- `default` 当前是文本值/表达式值。PG 普通 default 由 `pg_get_expr` 返回，generated/identity 信息进入 `extra`；MySQL 使用 `COLUMN_DEFAULT` 与 `EXTRA`；SQLite 使用 `dflt_value`。没有统一字段区分 literal、expression 和 database-generated default。

## Classification

本轮使用以下分类；分类描述 DBX 当前事实，不冻结 Issue #4 的 Host Contract：

| Capability | Classification | 具体事实 |
|---|---|---|
| `columns` | **B** | DBX 内部有 `ColumnInfo` 和统一 schema route，但没有插件 Host exposure。 |
| data type | **B** | `ColumnInfo.data_type` 由三类目标 driver 填充；没有公开插件 method。 |
| `nullable` | **B** | `ColumnInfo.is_nullable` 已存在并由目标 driver 填充；没有公开插件 method。 |
| `length` | **B / PARTIAL** | 共享字段存在，PG/MySQL 填充，SQLite 为空。 |
| `precision` | **B / PARTIAL** | 共享字段存在，PG/MySQL 填充，SQLite 为空。 |
| `scale` | **B / PARTIAL** | 共享字段存在，PG/MySQL 填充，SQLite 为空。 |
| `default` | **B / PARTIAL** | 共享文本字段存在，但 default kind 没有统一表达。 |
| `comment` | **B / PARTIAL** | 共享字段存在，PG/MySQL 有 column comment，SQLite 没有。 |
| primary key | **B / PARTIAL** | column flag、indexes、PG constraints 都存在，但复合键的公共形状不统一。 |
| foreign key | **B / PARTIAL** | 三个目标 driver 都有内部读取路径；通用 FK 记录按列返回，复合聚合能力不一致。 |
| unique | **B / PARTIAL** | `IndexInfo.is_unique` 可用；column-level flag 和 constraint route 不一致。 |
| check | **C / PARTIAL** | `ConstraintInfo` 能表达 CHECK，但当前 core 只对部分 driver 提供结构化结果，MySQL/SQLite 返回空。 |
| identity / auto increment | **B / PARTIAL** | PG/MySQL/SQLite 把信息压进 `extra`，没有跨 driver 的 typed identity abstraction。 |

当前没有任何能力达到 **A. Public Plugin Host API 已正式支持**。B / C 都是 SchemaSeed 的 Host API gap；内部路径存在不改变该结论。

## Constraint semantics

- `IndexInfo` 能表达名称、列列表、unique、primary，以及部分 index 细节；PG、MySQL、SQLite 都有 `list_indexes` driver path，因此 PK/UNIQUE 的内部读取能力强于统一 constraints route。
- `ForeignKeyInfo` 的共享形状是单个 `column` / `ref_column`。PG 的 `ConstraintInfo` 另有 `columns` / `ref_columns` 数组，可表达 composite FK；MySQL 和 SQLite 的 `list_foreign_keys` 返回按列记录，不能据此宣称已有统一 composite FK payload。
- `ConstraintInfo` 的 `definition` 可承载 CHECK expression，但 `list_constraints_core` 的 built-in driver dispatch 对 PostgreSQL（以及部分其他非本轮目标 driver）提供结构化路径，MySQL / SQLite 落到空结果。DDL 文本存在不等于 CHECK metadata 已形成统一能力。

## Public Host API evidence

以下均来自 audited DBX commit：

1. `plugins/manifest.schema.json` 的 `permissions` 固定 enum 只有 `host.events`、`host.binary`、`host.workbench`、`host.filesystem`、`host.plans:read`、`host.storage`，另有 `host.network:https://...` pattern；没有 metadata permission。
2. `crates/dbx-plugin-runtime/src/plugins/manifest.rs` 的 `SUPPORTED_PLUGIN_HOST_FEATURES` 只声明 `host.requestUserInput`，`SUPPORTED_PLUGIN_PERMISSIONS` 没有 metadata namespace。
3. `plugins/README.md` 的 `Frontend Host API` 与 `Host API methods a plugin may call` 列出 context、backend、filesystem、file、storage、plan、user-input 等 API；没有 table/schema metadata API。`context-menu` 只发送非 secret connection summary，`result-view` 只发送 bounded query-result snapshot，也不是 table metadata。
4. `apps/desktop/src/lib/plugins/pluginHostBridge.ts` 的 `PluginHostBridgeApi` 与 `PluginHostBridge.dispatch` 实现了 context、plugin sidecar `backend.invoke`、workbench/filesystem、plan、file、storage 等分支，没有 `getColumns`、`getTableMetadata`、`listConstraints` 或同等 DBX-driver bridge。`backend.invoke` 是发给插件自己 sidecar 的调用，不能证明 DBX metadata 已暴露。
5. `crates/dbx-plugin-runtime/src/plugins/runtime.rs` 的 `handle_plugin_request` 对 plugin-initiated Host API 只匹配 `host/requestUserInput`，其他 method 返回 method-not-found。

因此：

```text
STOP: no public plugin exposure
```

DBX 的 Tauri commands、`/api/schema/*` HTTP routes 和前端 Object Browser 是 DBX 自己的内部 app boundary，不是第三方插件可依赖的正式 Host API。

## Metadata Path

源码事实链如下：

```text
PostgreSQL / MySQL / SQLite driver
        ↓
crates/dbx-core/src/schema/mod.rs
  get_columns_core_for_session_inner
  list_indexes_core_for_session
  list_foreign_keys_core_for_session
  list_constraints_core
        ↓
crates/dbx-types/src/types.rs
  ColumnInfo / IndexInfo / ForeignKeyInfo / ConstraintInfo
        ↓
Tauri commands / HTTP routes
  src-tauri/src/commands/schema.rs
  crates/dbx-web/src/routes/schema.rs
        ↓
Desktop backend API / Object Browser / table detail
        ↓
Plugin Host API ?
        ↓
STOP: no public plugin exposure
```

目标 driver 的实际入口：

- PostgreSQL：`crates/dbx-drivers/src/db/postgres.rs` 的 `get_columns`、`list_indexes`、`list_foreign_keys`、`list_constraints`。
- MySQL：`crates/dbx-drivers/src/db/mysql.rs` 的 `get_columns`、`list_indexes`、`list_foreign_keys`；CHECK 没有对应的 built-in structured route。
- SQLite：`crates/dbx-drivers/src/db/sqlite.rs` 的 `get_columns`、`list_indexes`、`list_foreign_keys`；CHECK 没有对应的 built-in structured route。

## v0.1 Blocking Matrix

这里的 `BLOCKED` 只表示 **SchemaSeed 通过正式 Plugin Host API 消费 metadata 的路径** 被阻断，不是整个 Phase 0 Gate 的最终结论。

| v0.1 capability | DBX internal PostgreSQL | DBX internal MySQL | DBX internal SQLite | Public plugin result | Metadata gate |
|---|---|---|---|---|---|
| `columns` | PASS | PASS | PASS | `NOT_PUBLICLY_SUPPORTED` | BLOCKED |
| type | PASS | PASS | PASS | `NOT_PUBLICLY_SUPPORTED` | BLOCKED |
| `nullable` | PASS | PASS | PASS | `NOT_PUBLICLY_SUPPORTED` | BLOCKED |
| `length` | PASS | PASS | MISSING structured value | `NOT_PUBLICLY_SUPPORTED` | BLOCKED |
| `precision` | PASS | PASS | MISSING | `NOT_PUBLICLY_SUPPORTED` | BLOCKED |
| `scale` | PASS | PASS | MISSING | `NOT_PUBLICLY_SUPPORTED` | BLOCKED |
| `default` | PASS, expression text | PASS, raw default text | PASS, `dflt_value` text | `NOT_PUBLICLY_SUPPORTED` | BLOCKED |

因此，Metadata 子审计的 verdict 是 `NOT_PUBLICLY_SUPPORTED`；是否将该 gap 与 Table Context Audit 一起汇合为 upstream work item，留待 Issue #4 及两轮审计汇合后决定。

## Future Capability Matrix

未来能力不是 v0.1 blocking；版本归类沿用本轮要求：

| Capability | Current internal state | Target follow-up | Current public status |
|---|---|---|---|
| `comment` | PG/MySQL 有，SQLite 缺失 | v0.2 | `NOT_PUBLICLY_SUPPORTED` |
| PK | 三个目标 driver 有 column/index 路径，统一 composite shape 不足 | v0.3 | `NOT_PUBLICLY_SUPPORTED` |
| FK | 三个目标 driver 有内部路径；composite grouping 不统一 | v0.4 | `NOT_PUBLICLY_SUPPORTED` |
| UNIQUE | 三个目标 driver 可由 `IndexInfo` 读取 | v0.3 | `NOT_PUBLICLY_SUPPORTED` |
| CHECK | PostgreSQL structured path；MySQL/SQLite 当前缺失 | v0.3 | `NOT_PUBLICLY_SUPPORTED` |
| identity / auto increment | PG/MySQL/SQLite 主要落在 `extra`，无 typed strategy | v0.3 | `NOT_PUBLICLY_SUPPORTED` |

## Source Evidence

| Path | Symbol / section | Finding |
|---|---|---|
| `crates/dbx-types/src/types.rs` | `ColumnInfo`、`IndexInfo`、`ForeignKeyInfo`、`ConstraintInfo` | DBX 的共享内部 metadata payload；包含 name/type/nullable/default/PK/unique/comment/precision/scale/length，以及 index/FK/CHECK 字段。 |
| `crates/dbx-core/src/schema/mod.rs` | `get_columns_core_for_session_inner`、`list_indexes_core_for_session`、`list_foreign_keys_core_for_session`、`list_constraints_core` | 统一 schema core 按 pool/agent dispatch 到 driver；`list_constraints_core` 的默认分支不是 MySQL/SQLite structured constraints。 |
| `crates/dbx-drivers/src/db/postgres.rs` | `POSTGRES_COLUMNS_SQL`、`get_columns`、`list_indexes`、`list_foreign_keys`、`list_constraints` | 使用 `pg_catalog` / `information_schema`；保留 typmod、default expression、comments、identity/serial/generated、PK、FK、UNIQUE、CHECK。 |
| `crates/dbx-drivers/src/db/mysql.rs` | `columns_sql`、`get_columns`、`list_indexes`、`list_foreign_keys` | 使用 `information_schema.COLUMNS`、indexes 和 FK metadata；保留 `COLUMN_TYPE`、length/precision/scale、comment、default、`auto_increment` / generated `EXTRA`。 |
| `crates/dbx-drivers/src/db/sqlite.rs` | `get_columns`、`list_indexes`、`list_foreign_keys`、`sqlite_autoincrement_pk_columns` | 使用 `PRAGMA table_info/index_list/index_info/foreign_key_list`；能读基本列/PK/UNIQUE/FK，structured length/precision/scale/comment/CHECK 不形成统一结果。 |
| `src-tauri/src/commands/schema.rs` | `get_columns`、`list_indexes`、`list_foreign_keys`、`list_constraints` | DBX 内部 Tauri command 可以访问 schema core；不是 Plugin Host API。 |
| `crates/dbx-web/src/routes/schema.rs` | `list_columns`、`list_indexes`、`list_foreign_keys`、`list_constraints` | DBX 内部 HTTP route 可以返回这些 payload；不是 Plugin Host API。 |
| `plugins/manifest.schema.json` | `permissions` | 正式插件 manifest permission enum 没有 metadata capability。 |
| `crates/dbx-plugin-runtime/src/plugins/manifest.rs` | `SUPPORTED_PLUGIN_HOST_FEATURES`、`SUPPORTED_PLUGIN_PERMISSIONS` | Host feature/permission 白名单没有 metadata。 |
| `apps/desktop/src/lib/plugins/pluginHostBridge.ts` | `PluginHostBridgeApi`、`PluginHostBridge.dispatch` | bridge 没有 metadata method；`backend.invoke` 只到插件 sidecar。 |
| `crates/dbx-plugin-runtime/src/plugins/runtime.rs` | `handle_plugin_request` | plugin-initiated Host API 只实现 `host/requestUserInput`。 |
| `plugins/README.md` | `Frontend Host API`、`Host API methods a plugin may call` | 正式文档没有 table metadata method；result/context payload 不能替代 normalized table metadata。 |

## Rejected Workarounds

以下路径可作为 DBX 内部实现事实记录，但不能作为 SchemaSeed Phase 0 正式解决方案：

- SchemaSeed 自己执行 `information_schema`、`pg_catalog`、`PRAGMA table_info/index_list/foreign_key_list`、`SHOW CREATE TABLE` 或其他 driver-specific introspection。
- 通过插件 sidecar 的 `backend.invoke` 自建 PG/MySQL/SQLite metadata client 或第二条 database connection。
- 直接依赖 DBX 私有 Tauri command、`/api/schema/*` HTTP route、private store 或未公开 frontend module/import。
- 获取 credential、复制 connection string、绕过 DBX 现有 connection/driver/metadata pool。
- 把 DDL viewer 的文本解析、Object Browser 的 Vue state 或内部 cache 当作稳定 Plugin Host contract。

这些 workaround 都绕过了本轮要求的边界：复用 DBX 已有 connection、driver 和 metadata abstraction，并通过正式 Host API 暴露给第三方插件。

## Recommended Upstream Gaps

### v0.1 blocking

- DBX 需要提供一个正式、公开、可版本化的 metadata Host boundary，使插件能引用 DBX 已持有的 connection/context，而不是取得 credential 或建立第二条连接。
- 该 boundary 至少要覆盖本轮七项 v0.1 字段，并明确 PG/MySQL/SQLite 的 missing/partial 语义、大小写/空值、default expression 和 driver error 行为。
- 需要同时补齐 Host API 文档、manifest permission/capability、desktop bridge、native runtime 和 SDK type；当前任何一个环节都不存在 metadata exposure。

### Future follow-up

- v0.2：column/table comment。
- v0.3：PK、UNIQUE、CHECK、identity/auto-increment 的跨 driver 语义。
- v0.4：FK 的 source/target table、composite columns、referential actions 和统一分组。
- 以上只描述 gap，不在本轮创建 DBX Issue，不在本轮确定 `host.metadata.getTable()` 或任何最终 wire shape。

## Audit constraints

- 只审计公开 Plugin Host API 与 DBX 源码证据。
- 不读取 DBX 私有 Store。
- 不读取 DBX Credential 文件。
- 不调用未公开前端模块。
- 不为了拿 Metadata 建立第二套数据库连接体系。
- 未对 `Schema Acquisition Path` 做最终设计结论；当前只确认其在 Plugin Host API 处停止。
