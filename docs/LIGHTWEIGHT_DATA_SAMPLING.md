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

候选范围按类型和隐私风险筛选，而非按固定业务列名：

- 已知、bounded 且最大 1024 字符的 varchar 可用于 name/email/mobile pattern、低基数类别或文件名后缀分析；native unbounded `text` 只允许对合格候选作数据库端 `SUBSTR(..., 1, 1024)`，不把未知长度的 varchar 当作无界。
- 普通非敏感 integer/decimal 可用于数值范围和零值频次；拒绝 ID/UUID/业务标识符、已知 identity 和按样本顺序单调递增/递减的全唯一数值列。
- 文件名/路径列只分析后缀；敏感、自由文本、binary/BLOB、未知或不支持类型、超出长度上限的字段不进入相应 profile。已有高置信度 semantic mapping 不采样。
- 不依赖 `category`、`dws`、`err`、`audit_results` 等具体字段名或样本业务值；相同规则应用于通过 guard 的字段。

Probe 构造 `SELECT` 时只包含候选字段，并同时设置 SQL `LIMIT 8` 与 Host `maxRows: 8`；Host 请求 `timeoutMs` 最多为 3000 ms，Workbench deadline 最多为 3500 ms。没有 COUNT / DISTINCT 聚合、全表 histogram、percentile 或分布 profiling。

为兼容没有 Host 方言信息的运行环境，标识符只接受小写、非限定、非保留的 ASCII 标识符；表名不安全时整次 probe 退出，字段名不安全时仅排除该字段。database/schema 通过 Host request scope 传入，不拼接进 SQL。SQL 使用 PostgreSQL、MySQL、SQLite 共同支持的 `LIMIT` 语法；其他 dialect 的请求失败时安全 fallback，不尝试自建方言连接或重试。

## 证据与生成

原始 rows 只在 UI-side analyzer 的本次调用内存中短暂使用。Probe 生成的 profile 包括：姓名/邮箱/手机号的 pattern 计数；类别的 sample/distinct 计数及可选安全 label/frequency；numeric min/max/zeroCount；filename suffix/frequency。样本不足、全 NULL、全唯一类别、混乱或不一致时不给出可应用 profile。

传入 Generation Core 的只包含字段名和有界 profile：类别 label 只有在列和值都通过 guard（短 lowercase ASCII、重复低基数、非敏感/非标识符）时保留，除此之外不携带类别原值；numeric decimal bounds 保留 exact decimal string；filename 仅保留扩展名。姓名/邮箱/手机号的 pattern evidence 只携带匹配计数，实际输出继续使用 SchemaSeed Safe Synthetic generator。允许通过类别 guard 的短 label 在合成结果中按观察频率重复出现，这是为保持类别分布而设的明确例外；其余原始行、自由文本、敏感值和文件名 stem 不会进入生成结果。Numeric profile 限定生成范围并按 observed zero frequency 做 seed-addressed 抽样，filename profile 使用新的 synthetic stem。

GenerationPlan 的 effective rule/provenance 可观察为 sample-derived strategy；显式用户 rule、已确认 semantic mapping 与 schema bounds 优先。没有样本、不兼容或安全性不足时保持原 schema/semantic fallback。Preview 与 CSV/JSON/INSERT SQL 仍共用同一已生成 dataset；profile/generator 的同 seed 输出可 replay。

Profile threshold 以最多 8 行为上限：categorical 至少 4 个非空样本、2–6 个 distinct 且至少有一个重复（distinct ratio ≤ 0.9）；数值范围至少 3 个合法样本；filename 至少 3 个有效 suffix 且覆盖率 ≥ 0.8。类别候选最多 24 字符并要求 lowercase ASCII，suffix 为 1–8 个 ASCII 字母/数字；不满足阈值不强推策略。

Session cache 按 connection/database/schema/table 保存一次探测 promise 及 value-minimized profile；失败和空结果同样缓存，避免重试。改变行数、随机种子、规则或展开面板不会再 query；cache 仅在 Workbench 内存生命周期存在，不持久化原始 rows 或脱敏 profile。

## 隐私和诊断

原始 sample rows / free text / 敏感值不进入日志、diagnostics、telemetry、analytics、localStorage、persistent plugin storage、fixtures/snapshots、AI/LLM 或外部 HTTP；唯一可出现在生成结果中的观察值是通过列和值两侧隐私 guard 的短类别 label，numeric 只保留 bounded range，filename 只保留 suffix。Probe errors 不展示为 fatal modal，也不影响生成。Core RPC 会拒绝携带未声明字段或原始行值的 sampleEvidence payload，并在 Core 再次执行 profile guard。

Sampling 只可能移除由足够强的 semantic ambiguity 产生的确认 warning。Schema metadata 问题（如 timestamp precision 缺失）、混乱样本或真实业务歧义仍按原有规则提示用户。

## 验证

针对性测试覆盖无候选 0 次 query、capability/consent/error/timeout fallback、姓名/email/mobile/enum-like pattern、all-NULL 与混乱样本、schema precision 不被覆盖、候选列限制、行数/timeout 上限、session cache、隐私边界和 synthetic output 不包含样本值。真实 DBX Desktop runtime smoke 需在提供 Host API 1.4 `dataApi` 的 DBX 环境中另行执行；当前实现本身不绕过 Host API。
