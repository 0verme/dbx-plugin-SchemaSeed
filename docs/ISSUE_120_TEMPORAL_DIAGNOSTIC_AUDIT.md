# Issue #120 — 时间精度数据流与诊断呈现审计

审计基线：`origin/main` `651fb5af8dc75c4b7f3724475ace133665d12361`。本记录区分已由源码/Fixture 证明的消费契约与尚缺少真实 Host 响应的运行事实；不把截图当作 DBX Host Bug 证据。

## 历史修复边界

- #82 / PR #91 已合并：修复显式 temporal typmod 解析、最终精度来源记录和经过授权的 MySQL system-metadata 回退。`docs/ISSUE_82_TIMESTAMP_PRECISION.md` 记录了原始 Host 响应缺口和 Runtime 验收边界。
- #67 / PR #68 已合并：未知 schema precision 时使用合法微秒样本观察；Issue #67 记录 Windows Runtime PASS。
- #69 / PR #70 已合并：敏感 temporal 可产生不含真实时间值/范围的受限格式 profile，并与普通 temporal 使用一致的精度优先级。
- #111 / PR #113 已合并：高级设置弹窗、诊断页签、双语、关闭/保存状态均已存在。本 Issue 不重建弹窗。

## 源码证明的数据流

```text
DBX getTableMetadata()
 → requestDbxTableMetadata()
 → DbxHostSchemaMetadataProvider
 → normalizeTableSchema() / SchemaFact
 → resolveTemporalPrecision() + temporal metadata resolver
 → buildGenerationPlan()
 → generateRows()
 → createExportDataset()
 → CSV / JSON / INSERT SQL serializers
```

### 1. Host DTO 与 Provider

- `src/host/dbx-schema-metadata-probe.mjs` 只经公开 DBX Host Schema Metadata API 消费表结构；校验 `dataType`、`nullable`、可选结构化数值字段及 `fieldCapabilities`。`dataType` 会去除外围空白，但不解析/重写其类型声明。
- `src/providers/dbx-host-schema-metadata-provider.mjs` 把 `dataType`、`nullable`、precision 等映射为保留 provenance 的 `SchemaFact`。非空结构化精度（包含 `0`）是 `known`；缺失/`null` 按 capability 保留 `absent`、`unavailable`、`unknown` 或 `unsupported`。若 capability 说 unsupported 却返回值，则拒绝矛盾响应，不回退覆盖。
- `src/schema/schema-model.mjs` 保留所有事实状态和可用 provenance；缺省值成为 `unknown`，不会伪造 `0`、空字符串或 asserted absence。

### 2. Temporal declaration、方言与未知状态

- `src/schema/schema-interpreter.mjs` 的结构化事实优先级最高，其次解析受支持的显式 temporal declaration，再消费经过验证的 system metadata。`timestamp(p)`（可带 `with/without time zone`）、`datetime(p)`、`timestamptz(p)` 仅接受单整数 `0..6`；numeric precision、字符串长度、多参数 typmod、不兼容时区后缀和无括号类型不会被当成显式精度。
- 未知的类型声明不代表数据库精度为 `0`、`3` 或 `6`。显式 `TIMESTAMP WITH/WITHOUT TIME ZONE` 还单独决定时区语义；小数位精度不能替代时区语义。
- `src/host/dbx-temporal-metadata-resolver.mjs` 仅在 Schema/声明仍未知、Host 暴露 Data API 且 DBX 授权后，先读取公开结果 `dbType`。确认 MySQL 后，要求安全的 database/table/column scope（若带 schema 则须与 database 一致），查询目标列 `information_schema.COLUMNS.DATETIME_PRECISION`；确认 PostgreSQL 后，要求明确 database/schema/table/column scope，查询目标列 `information_schema.columns.datetime_precision`，并核对返回 temporal timezone 类别。两条路径均限最多 8 行、3 秒，不读取业务值；MySQL `0` 与 PostgreSQL `6` 都只接受为经验证的 catalog metadata，不按类型文本猜值。拒绝/失败/超时/SQLite/未知方言均安全回退。
- PostgreSQL 结构化 precision 缺失时，原始 #82 resolver 会在方言分支后直接保留 UNKNOWN；P0 审查按“方言有明确默认”验收要求定位并修补了该缺口：通过 DBX Data API 读受限 PostgreSQL catalog metadata，而非硬编码 `timestamp=6`。没有数据库/schema scope、catalog 无结果或返回类型不匹配仍保留 UNKNOWN，不把 fallback 伪装成数据库事实。SQLite 没有本 resolver 的 system metadata 查询。真实目标表 Host response/driver 行为须 Runtime 单独验证。

