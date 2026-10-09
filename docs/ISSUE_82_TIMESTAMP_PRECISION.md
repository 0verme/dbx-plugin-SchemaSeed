# Issue #82 — 时间字段精度元数据缺失修复

状态：**IMPLEMENTED / WINDOWS_RUNTIME_CONFIRMED (user-confirmed) / MAC_RUNTIME_PENDING**。本记录区分自动化证据与真实 DBX Runtime 证据；没有取得 `bilibili.coupon_claims.checked_at` 的真实 Host 原始响应，不将其认定为唯一根因。

## 已证实的代码缺口

- Production `DbxHostSchemaMetadataProvider` 将 DBX Host API 1.3 的 `precision` 映射为保留 provenance 的 SchemaFact；`0` 可作为合法结构化值。
- `schema-interpreter.mjs` 原先没有从受支持的时间类型字符串中提取显式 fractional precision。
- GenerationPlan 在没有已知结构化 precision 时，可使用样本格式或 3 位小数生成，并产生 `timestamp_precision_unknown`。样本 precision 不能证明数据库声明 precision。
- `getTableMetadata()` 的公开 response 不提供 `dbType`；不得仅凭 TableContext 或列名拼写对数据库方言作假设。

尚未证实：真实 bilibili 列的 Host response 是否省略结构化 precision、Host 是否返回 `timestamp(6)`、以及该列是否受其他生成规则影响。

## 精度优先级

1. **P1 — 结构化 Host precision**：最高优先级，保留原 SchemaFact 和 Host provenance；`precision = 0` 有效，类型文本、系统 Metadata 和样本均不能覆盖它。非法结构化值按原校验失败，不由低优先级来源掩盖。
2. **P2 — 显式 temporal type declaration**：只识别 `timestamp(p)`（可带 `with/without time zone`）、`datetime(p)`、`timestamptz(p)`，且只接受单一整数 `0..6`；不会将不兼容类型的时区后缀互相套用。不会解析 NUMERIC/DECIMAL precision、length、复合 typmod 或无括号默认值。来源以 `declared_type` 独立记录，原 Host precision fact 不修改。
3. **P3 — 经 DBX Data API 授权的 system metadata**：仅当 P1/P2 未知时触发。首先通过有界 `SELECT 1` 从公开 Data API result 读取 `dbType`；返回 `mysql` 且 database/table/column scope 安全时，查 MySQL `information_schema.COLUMNS`；返回 `postgres` / `postgresql` 且 database/schema/table/column scope 明确时，查 PostgreSQL `information_schema.columns`。仅接受与目标列 temporal 类型/时区类别一致的 `DATETIME_PRECISION` / `datetime_precision`，只保留 precision 摘要，不保留原始行。
4. **P4 — 样本观测**：只作为输出格式辅助；不能改变声明状态。敏感 temporal profile 继续不保存真实时间值或范围。
5. **P5 — 安全 fallback**：仍未知时保留 `timestamp_precision_unknown`，Plan 明确记录 `schema_seed_fallback` 的实际 3 位精度，不声称数据库保证。

GenerationPlan 和 Workbench view model 分别呈现声明 resolution 与最终输出精度/source。Preview、CSV、JSON、INSERT SQL 仍从同一个当前 ExportDataset 导出。

## DBX Host Data API 可行性与边界

公开 Host API 1.4 `queryData({ connectionId, database?, schema?, sql, maxRows?, timeoutMs? })` 可执行单条经 Host 只读分类器验证的 SQL；公开 result 包含 `dbType`。DBX 源码 `crates/dbx-core/src/query/plugin_data.rs` 证明 permission、用户 grant、开放连接、单条只读语句及行数/超时边界由 Host 执行。公开 request shape 只有 `sql`，没有 bind-parameter 字段；已审计契约没有 `information_schema` 专门拒绝规则，但数据库 catalog 权限和运行时仍可能拒绝。

