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

| Capability | Public Host API | DBX Internal | PostgreSQL | MySQL | SQLite | v0.1 Required |
|---|---|---|---|---|---|---|
| `columns` | TBD | TBD | TBD | TBD | TBD | YES |
| data type | TBD | TBD | TBD | TBD | TBD | YES |
| `nullable` | TBD | TBD | TBD | TBD | TBD | YES |
| `length` | TBD | TBD | TBD | TBD | TBD | YES |
| `precision` | TBD | TBD | TBD | TBD | TBD | YES |
| `scale` | TBD | TBD | TBD | TBD | TBD | YES |
| `default` | TBD | TBD | TBD | TBD | TBD | YES |
| `comment` | TBD | TBD | TBD | TBD | TBD | NO |
| primary key | TBD | TBD | TBD | TBD | TBD | NO |
| foreign key | TBD | TBD | TBD | TBD | TBD | NO |
| unique | TBD | TBD | TBD | TBD | TBD | NO |
| check | TBD | TBD | TBD | TBD | TBD | NO |
| identity / auto increment | TBD | TBD | TBD | TBD | TBD | NO |

## Classification

每项最终只能分类为：

- **A. Public API 已正式支持**
- **B. DBX 内部已有，但 Plugin Host API 未暴露**
- **C. DBX 当前没有合适抽象**

B / C 均视为 Host API Gap。

内部实现能够读取某项数据，不等于插件已经获得正式支持；审计必须提供 DBX 仓库、commit、文件路径、符号或 API 文档等可复核证据。

## Audit constraints

- 只审计公开 Plugin Host API 与 DBX 源码证据。
- 不读取 DBX 私有 Store。
- 不读取 DBX Credential 文件。
- 不调用未公开前端模块。
- 不为了拿 Metadata 建立第二套数据库连接体系。
- 本文件完成前不对 `Schema Acquisition Path` 做结论。