### 3. Plan、样本和生成

- `src/generation/generation-plan.mjs` 保存声明状态与最终 generation precision/source。已知 schema/system metadata 不被样本覆盖；未知时，匹配类型/时区语义的合法 temporal profile 可提供 `sample_observation` 格式精度，否则采用记录为 `schema_seed_fallback` 的 3 位回退。SchemaFact 仍保持原来的 unknown/unavailable 状态。
- `timestamp_precision_unknown` 是非阻塞 Warning。选中显式 `timestamp_range` 时，`validateGenerationRule()` 已发出对应 Warning，Plan 避免再重复追加；独立 Plan 实证仍得到恰好一个 Warning、`blocking=false` 和 3 位 fallback。
- 标准 temporal sample range 可以使用单列观测范围；敏感 temporal `temporal_shape` 不携带真实时间值或 observed bounds，只允许安全摘要，并使用 schema fallback 范围。样本 profile 不证明声明精度。`generation-runtime.mjs` 对 sampleEvidence 做字段白名单校验并拒绝真实样本行/值。
- `generation-engine.mjs` 用 plan 的 precision、时区语义和 per-cell Seed 身份生成/格式化时间。确定性不依赖共享 RNG 或字段迭代顺序。

### 4. Preview / Export 与表切换

- `DbxGenerationWorkbenchController` 加载 metadata/授权 system metadata，再单独执行样本流程；切表时清空旧 schema、metadata、sample evidence、plan、dataset 和 diagnostics。
- 一次成功生成创建当前不可变 `ExportDataset`；`prepareExport()` 的 CSV、JSON、INSERT SQL 均序列化该 snapshot，不重新调用生成器。INSERT SQL 是文本导出，不会执行数据库写入。
- 高级设置页签/诊断渲染由 `ui/generation-workbench/app.mjs` 的 view-model/UI 路径完成；切换标签、展开 HTML `<details>` 和 `setTranslator()` 不发起 Core generation/sample dispatch。

## P1 诊断聚合与展示实现

- `describeDiagnosticGroups()` 仅对有明确 table/column 的诊断按原表标识、code、raw reason、Core severity/blocking、局部化 action 与 semantic copy 严格分组；无表/字段的全局诊断保持单条。分组保留每条原始 Core 记录、原有 rule/table/column/reason 与独立的字段说明，不改写 Core 协议。
- 折叠卡片显示用户可读标题、字段数量、受影响字段（超过 5 项时仅摘要显示并说明其余数量）、安全 TableContext label、原因/建议和当前生成/预览/导出影响。Warning 不强制展开；blocking 状态通过有效级别和红色样式突出。Error/Warning/Info 标签与 Core 原始 severity 分开保留；catalog override 只允许非阻塞 Warning 转为 confirmation，不得更改 Core blocking、降级 Core error/unsupported/info。
- 键盘可访问的原生 `<details>` 为每条字段保留诊断代码、severity、blocking、rule、Core reason、Schema 类型/precision fact state/provenance、解析精度 source/provenance、最终 generation precision/source 和 rule source。UI 用当前 DBX database/schema/table 上下文替代内部 `dbx:[connectionId,...]`；没有上下文时不展示 raw internal table ID；技术值通过 `textContent` 写入，不插入 JSON/HTML。字段详情不读取 sample values、observed ranges 或真实业务数据。
- 当前 Preview/Export 能力按 view-model 状态呈现；INSERT SQL 明确是文本且不会由 SchemaSeed 执行写库。切表仍由 Controller 清除旧诊断；打开弹窗/诊断、展开 details、切标签只读 DOM/view-model；切 UI locale 仅调用 `setTranslator()` 并重绘 presentation。
- 双语测试覆盖同因分组/非同表或原因不合并、字段计数、未知代码的 raw reason 仅在折叠详情、精度 availability/source、Connection ID 遮蔽、blocking override 不降级、Info 级别、impact 状态和 UI 无 dispatch 路径。

