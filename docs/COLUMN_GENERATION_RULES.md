# Column Generation Rules v0.1

本文件是 Issue #32 的 canonical rule contract。Rule Editor 只编辑下列 tagged `GenerationRule`；schema compatibility、validation、planning 与 diagnostics 由 Core 提供，UI 不维护第二套类型/边界表。

## Domain model and precedence

规则按列以显式 discriminant 序列化到现有 `buildGenerationPlan(schema, { rules })`：

```js
{ rules: {
  customer_id: { kind: "sequence", start: 1, step: 1 },
  state: { kind: "enum", values: ["active", "inactive"] },
} }
```

只接受 `auto`、`constant`、`sequence`、`random_integer`、`random_decimal`、`random_string`、`enum`、`boolean_ratio`、`date_range`、`timestamp_range`、`uuid`、`null_ratio`、`semantic`。配置字段严格按 rule kind 校验；未知字段、错误类型和非法候选都会使该列 plan blocked，不会 coercion、静默截断或 fallback。

Rule 选择优先于已有 semantic/fallback path；hard schema facts 始终是不可覆盖的限制。`Auto` 是默认选择：保留既有 semantic mapping precedence 和现有 schema-type fallback。现有 inference candidate（包括 low confidence）不会因打开/编辑 UI 而被确认。

## Rule configurations and semantics

| Kind | Configuration | Compatibility / semantics |
| --- | --- | --- |
| `auto` | 无 | 复用现有 Semantic Mapping 与 schema fallback；不增加 inference engine。 |
| `constant` | `value` | 每行使用同一 scalar。Integer 必须是 safe integer；decimal 用 exact decimal string；string、boolean、date、timestamp 必须严格类型匹配。varchar 不超已知 length；decimal 不超 precision/scale；date 为有效 `YYYY-MM-DD`；timestamp 为 UTC ISO `Z`。不做隐式转换、round 或 truncate。 |
| `sequence` | `start`, `step` | 仅整数 / decimal。按 logical row ordinal 计算 `start + rowIndex × step`，可使用负 step，不依赖 mutable counter。Planning 检查本次 rowCount 的末值与 schema representability，溢出则阻塞整份 plan。Decimal start/step 是精确 string，内部按 scale 对齐整数单位计算。 |
| `random_integer` | `min`, `max` | Safe integer，inclusive range，`min <= max` 且整个范围落在目标整数 schema bounds 内。 |
| `random_decimal` | `min`, `max` | Exact decimal strings，inclusive range。两端必须可由 schema scale 表达，且符合 precision；内部以 BigInt unscaled units 计算，不经 JS floating-point。 |
| `random_string` | `length` | 固定正长度，按 Unicode code point 检查已知 varchar length；超界阻塞。Length 为 unknown/unavailable/unsupported 时不猜测上限，Core 诊断并阻塞；明确 absent/not-applicable 仍按 metadata fact 语义处理。 |
| `enum` | `values[]` | 至少一个 unique scalar candidate；逐个按目标 schema 校验，任一无效或重复则整条 rule invalid。Uniform deterministic selection；无 weights / probability DSL。 |
| `boolean_ratio` | `trueRatio` | `0..1` 小数比例语义；每个 cell 独立 deterministic，`0` 全 false，`1` 全 true。 |
| `date_range` | `start`, `end` | 严格有效 date-only `YYYY-MM-DD`，inclusive 边界，`start <= end`。只用 UTC 日期编码，不经过 local timezone。 |
| `timestamp_range` | `start`, `end` | UTC ISO timestamp，必须以 `Z` 结尾；inclusive，`start <= end`。按 schema precision 0–9 位校验和生成；精确到 nanosecond 的逻辑时间不依赖 locale 或机器 timezone。Precision fact 未知时沿用现有 millisecond fallback 并保留 warning，不声称数据库精度保证。 |
| `uuid` | 无 | 基于稳定 cell identity 的 synthetic deterministic UUID，RFC variant 与 v4-style version bits 固定；不是业务 UUID、真实性或唯一性承诺。支持 native UUID 与可证明容纳 36 字符的 varchar。 |
| `null_ratio` | `ratio` | `0..1` deterministic。`ratio = 0` 不产生 NULL；`ratio > 0` 仅在 schema 明确 `nullable=true` 时可用，NOT NULL 或 nullable unknown/unavailable/unsupported 时拒绝。UUID 可使用此 rule 包裹既有 synthetic UUID base strategy。 |
| `semantic` | `semanticType` | 用户明确选择后，走现有 Semantic Mapping precedence、Safe Synthetic Person 和 Person group/row identity。不会创建新的姓名、手机号、email generator，也不会自动确认 inference。 |