Resolver 使用 DBX 原生 `host.data:read`、`capabilities.dataApi` 和 `queryData()`；不增加授权 UI，不访问凭据，不自建连接，不用 DBX 私有接口。为避免缺少绑定参数导致 SQL 注入，仅接受 `[A-Za-z0-9_]` 范围内的 database/schema/table/column 名；PostgreSQL 必须有明确 schema，MySQL schema 若提供须与 database 一致；scope 不明确或名称不安全时不发 metadata query。最多 2 次 queryData 调用（方言发现 + 精度查询），后者 `LIMIT 8` / `maxRows: 8`；每次 `timeoutMs <= 3000`。Workbench session 以 LRU 最多缓存 32 组摘要结果。拒绝、超时、缺少 capability、未知/不支持方言、结果异常都降级到 P5。

没有发现 DBX Host 上游 API 问题：Host API 1.3 没有在 `getTableMetadata()` 中提供数据库类型或 structured precision 值时，SchemaSeed 可通过现有公开 Data API 采取独立来源的补全策略。具体真实连接、consent 和 catalog 权限行为仍需 Runtime 验收。

## 自动化证据

合成 Host Fixture 覆盖：Host precision 0 和冲突优先级；`timestamp(0/3/6)`、`datetime(3/6)`、`timestamptz` 与时区语义；unqualified 类型、SQLite-style loose declaration、非法 typmod、numeric precision 隔离；MySQL / PostgreSQL dialect discovery、目标 scope、safe SQL、Data API 缺失/授权拒绝/错误/timeout/异常结果、system metadata precision 0/6 与 type verification；sample-only precision 与未知 warning；固定 seed；Preview / CSV / JSON / INSERT SQL 共用 dataset。PostgreSQL 增补由 Issue #120 P0 完成，Fixture 仍不代表真实 DBX PostgreSQL Runtime。

Fake Host 测试只证明插件消费契约和本地 fallback，不代表真实 DBX consent dialog、MySQL/PostgreSQL catalog 权限或 `bilibili.coupon_claims.checked_at` 的运行结果。

## Windows DBX Runtime 验收清单

> 用户已确认 Issue #82 对应修复的 Windows DBX 手工验收通过。未提供逐项结果记录，因此以下原验收点不逐项标记为 PASS；该确认不代表 macOS 或本次其他 PR 的 Runtime 验收完成。

- [ ] 安装该 Draft PR 构建的 frontend-only `.dbxp`，确认 DBX Host API 1.4 和 `host.data:read` permission。
- [ ] 使用真实 MySQL TableContext 检查 `getTableMetadata()` 原始 `columns[].dataType` / `precision`；原始响应经授权后脱敏记录，不附带凭据或样本业务值。
- [ ] 对 precision 缺失且声明无括号的目标 temporal 列，确认 Host consent 生效、公开 result `dbType=mysql` 后仅执行目标 `information_schema.COLUMNS` query；UI Plan source 应为 `system_metadata`，否则维持 Unknown/fallback。
- [ ] 拒绝 consent、关闭连接或模拟无 Data API 时，确认 Workbench 可继续生成安全字段并保留 `timestamp_precision_unknown`，没有直接连接或权限绕过。
- [ ] 验证 MySQL `timestamp(0/3/6)`、`datetime(6)`、unqualified MySQL 时间类型；PostgreSQL timezone types；SQLite loose/unqualified declarations；NULL 率、相同 seed 复现。
- [ ] 对同一个 Preview 快照导出 CSV、JSON、INSERT SQL，并确认没有重复生成数据或保留真实敏感时间值。

## 未解决事项

- 用户已确认 Windows DBX 手工验收通过；但该次真实 Host/MySQL 原始响应及逐项观测未存入仓库，故本记录不补写未经记录的 `dbType`、catalog 可见性、权限拒绝/超时或目标列 precision 细节。
- macOS DBX Runtime 验收尚未确认完成。
- 在取得合法脱敏的原始响应前，不断言 Issue 报告列的唯一根因，也不判断 DBX Host 是否返回错误 Metadata。