## 回归覆盖及本轮增补

已有源码/测试覆盖结构化 precision `0` 与声明冲突、`TIMESTAMP(0/3/6)`、`DATETIME(6)`、`TIMESTAMPTZ(6)`、时区后缀/非法 typmod、metadata unknown/unavailable、样本精度不覆盖 schema、MySQL 方言发现/consent 失败/边界、安全回退、敏感 temporal profile、同类型标准/受限样本一致性和 Preview/CSV/JSON/INSERT 同一 dataset。

本轮测试增补在 `tests/temporal-precision.test.mjs`：

- `DATETIME(3)` 显式精度；无括号 `TIMESTAMP WITH TIME ZONE` 保持未知精度且时区语义正确。
- 显式 `timestamp_range` 下未知精度仍恰好出现一个 non-blocking warning，不因重复抑制而漏报。
- 通过已授权、目标列限定的 MySQL metadata 结果读取 unqualified `DATETIME` 精度 `0`，不将值伪装成类型文本推断。
- PostgreSQL 必须有 database/schema/table scope；通过 `information_schema.columns` 匹配无时区/带时区 timestamp 的 `datetime_precision=6`，将两个 source 记录为 `system_metadata`，不重写 SchemaFact，并对错类型结果 fail-closed。
- 同一 unknown schema 配合 0 位与 6 位样本时，generation source 明确为 `sample_observation`、声明状态继续 unknown、Warning 保留且相同配置/Seed 可重放。

PostgreSQL 查询由 DBX `queryData()` 执行并受现有 `host.data:read` permission、Data API capability、connection consent 控制；没有新建 DB 连接。Fixture 仅验证 resolver 消费 SQL/result 的约定，真实 DBX PostgreSQL Runtime 仍 PENDING。

P0 最终定向验证覆盖 `temporal-precision`、DBX Host Provider、Workbench Controller、sample probe、诊断本地化、高级设置、Preview/Export 保存七个测试文件：**131/131 passed，0 failed**。P1 最终诊断/i18n/Workbench/temporal 定向测试覆盖七个测试文件：**121/121 passed，0 failed**；12-field/compact-list 补充回归 **36/36 passed**。

P2 全量验证：`npm test` **386/386 passed，0 failed（48 suites）**；`npm run lint` 通过（103 files）；`npm run typecheck` 的 manifest/Core/Host/package-input checks 通过；`npm run build` 构建 universal `.dbxp` review candidate（unsigned），`npm run smoke:package-identity` 确认 manifest/archive/artifact 一致。`dist/` 被 ignore，tracked dist files 为 0；最终 `git diff --check` 通过。首次全量测试因为该 Worktree 的 ignored `node_modules` 缺少锁定的 `@dbx-app/plugin-cli@0.1.9` 未通过；为本 Worktree 执行 `npm ci --include=dev` 后 package-contract **5/5** 和全量测试全部通过，无 tracked dependency/artifact 变更。

## 结论与未完成的真实证据

- 当前 `origin/main` 已包含 #82/#67/#69 的核心修复；深入核对方言默认路径后发现 PostgreSQL 无精度声明且 Host 没给结构化 precision 时没有 catalog fallback，违反本 Epic 的方言默认验收要求。P0 已新增受授权、受 scope 限制的 PostgreSQL metadata path 和严格结果校验；未重写已合并的显式类型/样本逻辑。
- 没有本轮真实 DBX Host 原始 metadata；Issue #82 所述 `bilibili.coupon_claims.checked_at` 原始响应、方言/目录可见性及拒绝 consent 的逐项记录仍未归档。#82 文档只记录 Windows 用户确认手工验收，不等于拥有上述响应证据。本次 PostgreSQL `information_schema` path 未连接真实 DBX/PG，Runtime 验收继续 PENDING。
- #67 Windows 微秒样本验收为历史 PASS；本 Epic 新包的 Windows/macOS Runtime 均仍为 `PENDING`，macOS 特别待维护者实机验证。
- 若自动测试完整通过但缺少真实 Host 环境，仍可完成自动化 P0/P1/P2 并准备 Draft PR；不得将 `PENDING_RUNTIME` 写为 PASS。