## Validation, diagnostics, and availability

Core exports `validateGenerationRule(columnSchema, rule)`、`getCompatibleGenerationRules(columnSchema)` 与 semantic-compatible options。Plan diagnostics 保留 severity、blocking、table、column、rule、code 和 actionable reason。Warning 可继续生成；blocking/error/unsupported required facts 阻止 GenerationPlan 执行。GenerationPlan 保留有效或可安全展示的当前 selection；无效 rule 不会被替换为 Auto。

Runtime GenerationPlan 负责 sequence rowCount overflow、schema bounds、varchar length、decimal precision/scale、timestamp precision 与 nullability 冲突的统一检查。Rule Editor 只 render Core 给出的 choices、field descriptors 和 diagnostics。

## Deterministic identity

有效配置先按 rule-defined scalar fields canonicalize（对象 key 顺序不影响结果），再产生版本化 SHA-256 rule identity。每个物化值沿用现有 random-access identity：

```text
seed + table identity + column identity + row identity + rule identity + value slot
```

Person semantic values继续使用现有 `Person group + row identity + locale + semantic rule identity` contract。没有共享 RNG cursor、`Math.random()`、执行顺序依赖或跨列消耗；改变 A 的 rule、增列或调整列顺序不会扰动无依赖的 B/C。相同 schema/rules/seed/row identity 可 replay；导出不重新生成。

## Workbench state and scope

正式 DBX Generation Workbench 复用现有 `DbxHostSchemaMetadataProvider → TableSchema → generation/preview RPC → buildGenerationPlan() → generateRows()`。RPC 扩展既有 `generation/preview` 请求以承载 `rules`；规则编辑时可用同一 method 的 `validateOnly` 仅重建 plan/diagnostics，不生成 dataset。

规则是当前 Workbench table session state，不持久化。A→B→C 切换清空旧 rules、plan、diagnostics、Preview 与 Export dataset；已有 stale-request revision guard 不变。编辑规则后立即清除当前 dataset、进入 dirty/blocked 状态并禁用 Export；只有当前 rule plan Generate 成功后 Preview 与 Export 才恢复。CSV/JSON 继续只序列化当前 Preview 的同一个 `ExportDataset`。

Standalone fixture harness 可消费同一个 Core；正式 Workbench 不读取 fixtures。`.dbxp` 包含 `generation-rules.mjs`、Core/runtime、正式 UI 与 provider，排除 fixtures、fixture provider/controller、tests 和 standalone harness。#31 的 DBX E2E runtime gate 所需 release 已由 DBX v0.6.23 满足（首个正式包含 upstream `t8y2/dbx#10244`）；runtime smoke 已于 2026-09-26 在该版本通过（SchemaSeed v0.2.4 candidate，记录见 [PHASE1E](PHASE1E_PRODUCTION_WORKBENCH.md#runtime-smoke-record)），未编译 upstream、未伪造 smoke。

## Non-goals

约束/关系引擎、PK/UNIQUE/CHECK/FK、SCD、Regex/Template/DSL、weighted Enum、AI rules、masking、Direct Insert、SQL Export、rule persistence/profile、跨表 template、额外数据库连接与 DBX upstream 修改均不属于 v0.1。
