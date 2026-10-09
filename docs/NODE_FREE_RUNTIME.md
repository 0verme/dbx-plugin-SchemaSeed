# Node-free 生产运行时架构审计

## 结论

SchemaSeed 的纯 JavaScript Generation Core 不需要独立后端进程。DBX 官方支持 UI-only/frontend-only 插件；表结构读取、可选数据采样、用户授权和文件保存均由 sandbox UI 中的 `window.dbxPlugin` Host Bridge 提供，与插件 sidecar RPC 生命周期分离。因此本实现将已有生成执行入口放进 Workbench WebView，并移除生产 manifest/backend 启动器。生产 `.dbxp` 是适用于官方支持 DBX 平台的 universal 前端包；Node.js 只留在开发、测试和打包工具链。

## DBX Host 契约证据

审计的 DBX 源码快照：[t8y2/dbx `9d8a5ef`](https://github.com/t8y2/dbx/commit/9d8a5efedfa8ea3b2e041b74889283cd3534e029)。主要依据：

- [Plugin manifest schema](https://github.com/t8y2/dbx/blob/9d8a5efedfa8ea3b2e041b74889283cd3534e029/plugins/manifest.schema.json)：`entrypoints.backend` 与 `entrypoints.ui` 都是可选属性；Workbench 是独立 contribution。
- [Plugin development / Host API contract](https://github.com/t8y2/dbx/blob/9d8a5efedfa8ea3b2e041b74889283cd3534e029/plugins/README.md)：frontend-only universal 项目无需 sidecar；声明式 `context-menu.action.open-workbench` 由 Host 处理，table context 直接作为 UI Workbench context 传入；只有没有声明式 action 的 legacy context-menu 方法要求 backend。复用已打开 Workbench 时 Host 更新 context。
- 同一文档的 [Table Schema Metadata](https://github.com/t8y2/dbx/blob/9d8a5efedfa8ea3b2e041b74889283cd3534e029/plugins/README.md#table-schema-metadata) 定义 `host.schema:read`、`schemaMetadataApi` 和 `getTableMetadata()`；[Read-only data queries](https://github.com/t8y2/dbx/blob/9d8a5efedfa8ea3b2e041b74889283cd3534e029/plugins/README.md#read-only-data-queries) 定义 `host.data:read`、`dataApi`、逐插件/连接 consent、只读语句检查、开放连接要求及数据限额。上述 API 由 Host Bridge 承载，不需要插件 backend。
- [官方 CLI frontend-only 模板与包规则](https://github.com/t8y2/dbx/blob/plugin-cli-v0.1.9/plugins/sdk/cli/README.md)：frontend-only 项目无 sidecar、发布 universal package；官方 packager 生成 `.dbxp`、artifact metadata 与 `checksums.json`。

参考项目源码快照：[kute/dbx-plugin-data-generate `54a6b1a`](https://github.com/kute/dbx-plugin-data-generate/commit/54a6b1a92bd9fee1cd100d63acaea85ff76a4738)。其 Svelte UI 在前端执行数据生成，Rust sidecar 用于可选 MCP / sidecar 功能。该例支持前端纯计算的架构选择；不构成复制其 Faker/Chance 生成器或将 SchemaSeed 算法移植到 Rust 的理由。

## 六个审计问题

1. **必须有独立后端吗？** 否。SchemaSeed 的生产 table menu 使用 Host-handled `open-workbench`，不调用 legacy `contextMenu/<id>` 后端。
2. **Generation Core 可在 WebView 运行吗？** 可以。Core 仅依赖确定性数据计算；为满足浏览器运行要求，将 UUID 字节编码和语义合成数据中的摘要运算复用为既有 typed-array SHA-256，不改变 digest 输入或生成结果。完整 UI 可达模块图由打包契约校验，拒绝 Node built-in 与 Node-only global。
3. **旧 `generation/preview` 为什么调用 Host invoke？** 原工作台把 Core 放在 sidecar 中，`window.dbxPlugin.invoke()` 是请求“插件自己的 backend”的 RPC 桥，不是访问 DBX 数据库的必要步骤。`executeGenerationPreview()` 现在复用同一参数校验、GenerationPlan、`generateRows()`、diagnostics 和 `validateOnly` 语义；旧 JSON-RPC adapter 只保留为兼容性/契约测试入口。
4. **移除后端会影响 Host metadata、sample 或授权吗？** 不会。`getTableMetadata()` 和 `queryData()` 仍经 `window.dbxPlugin` 访问 DBX Host；保留 `host.schema:read`、`host.data:read` 权限与 capability gate。Host 继续持有数据库连接并执行每插件/连接授权和只读限制；拒绝、缺少 capability 或 API 失败按既有策略退回 metadata-only。插件不获得凭据，不建立数据库连接，不执行写操作。
5. **生产包能否完全移除 Node 启动依赖？** 可以。新 manifest 没有 `entrypoints.backend`，包内无 `backend/`、`bin/` 或 launcher。构建阶段仍使用 Node.js 和官方 CLI；最终 universal `.dbxp` 只含 UI 及浏览器可达模块。
6. **哪些测试/接口需要同步？** 移除 sidecar/plugin initialization、旧 table-context 暂存 RPC 及其 launcher/probe UI；将 runtime 参数/结果校验抽为本地共享执行入口，保留 JSON-RPC contract adapter 测试；更新 manifest、官方打包、artifact/checksum、可达 UI 模块图、preview/export 一致性、Host API fallback 与初始化错误态测试。

## 生命周期与未验证事项

Workbench 先等待 `host.ready`，再创建 UI controller 并读取 Host context。表右键入口通过声明式 action 直接交付 table context；context 切换继续由 `onContext` 触发，原 revision guard 会丢弃过期请求。插件中心无表 context 时 controller 返回可见 `table_context_invalid` diagnostic。WorkBench 关闭后再打开或 DBX 重启后重新打开时，由 DBX 重建 UI/Host bridge；本地状态不要求恢复 sidecar session。

DBX manifest / Host API 契约可以证明上述路径受支持，但不能代替真机运行验收。本工作环境没有 macOS/Windows DBX Desktop，新的 universal `.dbxp` 仍需分别在目标系统安装验收；PR 在 macOS 验收前保持 Draft 并标记 `MAC_RUNTIME_PENDING`。

## 复现证据等级

用户报告的 macOS 无系统 `node`、shell 的 `command not found`、生成失败诊断及 Host 原始 `Plugin session stopped` 消息是已报告的运行环境事实。它们与原 Unix launcher 的 `exec node ...` 相符，构成高度可信的启动依赖推断；未取得该次 Host stderr/进程退出日志，故没有把完整的进程级因果链写成已确认事实，也不据此指称 DBX macOS Host Bug。
