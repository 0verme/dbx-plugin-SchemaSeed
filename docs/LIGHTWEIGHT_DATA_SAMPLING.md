# 轻量只读样本探测

## 范围与顺序

SchemaSeed 先通过 Host API 1.3 `getTableMetadata` 读取 schema，再运行已有 semantic inference。仅在存在语义不确定、类型适合的候选列时，才通过 Host API 1.4 Data API 做一次小样本探测。没有候选列、Data API 不可用或调用失败时，Workbench 继续使用 metadata-only 路径。

```text
schema metadata → existing inference → uncertain eligible columns → sample evidence → refreshed plan
```

Sample evidence 不能替代或覆盖 schema facts：data type、varchar length、numeric precision/scale、nullable、default 和 timestamp precision 均以 metadata 为准。当前 provider 已消费 Host schema API 的 `precision`；`timestamp_precision_unknown` 仍表示 precision metadata 缺失，不可从行值推断。

## Host API 边界

- Manifest 声明 `host.data:read`，最低 `engines.host_api` 为 `^1.4`。
- Workbench 在 `window.dbxPlugin.ready` 后读取 `capabilities.dataApi`，并只调用 `window.dbxPlugin.queryData(...)`。
- 请求使用当前 TableContext 的 `connectionId` 与可选 `database` / `schema`；不获取凭据、连接串、driver、pool，不创建第二连接或自行 reconnect。
- 首次按插件/连接的 consent 由 DBX Host 显示和管理。拒绝、能力缺失、timeout 或 query error 都退回 metadata-only；SchemaSeed 不增加第二个授权 UI。

## 候选字段与查询上限

当前只考虑已知、bounded、最大 1024 字符的 varchar 列：

- 现有 name/email/mobile inference 为非高置信度候选时，可用相应 pattern evidence 辅助确认；例如 `display_name`。
- `status`、`role`、`type`、`category` 等字符串列可以被探测低基数 enum-like 特征。
- 不采样 text/unbounded、binary/BLOB、未知或不支持类型、超过长度上限的字段；metadata 已足够的字段不采样。

Probe 构造 `SELECT` 时只包含候选字段，并同时设置 SQL `LIMIT 8` 与 Host `maxRows: 8`；Host 请求 `timeoutMs` 最多为 3000 ms，Workbench deadline 最多为 3500 ms。没有 COUNT / DISTINCT 聚合、全表 histogram、percentile 或分布 profiling。

为兼容没有 Host 方言信息的运行环境，标识符只接受小写、非限定、非保留的 ASCII 标识符；表名不安全时整次 probe 退出，字段名不安全时仅排除该字段。database/schema 通过 Host request scope 传入，不拼接进 SQL。SQL 使用 PostgreSQL、MySQL、SQLite 共同支持的 `LIMIT` 语法；其他 dialect 的请求失败时安全 fallback，不尝试自建方言连接或重试。

## 证据与生成

原始 rows 只在 UI-side analyzer 的本次调用内存中短暂使用。当前 pattern 支持中文姓名、邮箱、手机号和低基数字符串类别；样本不足、全 NULL、混乱或不一致时不给出证据。

传入 Generation Core 的只包含字段名、pattern kind 和有界计数（例如匹配数、样本数、不同类别数）。姓名/邮箱/手机号确认后仍调用 SchemaSeed 的 Safe Synthetic generator；enum-like 只显示规则建议，不复制生产枚举值，也不把样本值作为用户配置或 preview 内容。

Session cache 按 connection/database/schema/table 保存一次探测 promise 及已脱敏证据；失败和空结果同样缓存，避免重试。改变行数、随机种子、规则或展开面板不会再 query；cache 仅在 Workbench 内存生命周期存在，不持久化原始值或证据。

## 隐私和诊断

原始 sample values 不进入日志、diagnostics、export、telemetry、analytics、localStorage、persistent plugin storage、fixtures/snapshots、AI/LLM 或外部 HTTP。Probe errors 不展示为 fatal modal，也不影响生成。Core RPC 会拒绝携带原始 values 的 sampleEvidence payload。

Sampling 只可能移除由足够强的 semantic ambiguity 产生的确认 warning。Schema metadata 问题（如 timestamp precision 缺失）、混乱样本或真实业务歧义仍按原有规则提示用户。

## 验证

针对性测试覆盖无候选 0 次 query、capability/consent/error/timeout fallback、姓名/email/mobile/enum-like pattern、all-NULL 与混乱样本、schema precision 不被覆盖、候选列限制、行数/timeout 上限、session cache、隐私边界和 synthetic output 不包含样本值。真实 DBX Desktop runtime smoke 需在提供 Host API 1.4 `dataApi` 的 DBX 环境中另行执行；当前实现本身不绕过 Host API。
