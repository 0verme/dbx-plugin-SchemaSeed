# SchemaSeed Generation Model

## Status

**Design Freeze for Issue #12 — Phase 1 implementation input**

> 本文是分层与职责的设计模型；Phase 1B 的实际 Semantic / Person contract 由 [PHASE1B_ARCHITECTURE.md](PHASE1B_ARCHITECTURE.md) 具体化。Issue #13 已完成 Design Freeze，implementation 单独由 #19 跟踪。
>
> Current integration status: Phase 0 #6 is CLOSED; production metadata adapter #30, packaged Workbench #31, Column Generation Rules #32 and the explicit Manual Single-table Constraint Engine #37 are implemented on their respective tracks. The adapter maps into this SchemaSeed-owned model, while the Core remains unaware of DBX DTOs and runtime APIs. The frozen 13-rule contract is documented in [COLUMN_GENERATION_RULES.md](COLUMN_GENERATION_RULES.md); explicit Unique / Composite Unique / Required + Unique semantics are authoritative in [MANUAL_CONSTRAINTS.md](MANUAL_CONSTRAINTS.md). Official DBX runtime smoke / #31 acceptance and #32 runtime E2E remain pending a release containing upstream #10244; #37 does not satisfy or alter those runtime gates.

本文档冻结 SchemaSeed 的最小 Generation Model 语义与职责边界。它是 SchemaSeed 的 **Conceptual / Internal Draft**：

- **不是 DBX SDK Contract**；
- **不是 DBX Host API Contract**；
- **不是 wire format**；
- **不承诺任何上游 API method、permission、DTO、SDK type 或 Host API version**；
- 不包含 Generator、Faker、Constraint Engine、Relation Planner、Exporter 或 Workbench 实现。

本文档的输入边界是 **SchemaSeed normalized schema facts**，而不是某个具体的 DBX API DTO。原上游需求 `t8y2/dbx#9917` 已由 #10043 落地为 Host API 1.3；Phase 1A 的实现保持 fixture-only。当前 Phase 0 Gate 已由 PR #33 关闭，production `DbxHostSchemaMetadataProvider` 已由 #30 实现并将 Host DTO 映射为本模型的 domain facts；详见第 15 节。

## Goals

本模型要让后续 Phase 1 implementation 能够在不重新争论基础语义的情况下实现：

1. 将数据库类型事实、业务语义、生成规则、语义分组和数据库约束分开；
2. 让每个推断和 override 都可解释、可审查；
3. 在执行 Generator 之前形成可 inspect 的 `GenerationPlan`；
4. 使同一 `plan + seed` 在 Preview、Export 和重复生成之间保持稳定的逻辑数据；
5. 明确 `NULL`、省略列、数据库默认值和 identity 的差异；
6. 对未知、缺失、不支持和冲突保持显式诊断，而不是伪造值或静默重试；
7. 以离线、可复现、无 AI、无外部服务、无数据库写入作为 baseline。

## Non-goals

本 Issue 不实现或冻结以下内容：

- Generator、Faker provider、真实数据 provider 或字段算法；
- Schema Metadata Host consumer、DBX bridge、permission、wire DTO 或 API method；
- Constraint Engine、Relation Planner、FK graph、DAG 或完整 relational dataset；
- SCD / 拉链表、Temporal Dataset 或 state-transition engine；
- SQL / CSV / JSON Exporter、Direct Insert、数据库连接或第二套连接体系；
- Workbench UI、配置面板或 UI 状态机；
- AI inference、外部网络服务或 LLM 运行时依赖；
- `information_schema`、`pg_catalog`、`SHOW`、`PRAGMA` workaround；
- 通过 DBX private Store、Credential、private frontend/Tauri API 获取 metadata。

## Design Principles

### 1. 先保留事实，再做解释

`dataType`、length、precision、scale、nullable、default、identity 和 constraints 是 schema facts。`SemanticType` 是对这些事实和列名证据的解释；解释不能反过来改写事实。

### 2. schema type 不等于 semantic type

`VARCHAR(18)` 只说明一个字符串类型及其长度上限。它可以成为 `id_card` 的 evidence，但不能直接证明该列就是身份证号。`BIGINT` 也不自动表示 `customer_id`，`DECIMAL(18,2)` 也不自动表示金额。

### 3. hard constraint 不是用户偏好

用户可以改变生成规则和 semantic mapping，但不能让系统假装 `NOT NULL`、`UNIQUE`、PK 或已知 `CHECK` 不存在。冲突必须进入 plan diagnostics。

### 4. Plan 先于执行

Column、Semantic、Consistency / Constraint 层先参与 planning，生成值之前冻结一份可 inspect 的 plan。Generator 执行的是 plan，不是在执行过程中临时猜测规则。

### 5. 不静默强推断

自动 inference 必须保留 candidate、confidence、evidence 和 status。低置信度、未知语义、敏感语义和需要跨字段一致性的语义不能在没有可见记录的情况下被强行启用。

### 6. 不把重试当作正确性

Constraint 冲突不是通过无限 `while true { regenerate() }` 隐藏的。计划阶段先检查可满足性；生成和验证阶段都使用有限、可报告的结果。

### 7. 稳定性依赖 logical identity，而不是调用顺序

随机值流必须按 dataset、table、column、row 和 rule 的逻辑 identity 派生。增加一个字段不能因为多调用了一次随机函数而让其它字段全部漂移。

### 8. Unknown、unsupported、missing 各有含义

- `unknown` 不等于 `false`；
- `unsupported` 不等于“不存在”；
- `missing` 不等于 `0`、空字符串或默认布尔值；
- metadata acquisition failure 不等于合法的空 schema。

## Model Overview

Generation Model 的总体边界如下：

```text
DBX Table Context + normalized schema metadata
                  ↓
        Schema Interpretation
                  ↓
        Column Generation planning
                  ↓
        Semantic Generation planning
                  ↓
     Consistency / Constraint planning
                  ↓
            GenerationPlan
                  ↓
       Generator execution (future)
                  ↓
          Validation (future)
```

其中后三层是 plan 中的可审查决策，不表示 Generator 可以在运行时绕过 plan。更精确的执行分层是：

```text
Planning:
  schema facts → interpretation → column/semantic/constraint decisions
       ↓
Generation:
  legal column domain → semantic values/groups → constraint allocation
       ↓
Validation:
  generated dataset → explicit validation result and diagnostics
```

模型只消费 SchemaSeed normalized facts。Phase 1A 的 facts 来自仓库 fixtures；未来正式 Host metadata acquisition 仍在模型外部完成，并由独立 adapter 转换为同一内部 facts。当前已验证的 Table Context 是 SchemaSeed 内部的 table identity consumer contract；它不能被当成 Schema Metadata API。

## 0. Normalized Schema Metadata Boundary

### 0.1 输入不是 DBX wire DTO

Generation Model 的输入概念上包括：

- table identity；
- column name 和 database native/general type；
- nullable；
- length、precision、scale（适用时）；
- default fact；
- identity / auto increment fact（适用时）；
- enum-like values（只有 metadata 明确提供时）；
- PK、UNIQUE、CHECK 等 constraint facts（当前作为 future-capable input）；
- driver/provenance 和每个 fact 的可用性状态。

这些是 SchemaSeed 的 normalized consumer-side facts，不是 DBX 的最终返回对象。上游 method、permission、transport 和字段命名变化时，只应影响 metadata adapter，不应重新定义 Generation Model 的层次。

### 0.2 Fact availability

为避免把不同原因压成一个 optional 空值，内部概念应保留类似以下 tagged 状态：

```text
value              Host/driver 提供了可消费的值
absent             该对象没有该属性，例如没有 default
not_applicable     该属性对当前 driver/model 不适用
unavailable        driver 没有结构化暴露该值
unsupported        当前 Host capability 不支持该能力
failed             本次 metadata 调用失败
```

这是 **Conceptual / Internal Draft**，不是 wire representation。具体上游 API 使用何种表示方式不影响以下规则：

- SQLite 没有结构化 precision 时不能伪造 `precision = 0`；
- `default` 不存在不能与 Host 不支持或调用失败混淆；
- `nullable` 无法确认时不能静默当作 `false`；
- `failed` 不能被解释为空的 `columns`。

## 1. Column Layer

### 1.1 职责

Column Generator / Column Layer 负责把 schema facts 解释为**单列合法值域和基础生成意图**：

- 识别 database type family；
- 应用 length、precision、scale、native width 等类型边界；
- 表达 nullable、default、identity 对生成意图的影响；
- 为 enum-like column 使用 metadata 明确提供的有限值域；
- 给 Semantic Layer 提供一个不会违反基本 database type 的 column domain；
- 对类型事实缺失、不支持或互相冲突产生 diagnostics。

Column Layer 的输出是候选 domain、基础 rule 和 execution intent，不是具体 provider 实现。需要 row identity 的 deterministic sequence 也只能消费 plan 提供的 `rowIdentity`；row identity 的分配属于 Dataset/GenerationPlan，数据库 identity 则属于 database-owned constraint intent，不能由 Column Layer 偷渡成普通计数器。

### 1.2 输入与输出

输入：

```text
normalized ColumnSchema facts
+ user explicitly selected column-level rule（如果存在）
```

输出：

```text
column domain
+ type-safe GenerationRule candidate
+ nullable/default/identity intent candidate
+ column-level diagnostics
```

Column Layer 不负责：

- 从列名推断 `email`、`mobile`、`id_card` 等业务语义；
- 识别 Person group；
- 产生 birthday 与 id_card 的一致性；
- 跨行 UNIQUE、PK、FK 或关系 cardinality；
- 解析或执行数据库 default expression；
- 通过截断、改写或静默 fallback 掩盖 semantic rule 与类型上限的冲突。

### 1.3 最小类型覆盖

| Schema type family | Column Layer 处理的事实 | 生成域结论 | 明确不作的推断 |
| --- | --- | --- | --- |
| `integer` | native width、signedness、identity metadata（若有） | 在可知的整数范围内生成；identity 是独立 intent | `BIGINT` 不等于 `customer_id`，整数值不自动 unique |
| `decimal` / numeric | `precision`、`scale` | `precision = p`、`scale = s` 时保留最多 `p-s` 个整数位和 `s` 个小数位；不能超出数据库可表示域 | `DECIMAL(18,2)` 不自动等于 amount，也不推断 currency |
| `varchar` / text | 最大 length、fixed/variable 信息（若有） | 候选字符串必须遵守长度上限；length unavailable 时保留 unavailable | `VARCHAR(18)` 不等于身份证，`VARCHAR(11)` 不等于 mobile |
| `boolean` | native boolean capability | 基础域为 true/false；NULL 是另一个 execution intent | 列名 `is_active` 不改变 database type fact |
| `date` | date type、nullable、可能的 user date window | 在配置的日期域内生成 date 值；日期域不是由列名自动决定 | `birthday` 需要 Semantic Layer；不从 DATE 自动推出生日 |
| `timestamp` | timestamp precision、timezone capability（若有） | 在配置的时间域内生成 timestamp；timezone unknown 时保留诊断 | `created_at` 不自动等于 database `now()` |
| enum-like | metadata 明确提供的 enum members 和 provenance | 在已知有限成员中选择；成员缺失时不能凭列名伪造集合 | `status` 列名不等于某一组固定枚举值 |

数据库类型还可能存在本表未覆盖的 family。没有可验证 domain 时，plan 保留 `unsupported` 或要求显式 rule；不能以任意字符串、零值或空值冒充成功。

### 1.4 类型属性与 generation domain

#### length

- `length` 是单列长度边界，不是 semantic classifier；
- 若 `length = 18`，字符串 rule 必须能证明输出不超过 18 个 database 计量单位；
- driver 没有结构化 length 时，保留 declared type text 作为 metadata evidence 也不能自动当作已验证的 numeric bound；
- 不允许因为 provider 输出过长而静默截断，除非用户明确选择了截断规则且该规则仍可满足 constraint，并在 plan 中可见。

#### precision / scale

- `precision` 和 `scale` 是 decimal domain 的硬边界；
- `scale` 不是“显示小数位”的装饰，而是可存储值域的一部分；
- `precision` 或 `scale` unavailable 时，不得用 `0` 或某个默认精度伪造可行性；
- Semantic Layer 可以建议 `amount`，但不能把缺失的 precision/scale 补成业务假设。

#### nullable

- `nullable = true` 表示 `GENERATE_NULL` 是允许的候选，不表示每行都必须为 NULL；
- `nullable = false` 表示 NULL 是 hard conflict；
- nullable unknown / unsupported 时，plan 不能把它当作 false，任何需要 non-null guarantee 的执行必须阻塞或显式标记 unsupported；
- null probability 是 generation preference，不能覆盖 `NOT NULL`。

#### default / identity

Column Layer 只识别 database-owned behavior，并形成 internal intent。它不执行 expression，也不把 identity 当普通 integer provider。具体 intent 见 [Nullable / Default / Identity Semantics](#8-nullable--default--identity-semantics)。

## 2. Semantic Layer

### 2.1 schema type 与 semantic type

`SemanticType` 描述列或一组列在业务上的可能含义，例如：

```text
name
full_name
mobile
phone
email
id_card
cert_no
gender
birthday
address
account_no
customer_id
amount
currency
```

SemanticType 不是 database type、不是 constraint、不是 provider 名称，也不自动授予 validator-compatible 能力。特别是：

- `customer_id` 是 identifier 语义候选，不等于 PK 或 UNIQUE；
- `amount` 是金额语义候选，不自动推断 currency、范围或会计规则；
- `phone` 与 `mobile` 可以是不同 semantic candidate，locale 和业务约束不能从名字强行补齐；
- `id_card`、`cert_no` 等敏感或高风险语义默认需要可见确认。

### 2.2 Semantic inference 的输出

每个自动 inference 至少产生以下信息：

```text
SemanticCandidate
  type: SemanticType | unknown
  confidence: high | medium | low | unknown
  evidence: Evidence[]
  status: proposed | needs_confirmation | selected | rejected | conflicted | unknown
  source: automatic | user_confirmed | user_explicit | fallback
```

这是 **Conceptual / Internal Draft**，不是 SDK type。Semantic Layer 的输入是 Column Layer 的 domain、normalized facts、用户选择和已有 evidence；输出是 semantic candidates、selected mapping、semantic rule/group proposal 和 semantic diagnostics。未来执行时，Semantic Generator 只能在 Column domain 内产生语义值，不能绕过 hard type bounds 或代替 Consistency Layer。

Evidence 应包括来源、事实和解释，例如：

```text
Evidence
  source: column_name | data_type | length | precision_scale | enum_values | comment | constraint
  observation: "column name contains cert"
  value: "VARCHAR(18)"
  explanation: "name and length are compatible with a certificate-like identifier"
```

Baseline 不读取真实行样本，不依赖外部网络，也不调用 AI。Evidence 必须能在 normalized metadata 和用户选择中复核。

### 2.3 Confidence 与处理策略

不使用没有可解释含义的百分比阈值。confidence 的冻结语义如下：

| Confidence | 含义 | 默认 plan 行为 |
| --- | --- | --- |
| `high` | 多个独立 metadata evidence 一致，且语义不引入未确认的跨字段/敏感保证 | 低风险 scalar semantic 可以作为 automatic selected，但必须在 plan 展示 source/evidence；敏感语义或 semantic group 仍需确认 |
| `medium` | 有合理 evidence，但存在多个同样可能的解释 | `needs_confirmation`；未确认前使用 schema-type fallback |
| `low` | 只有弱 evidence，不能支撑稳定选择 | 只作为 suggestion；使用 schema-type fallback，并给出 warning |
| `unknown` | 没有可解释 candidate，或所需 metadata unavailable | 不创建假 semantic；使用可用的 schema fallback，或在无安全 fallback 时标记 unsupported |

“automatic selected” 不等于隐藏推断：其 candidate、confidence、evidence 和 source 必须存在于 `GenerationPlan`，Workbench 可以展示。任何会引入 Person consistency、validator-compatible、身份证 checksum 或其它敏感承诺的 semantic candidate，即使 confidence 为 `high`，也不能在没有确认时自动升级为这些承诺。

### 2.4 Inference 错误、fallback 与确认

- 自动 candidate 与 Column domain 不兼容：丢弃该 automatic candidate，回到 schema fallback，并产生 warning；不静默截断或强行转换；
- 用户确认的 mapping 与 Column domain 不兼容：保留用户意图并产生 blocking `generation_impossible` error，不自动换成另一个 semantic；
- 用户显式 rule 与自动 candidate 冲突：显式 rule 生效，automatic candidate 保留为被覆盖 evidence；
- 没有安全 fallback：plan 可以被 inspect，但不能进入 executable 状态；diagnostic 为 `unsupported` 或 `generation_impossible`；
- inference 不会因为失败而随机选择另一个 semantic type。

## 3. Semantic Groups

### 3.1 Group 的边界

`SemanticGroup` 属于 Semantic Layer，但只负责表达：

```text
哪些列被认为属于同一个 logical context，以及每列在该 context 中的角色。
```

例如 `Person` 可以包含：

```text
name
full_name
gender
birthday
id_card
mobile
email
address
```

Group 输出的是 membership、role、evidence、confidence 和启用状态，不直接实现跨字段值生成。它不表示真实个人、不读取真实个人数据，也不替代 table/row identity。

### 3.2 Group 与 Consistency 的分工

以下规则不放入单字段 semantic provider：

```text
birthday ↔ id_card
 gender  ↔ id_card
 age     ↔ birthday
 locale  ↔ mobile/email/address
```

Semantic Layer 只可以输出：

```text
Person group candidate
  members: birthday / gender / id_card / ...
  roles:   birth_date / gender / identity_document / ...
  status:  proposed / confirmed / disabled
```

Consistency / Constraint Layer 再决定是否以及如何检查或协调这些关系。Issue #13 负责进一步设计 Safe Synthetic、Validator-Compatible、身份证 checksum 和具体 Person consistency；Issue #12 不抢做这些规则。

### 3.3 Group disabled 的语义

用户关闭 `Person` group 时：

- `Person` 的跨字段 consistency contract 不执行；
- 已独立确认的单列 semantic mapping 可以继续存在，例如 `birthday` 仍可作为单列 date semantic；
- group inference 不能偷偷重新启用 group；
- 若用户希望连单列 semantic 也禁用，必须另有 column-level explicit rule 或 mapping override；
- plan 记录 `group.status = disabled` 和影响范围，并给出 info/warning，而不是删除 evidence。

## 4. Consistency / Constraint Layer

### 4.1 职责

这一层消费：

- Column domain 和 generation rules；
- Semantic mapping 与 SemanticGroup membership；
- normalized database constraint facts；
- dataset settings、row identities 和 user policy。

它负责：

- 把 hard database constraints 转换为 generation obligations；
- 规划跨字段 consistency、唯一性和 identity allocation 的策略；
- 在生成阶段协调已被 plan 批准的值；
- 在最终结果上独立验证并返回显式 diagnostics。

它不负责：

- 重新猜测 schema type；
- 把列名当作 constraint；
- 将 FK 自动扩展成完整 relational graph；
- 将 SCD 当作一列的 provider；
- 以无限重试掩盖无法满足的约束。

### 4.2 Constraint 的最小分类

| Constraint / policy | 当前模型角色 | 当前范围 |
| --- | --- | --- |
| `NOT NULL` | hard database constraint | 参与 planning、generation gate 和 validation；NULL rule 冲突时 blocking |
| PK | hard database constraint，通常包含 uniqueness | 预留 key allocation/validation contract；不实现算法 |
| `UNIQUE` | hard database constraint | 参与 domain capacity 与 allocation planning；不实现重试引擎 |
| `CHECK` | hard database constraint | 保留表达式和 provenance；没有 evaluator 时显式 unsupported，不假装通过 |
| identity / auto increment | database-owned generation policy | 默认使用 `OMIT_IDENTITY`；不把数据库 identity expression 解析为 plugin value |
| semantic group consistency | user/semantic policy | 由 group contract 提供 membership，由本层规划/验证；具体 Person 规则在 #13 |
| FK | future relation constraint | 只保留扩展点；完整 relation planner 在 #15/future，不在本 Issue 定义 |

### 4.3 Planning、Generation、Validation 三阶段

Constraint 不是简单的 `generate → validate`，而是三个可观察阶段：

| 阶段 | 作用 | 典型结果 |
| --- | --- | --- |
| **Planning** | 在有值之前检查规则组合、domain capacity、生成顺序、database-owned columns 和可用能力 | `UNIQUE` 需要 allocation；`NOT NULL` 禁止 NULL；未知 CHECK evaluator 产生 unsupported；冲突直接阻止 executable plan |
| **Generation** | 按已冻结 strategy 产生或分配值；跨字段规则只能使用已规划的 group/context | UNIQUE allocator、identity placeholder、Person consistency strategy（未来）等；失败必须返回有限结果 |
| **Validation** | 对生成结果做独立确认，不把“provider 返回了值”当成约束成功 | `NOT NULL`、UNIQUE、CHECK、group consistency violation；返回 error/warning/unsupported report |

Validation 不是补救性静默修正。若 generation result 违反 hard constraint，结果必须标记为失败或不可导出；不能先生成一堆错误值，再把失败隐藏为成功。

### 4.4 失败与有限策略

- 计划阶段能证明不可满足时，直接产生 `constraint_conflict` 或 `generation_impossible`；
- 只有在 plan 明确允许的有限 allocation strategy 内尝试候选值；
- 达到有限尝试上限后返回 diagnostic，不进入无限循环；
- 不支持的 constraint evaluator 标为 `unsupported`，不能标为“没有这个 constraint”；
- hard constraint metadata 本身 unknown 时，不能宣称输出是 constraint-valid；
- 任何未来的 “allow invalid test data” 模式都必须是显式产品选择，不属于当前 baseline，也不能通过默认 fallback 隐含启用。

## 5. GenerationPlan

### 5.1 Plan 的定位

`GenerationPlan` 是以下内容在 Generator 执行前的冻结结果：

```text
normalized schema metadata
+ schema interpretation
+ user choices
+ semantic mappings/groups
+ generation rules
+ constraint knowledge
+ dataset settings
+ diagnostics
```

它必须能够在不执行 Generator、不连接数据库、不调用 provider 的情况下被 inspect。每次用户修改 seed、mapping、rule、row count 或 group setting，都产生新的 plan revision，而不是在旧 plan 上偷偷变更运行时状态。

### 5.2 Conceptual / Internal Draft model

下列 TypeScript-like 代码只用于说明职责。它明确是 **Conceptual / Internal Draft — Not DBX SDK Contract — Not wire format**：

```ts
// Conceptual / Internal Draft
// Not DBX SDK Contract; not wire format.

type FactState =
  | "value"
  | "absent"
  | "not_applicable"
  | "unavailable"
  | "unsupported"
  | "failed";

type Fact<T> = {
  state: FactState;
  value?: T;
  source?: string;
  diagnosticId?: string;
};

type SemanticType =
  | "name" | "full_name" | "mobile" | "phone" | "email"
  | "id_card" | "cert_no" | "gender" | "birthday" | "address"
  | "account_no" | "customer_id" | "amount" | "currency"
  | string;

interface Evidence {
  source: string;
  observation: string;
  value?: unknown;
  explanation: string;
}

interface Diagnostic {
  id: string;
  kind: "info" | "warning" | "error" | "unsupported";
  code: string;
  scope: string;
  message: string;
  blocking: boolean;
}

interface ColumnSchema {
  columnIdentity: string;
  name: string;
  databaseType: Fact<string>;
  typeFamily: Fact<"integer" | "decimal" | "varchar" | "boolean" | "date" | "timestamp" | "enum_like" | "other">;
  length: Fact<number>;
  precision: Fact<number>;
  scale: Fact<number>;
  nullable: Fact<boolean>;
  defaultFact: Fact<{
    kind: "literal" | "expression";
    text: string;
  }>;
  identityFact: Fact<{
    kind: "identity" | "auto_increment" | "generated";
  }>;
  enumValues: Fact<string[]>;
  constraintRefs: string[];
}

interface SemanticCandidate {
  type: SemanticType | "unknown";
  confidence: "high" | "medium" | "low" | "unknown";
  evidence: Evidence[];
  status: "proposed" | "needs_confirmation" | "selected" | "rejected" | "conflicted" | "unknown";
  source: "automatic" | "user_confirmed" | "user_explicit" | "fallback";
}

interface GenerationRule {
  ruleIdentity: string;
  kind: string;
  parameters: Record<string, unknown>;
  source: "schema_fallback" | "automatic_semantic" | "user_confirmed_semantic" | "explicit_user_rule";
  intent: "GENERATE_VALUE" | "GENERATE_NULL" | "OMIT_USE_DEFAULT" | "OMIT_IDENTITY" | "UNSUPPORTED";
}

interface ConstraintRule {
  constraintIdentity: string;
  kind: "NOT_NULL" | "PRIMARY_KEY" | "UNIQUE" | "CHECK" | "IDENTITY" | "FK" | "SEMANTIC_CONSISTENCY";
  hardness: "database_hard" | "semantic_policy" | "future_relation";
  stages: Array<"planning" | "generation" | "validation">;
  parameters: Record<string, unknown>;
  support: "supported" | "partial" | "unknown" | "unsupported";
}

interface ColumnPlan {
  schemaFacts: ColumnSchema;
  semanticCandidates: SemanticCandidate[];
  selectedSemantic?: SemanticCandidate;
  generationRule: GenerationRule;
  constraints: ConstraintRule[];
  diagnostics: Diagnostic[];
}

interface SemanticGroupPlan {
  groupIdentity: string;
  kind: "Person" | string;
  status: "proposed" | "confirmed" | "disabled" | "unsupported";
  members: Array<{ columnIdentity: string; role: string; evidence: Evidence[] }>;
  diagnostics: Diagnostic[];
}

interface GenerationPlan {
  planVersion: string;
  planRevision: string;
  dataset: {
    datasetSeed: string;
    tableIdentity: string;
    rowCount: number;
    determinismProfile: string;
  };
  columns: ColumnPlan[];
  semanticGroups: SemanticGroupPlan[];
  constraints: ConstraintRule[];
  diagnostics: Diagnostic[];
  status: "ready" | "ready_with_warnings" | "blocked";
}
```

上面没有定义任何 provider、RPC、数据库连接或 Host DTO。`parameters` 也不是鼓励任意动态对象；正式实现应为每种 rule/constraint 建立经过验证的内部 schema，并保留 unknown/unsupported 状态。

### 5.3 Plan 必须可 inspect 的内容

Workbench 或其它未来 consumer 至少可以从 plan 展示：

```text
Detected:
  database type、长度/精度/scale、nullable/default/identity facts

Generator:
  当前采用的 schema fallback / semantic / explicit rule

Rules:
  null policy、domain bounds、semantic/group selection、constraint obligations

Evidence:
  automatic candidate 的 confidence、证据和来源

Warnings / Errors:
  low confidence、unknown、unsupported、override conflict、generation impossible

Execution intent:
  generate value / NULL / omit for default / omit for identity
```

Plan 可以是 blocked，但 blocked plan 仍然应该能被 inspect，便于用户知道需要修正什么。Plan 不应包含不可审计的 closure、随机状态对象或数据库连接句柄。

## 6. Override Precedence

### 6.1 两条独立轴线

必须区分：

1. **Rule selection precedence**：选择哪个生成规则；
2. **Hard-constraint feasibility**：选择完成后是否仍满足数据库硬约束。

冻结的 rule selection 顺序是：

```text
Explicit User Rule
        ↓
User-confirmed Semantic Mapping / Group choice
        ↓
Automatic Semantic Inference
        ↓
Schema-type Fallback
```

hard database constraints 不作为这个列表中的一个“可覆盖来源”。它们在所有来源之后检查可行性，因此用户 rule 不能删除、隐藏或降级 hard constraint。

### 6.2 各层语义

| 来源 | 可以决定什么 | 不能决定什么 |
| --- | --- | --- |
| Explicit User Rule | 当前列采用何种 rule、参数、NULL/default preference 或 group enable/disable | 不能让 `NOT NULL` 接受 NULL，不能让 UNIQUE 失效，不能把不可表示的值伪装成合法值 |
| User-confirmed Semantic Mapping | 确认 `email`、`birthday`、`id_card` 等 semantic interpretation，或确认 group membership | 不能改写 database type bounds；跨字段 correctness 仍由 Consistency Layer 检查 |
| Automatic Semantic Inference | 在 evidence 支持时提出或有限地选择 candidate | 不能静默升级敏感语义、validator-compatible 保证或跨字段 consistency |
| Schema-type Fallback | 提供最保守的单列 domain | 不能声称拥有业务语义、唯一性或跨字段一致性 |

用户的 locale、range、null probability 等属于 preference；database facts 属于 interpretation input；`NOT NULL`、UNIQUE、PK、CHECK 等属于 hard constraints。三者不能用同一字段或同一优先级混淆。

### 6.3 必须满足的冲突行为

#### `varchar(18)` + `id_card` + user `random_string`

显式 user rule 最高。Plan 应：

- 采用 user 的 random-string-like rule（名称仅为概念示例，不冻结 provider）；
- 仍保留 length ≤ 18 的 Column constraint；
- 保留自动 `id_card` candidate 作为被覆盖 evidence；
- 不再声称该列具有 `id_card` 语义；
- 若 user rule 与 length/domain 冲突，产生 blocking diagnostic，而不是静默截断。

#### `birthday DATE` + inferred `birthday` + user disables `Person`

关闭 group 是显式 group override。Plan 应：

- `Person` group 标记为 `disabled`；
- 不应用 birthday ↔ id_card、gender ↔ id_card 等 group consistency；
- 若没有其它 explicit column rule，`birthday` 仍可作为单列 semantic 或回到 date fallback；
- 不因为 group 被关闭而删除原 inference evidence；
- 不自动重新启用 group。

#### `NOT NULL` + user `always null`

显式 rule 仍被记录为 user intent，但 hard constraint 优先于可行性：

- `intent = GENERATE_NULL`；
- `NOT NULL` 产生 `constraint_conflict`，severity 为 error，`blocking = true`；
- plan 可以 inspect，但不能执行或导出为“成功数据”；
- 不自动改成随机值、不自动改成 omit、不进行无限重试。

## 7. Deterministic Seed Model

### 7.1 冻结的稳定性目标

对于 plugin-owned、可物化的值，冻结以下目标：

```text
same schema facts
+ same GenerationPlan
+ same dataset seed
+ same logical row identity
= same logical generated value
```

因此：

```text
Preview(plan P, seed S)
Export CSV(plan P, seed S)
Export JSON(plan P, seed S)
Export SQL(plan P, seed S)
```

应得到相同的逻辑值；格式化、转义、字段顺序和序列化差异不应改变值。数据库-owned default/identity 没有被 plugin 物化时不属于这个保证范围。

### 7.2 Seed 作用域

`GenerationPlan` 必须携带明确的 `datasetSeed`。如果用户没有手动填写 seed，Workbench/调用方可以生成一个 seed，但必须把它写入当前 plan；“每次运行时随机取一个新 seed”不能被称为 same-seed regenerate。

每个 logical value 的随机域概念上由以下 identity 组合派生：

```text
datasetSeed
+ tableIdentity
+ columnIdentity
+ rowIdentity
+ ruleIdentity
+ valueSlot
```

可以使用 domain-separated hash/counter-based RNG 或其它 random-access 方案；本 Issue 不冻结具体 hashing、RNG、序列化或字节编码算法。实现必须避免依赖“随机函数被调用了多少次”。

- `tableIdentity`：normalized table context 的稳定内部 identity；不含 credential；
- `columnIdentity`：稳定的 canonical column identity，优先使用明确 column name；
- `rowIdentity`：当前单表模型默认为稳定的 logical row ordinal，未来关系模型可替换为显式 logical key；
- `ruleIdentity`：当前列的 resolved rule/semantic slot；改变 mapping/rule 时只影响相关值流；
- `valueSlot`：同一列 rule 内不同值槽位的 domain separator。

`determinismProfile` / algorithm version 应进入 plan，使未来实现更换算法时可以显式说明兼容性，而不是假装跨实现版本永远 byte-for-byte 相同。

### 7.3 Regenerate 与 Plan change

| 动作 | 应变化的值 | 尽可能保持稳定的值 |
| --- | --- | --- |
| same seed + same plan regenerate | 不应变化 | 所有 plugin-owned logical values |
| new seed | seed 影响的 plugin-owned values 可全部变化 | schema facts、rule/evidence、database-owned intent |
| 增加 column | 新 column 的值流新增 | 已有 column 的值不因调用顺序变化而漂移 |
| 修改 semantic mapping | 被修改 column 及其显式依赖的 group values | 无依赖的其它 column |
| 修改 generation rule | 被修改 column 及受其影响的 consistency values | 无依赖的其它 column |
| 增加 row count | 新 row identities 对应新值 | 已有 row identities 的值 |
| 减少再恢复 row count | 被重新出现的旧 row identity 可恢复原值 | 不承诺连续的数据库 identity 值；database-owned fields 例外 |
| 仅修改 warning/evidence 展示 | 不应改变 | 所有 logical values |
| table/column identity 改名 | 允许相关值变化 | 不作跨 identity rename 的稳定承诺 |

“尽可能保持稳定”不承诺跨 schema identity、跨 determinism profile 或跨未来 relation planner 的绝对兼容。Semantic group 如果共享 group-level identity，受影响的成员必须作为依赖集合一起变化，而不是产生互相矛盾的旧值。

### 7.4 Preview / Export 边界

Preview 和 Export 必须消费同一个冻结 plan 与 seed snapshot，不各自维护隐式 RNG cursor。未来 Exporter 不应重新调用“下一个随机值”来生成 CSV/JSON/SQL 的另一份数据。

对 `OMIT_USE_DEFAULT` / `OMIT_IDENTITY` 的列，Preview 可以显示 database-owned / not materialized 状态；它不能为了让表格看起来完整而模拟 `now()`、sequence 或 vendor expression，并把模拟值宣称为导出值。

## 8. Nullable / Default / Identity Semantics

### 8.1 Internal intent

以下 intent 是 SchemaSeed 的内部计划语义，**不是 DBX Host wire protocol**：

```text
GENERATE_VALUE       plugin 按已选 rule 提供一个值
GENERATE_NULL        plugin 明确提供 NULL；只在 nullable 允许时可执行
OMIT_USE_DEFAULT     不提供该列，目标数据库有机会应用已知 default
OMIT_IDENTITY        不提供该列，目标数据库有机会生成 identity
UNSUPPORTED          当前无法形成安全、可验证的执行意图
```

不要使用一个含义不明的 `skip` 同时表示 NULL、default、identity 或 metadata failure。

### 8.2 行为矩阵

| Schema / user state | 默认计划行为 | 冲突行为 |
| --- | --- | --- |
| nullable column，无 default/identity | 可选择 `GENERATE_VALUE` 或按 policy 选择 `GENERATE_NULL` | 明确 `GENERATE_NULL` 仍需被记录为 policy，不可冒充 absent |
| NOT NULL column | `GENERATE_VALUE` 或 database-owned omit（若适用） | `GENERATE_NULL` 是 blocking conflict |
| 有 database default，未指定 user rule | database-targeted plan 优先 `OMIT_USE_DEFAULT`；不执行 expression | 若目标格式不支持 omission，返回 unsupported，而不是模拟 default |
| 有 identity/auto increment，未指定 user rule | `OMIT_IDENTITY` | 显式 plugin value 若违反 identity policy，产生 conflict/unsupported；不强制覆盖数据库策略 |
| user 明确 `GENERATE_VALUE` | 采用 user rule，但仍检查 type/constraint | 不能让 rule 忽略 NOT NULL、UNIQUE、CHECK 或 identity hard fact |
| user 明确 `GENERATE_NULL` | 只有 nullable=true 时可执行 | nullable unknown/false 时阻塞或 unsupported，不静默放行 |
| default/identity fact unknown | 不猜测为 absent，也不猜测为 present | 需要该语义才能安全执行时标记 unsupported |

### 8.3 Default expression 不等于 plugin execution

例如：

```sql
created_at TIMESTAMP DEFAULT now()
```

SchemaSeed 的 plan 应保存：

```text
Default fact: expression text "now()"
Generation intent: OMIT_USE_DEFAULT
```

它不应：

- 解析 `now()` 并在 plugin 中执行；
- 把本地时间当作数据库时间；
- 把 `nextval(...)`、`uuid_generate_v4()` 等 expression 变成假想的普通 provider；
- 在 Preview 中生成一个看似真实的值，再声称 SQL/DB 执行会相同。

`OMIT_USE_DEFAULT` 只表达“将 default ownership 留给目标数据库”。具体 SQL omission、CSV/JSON 无法表达 omission 的处理属于未来 Exporter contract；如果目标不能保留该语义，必须返回 unsupported 或要求用户显式选择另一个 rule。

### 8.4 Identity 与普通整数的差异

Identity 列可能在 database write 时由数据库分配，也可能有 database-specific insert policy。SchemaSeed 不把 identity 自动降级为普通整数列，也不保证导出到所有格式后仍能复现 database-generated sequence。当前默认是 `OMIT_IDENTITY`；真正的 identity-compatible export 属于后续 capability。

## 9. Diagnostics

### 9.1 最小模型

```text
Diagnostic
  id
  kind: info | warning | error | unsupported
  code
  scope: dataset | column | semantic_group | constraint | execution
  message
  evidenceRefs[]
  blocking: true | false
  relatedChoice / suggestedAction（可选）
```

`kind` 与 `blocking` 分开：unsupported 不一定等于 error，但如果该能力是当前目标执行的必要条件，它可以是 `blocking = true`。所有 diagnostics 都必须能定位到 plan 中的事实、选择或 constraint。

### 9.2 典型 code 与行为

| 情况 | kind | 默认 blocking | 行为 |
| --- | --- | --- | --- |
| low-confidence semantic | `warning` | false | 使用 fallback，要求用户确认后才升级 semantic |
| unknown semantic | `info` 或 `warning` | false（有安全 fallback 时） | 保留 unknown；不伪造 semantic |
| invalid override | `error` | true | 保留用户选择并显示冲突；不自动换 rule |
| constraint conflict | `error` | true | plan 可 inspect，不可执行为成功数据 |
| unsupported metadata capability | `unsupported` | 取决于目标 capability | 不把 unsupported 当 absent；需要时阻止 execution |
| driver-specific absence | `info` 或 `warning` | false（若不影响目标） | 保留 unavailable/not_applicable provenance |
| generation impossible | `error` | true | 计划失败，不进入无限重试 |
| CHECK evaluator unavailable | `unsupported` | 对 validity/export 通常为 true | 不能宣称 CHECK-compatible；未来可由显式产品模式决定 |
| database-owned default not materialized | `info` 或 `unsupported` | 取决于 target format | 显示 omit/default ownership，不模拟 expression |
| metadata acquisition failure | `error` 或 `unsupported` | true | 不把失败当成空 schema 或零值 |

Unknown semantic 不是 error 本身；unsupported capability 也不是 false。是否 blocking 取决于它是否阻止当前目标的正确性承诺。

### 9.3 Plan 状态

最小 plan status：

```text
ready                 没有 blocking diagnostic
ready_with_warnings   可以按明确范围执行，但带有非 blocking warning/unsupported
blocked               至少一个 blocking diagnostic，必须先修正或降低目标承诺
```

`blocked` 不等于没有 plan；Workbench 可以展示 blocked plan 的 facts、rule、evidence 和修复动作。没有 Generator 实现时，本 Issue 只冻结状态语义，不实现状态机。

## 10. Unsupported / Unknown / Driver Differences

SchemaSeed 的 normalized adapter 必须保留 driver provenance，但 Generation Model 不把某个 driver 的内部字段当成所有 driver 都有的事实：

- PostgreSQL/MySQL 有结构化 numeric/length 信息时可以形成 bounded domain；
- SQLite 或其它 driver 没有结构化字段时，type text 可以是 evidence，但不能伪造 numeric bound；
- database/schema 维度不适用时是 `not_applicable`，不是空字符串；
- host capability 未提供时是 `unsupported`，不是“数据库没有这个 metadata”；
- 本次调用失败是 `failed`，不是 `absent`；
- `CHECK` expression 原文存在不等于 SchemaSeed 已有安全 evaluator。

当 Column Layer 仍能形成保守的 type fallback 时，可以继续形成 `ready_with_warnings`；当缺失事实会影响 hard constraint 或 output correctness 时，plan 必须 blocked。降级必须在 plan 中可见，不能通过默认值把问题隐藏。

## 11. AI Boundary

Baseline 固定为：

```text
offline
deterministic
no AI
no external service
no database write
no credential access
```

未来如果提供 AI，它最多是一个可选的 `semantic suggestion provider`：

```text
candidate + evidence + source = ai_suggested
```

它必须：

- 进入与 deterministic inference 相同的 candidate/confirmation pipeline；
- 不能直接改写 database hard constraints；
- 不能自动把 suggestion 变成 confirmed mapping；
- 不能成为 `GenerationPlan` 的必需输入；
- AI 不可用时，plan 必须仍能使用 schema fallback 或显式 unsupported 运行；
- 若要保证复现，执行 plan 必须保存最终用户选择，而不是保存一次 LLM 输出作为隐式依赖。

## 12. Future Extension Boundaries

### 12.1 Single-table constraints

Issue #37 implements explicit SchemaSeed generation constraints for `unique`, `composite_unique` and `required_unique`; their NULL, provenance, capacity, allocation and validation rules live only in [MANUAL_CONSTRAINTS.md](MANUAL_CONSTRAINTS.md). These manual obligations are separate from database-reported constraint facts. Automatic PK / UNIQUE / CHECK / identity discovery and database-hard-constraint evaluation remain future capabilities; the Host API metadata boundary is unchanged.

### 12.2 Relational Dataset / FK

FK 不应隐藏在单列 `customer_id` provider 中。未来需要独立的 relational dataset model 来表达：

- parent/child dataset identity；
- FK mapping 和 cardinality；
- parent-first planning；
- orphan strategy；
- composite FK；
- relationship-specific deterministic identity。

本 Issue 只允许 `FK` 作为 future constraint kind / diagnostic scope，不设计完整 graph、DAG 或 Relation Planner。

### 12.3 Temporal Dataset / SCD

SCD / 拉链表是 `Temporal Dataset / State Transition`，不是 Column Generator：

```text
business entity
  → ordered versions
  → effective start/end
  → current-row policy
  → state transition
```

它需要 entity identity、version ordering、区间不重叠、current uniqueness 和属性变化规则。`start_date`、`end_date` 的 DATE type 仍可由 Column Layer 处理，但 SCD 的跨行状态不能塞进 DATE provider。该范围属于 #15/future，不属于 v0.1 或本 Issue。

### 12.4 与其它 Phase 1 design Issue 的边界

- **#13 Sensitive Synthetic Data**：已冻结 Person 的 Safe Synthetic / Validator-Compatible 边界与最小 consistency contract；Phase 1B 实现见 #19。身份证 checksum 算法仍后置；#12 只定义 group contract 和层间接口。
- **#14 Workbench UX**：消费本模型的 inspectable plan、confidence/evidence、diagnostics 和 Preview/Export 一致性；#12 不定义 UI。
- **#15 Future Constraints**：定义 relational/temporal 的后续产品和实现前置；#12 不提前实现 FK graph 或 SCD。

## 13. Worked Examples

以下示例中的 rule 名称、参数和 plan 片段都是概念示例，不是 provider API、DBX SDK type 或 wire format。

### Example A — `amount DECIMAL(18,2) NOT NULL`

#### Schema facts

```text
databaseType: DECIMAL
precision: value(18)
scale: value(2)
nullable: value(false)
default: absent
identity: absent
constraints: NOT_NULL
column name: amount
```

Column Layer 的结论：

```text
base domain: decimal
integer digits: at most 16
fraction digits: at most 2 according to the resolved rule
null branch: forbidden
```

#### Semantic candidate

```text
type: amount
confidence: high
evidence:
  - column name contains "amount"
  - decimal precision/scale are compatible with a monetary-like value
status: selected (automatic, low-risk scalar)
```

这只是低风险 scalar interpretation。它不自动创建 `currency`，不推断业务金额范围，也不承诺会计规则；这些需要用户 rule 或未来 domain policy。

#### Generation rule

```text
source: automatic_semantic (amount)
rule: decimal-domain-with-scale
parameters: precision=18, scale=2
intent: GENERATE_VALUE
```

#### Constraint 与 plan

```text
NOT_NULL:
  planning: null policy must be disabled
  generation: allocate a non-null decimal value
  validation: reject a null result

plan status: ready
blocking diagnostics: none
```

Generator 仍未在本 Issue 实现；本例只证明 type domain、semantic candidate 和 hard constraint 可以同时被 inspect。

### Example B — `cert_no VARCHAR(18)`

#### Evidence

```text
column name: cert_no
schema type: VARCHAR
length: value(18)
```

可能的 candidate：

```text
type: id_card
confidence: medium
evidence:
  - column name contains "cert"
  - VARCHAR length = 18
status: needs_confirmation
```

`VARCHAR(18)` 不是 `Chinese ID Card` 的结论。`cert_no` 也可能是其它证书编号；长度只是 evidence，不是 proof。

#### 未确认时的 plan

```text
selected semantic: none
fallback rule: bounded string, max length 18
constraint: type length <= 18
warning: semantic candidate requires confirmation
plan status: ready_with_warnings
```

此时不能执行身份证格式、gender 位、birthday 或 checksum 语义。用户确认 `id_card` 后，Semantic Layer 才能把 mapping 设为 `user_confirmed`；具体 Safe Synthetic/Validator-Compatible 行为仍由 #13 定义。

### Example C — `customer_id BIGINT NOT NULL UNIQUE` + `constant = 1`

假设 dataset `rowCount = 10`，用户显式选择：

```text
column: customer_id
rule: constant(1)
```

#### Schema facts 与 precedence

```text
BIGINT domain: valid integer type
NOT NULL: hard constraint
UNIQUE: hard constraint
rule source: explicit_user_rule (highest rule precedence)
```

#### Planning 结果

```text
explicit rule: constant 1
NOT NULL: satisfied in principle
UNIQUE: impossible for 10 rows

Diagnostic:
  kind: error
  code: constraint_conflict
  scope: column/customer_id
  blocking: true

plan status: blocked
```

系统不能先生成十个 `1`，再把 validation 失败藏起来，也不能无限重新生成，因为用户明确要求 constant。用户必须修改 rule、row count 或约束目标；hard UNIQUE 不会被 override。

### Example D — `created_at TIMESTAMP DEFAULT now()`

#### Schema facts

```text
databaseType: TIMESTAMP
nullable: value(false) or the normalized fact supplied by Host
defaultFact:
  state: value
  kind: expression
  text: "now()"
identity: absent
```

#### Plan

```text
generation intent: OMIT_USE_DEFAULT
plugin-owned value: not materialized
```

SchemaSeed 不在 model 层模拟 `now()`。对 database-targeted output，未来 consumer 可以省略该列，让目标数据库决定值；对 Preview/CSV/JSON，目标格式如果不能表达 omission，必须显示 database-owned/unsupported 状态或要求用户显式选择一个 plugin rule。不能把本地生成的 timestamp 当成 database default 的等价实现。

### Example E — `birthday DATE` 与关闭 Person group

```text
column: birthday
candidate semantic: birthday, confidence=high
user choice: disable Person group
```

结果：

```text
Person group: disabled
birthday scalar semantic: may remain selected, if its date domain is valid
birthday ↔ id_card / gender: not planned
info diagnostic: group consistency disabled by user
```

这不会自动生成身份证，也不会因为用户关闭 group 而伪造“Person consistency 已满足”。

## 14. Open Questions / To Be Validated

以下问题不改变本 Issue 已冻结的层次、precedence、intent 或诊断原则，留给实现和上游 contract 确认：

1. #30 已实现 Host API 1.3 `getTableMetadata` 到 normalized facts 的 adapter 与 MySQL / PostgreSQL / SQLite contract tests；DBX v0.6.23 已正式包含 upstream #10244；在其上完成 Workbench runtime smoke 由 #31 人工验证（pending）；
2. deterministic hash/RNG 算法、canonical identity 编码和 `determinismProfile` 的兼容策略；
3. 不同 database identifier case/collation 下 `columnIdentity` 的规范化细节；
4. 各种 target format 对 `OMIT_USE_DEFAULT` / `OMIT_IDENTITY` 的具体表示；
5. #13 已冻结 Person group 的 Safe Synthetic 与 Validator-Compatible 边界；中国身份证 checksum / validator-specific 算法仍需未来专门 Issue 定义；
6. #15 对 PK/UNIQUE/CHECK evaluator、FK relation 和 Temporal/SCD 的后续实现前置；
7. #31 production Workbench UI / package implementation is ready; DBX v0.6.23 is the first official release containing #10244, so the manifest DBX floor is now `>=0.6.23`. Runtime smoke remains pending manual execution on that release.

这些是实现边界和跨 Issue 协调项，不允许通过猜测 DBX 当前未冻结的 DTO 来提前解决。

## 15. Dependency on DBX Schema Metadata (#9917 / #10043)

### Current upstream facts

- `t8y2/dbx#9917` 是已解决的原始 Schema Metadata Host API issue；正式实现由 `t8y2/dbx#10043` 提供并已 merge，commit `d5a05a98840e54726bfec0c7dadabb8dc9a4c755`。
- Host API 1.3 contract 已公开：`host.schema:read`、`schemaMetadataApi`、`window.dbxPlugin.getTableMetadata({ connectionId, database?, schema?, table })`。
- 本 Generation Model 不复制 Host DTO 为内部 schema model；Phase 0 Probe 与 production `DbxHostSchemaMetadataProvider` 是职责分离的 consumer 和 adapter。
- production adapter / Core contract path 已由 #30 实现；Phase 0 #6 已关闭。#31 已实现正式 Workbench、manifest direct-action contribution、context-refresh invalidation 与 `.dbxp` resources；DBX v0.6.23 是首个正式包含 #10244 的 release，manifest floor 已对齐 `>=0.6.23`，runtime smoke 仍 pending manual execution。production table context-menu 现只保留 `generate-test-data` 正式入口。该产品入口不改变纯 fixture-driven Core 的既有范围。

### SchemaSeed dependency boundary

Phase 1A 及 fixture-only Phase 1B 可独立执行以下本地链路：

```text
repository fixture
        ↓
SchemaSeed TableSchema
        ↓
Schema Interpretation / Semantic Mapping
        ↓
GenerationPlan / GenerationEngine / Preview
```

它不读取真实 metadata、不连接 DBX，也不依赖 #10043 的 merge。fixture provider 不是 production metadata source。Host API 1.3 availability and the consumer probe are formal metadata integration prerequisites, not fixture-driven Semantic / Person generation prerequisites.

正式 Host integration 沿以下 path 进入 Generation Model；#30 已实现前两个箭头，Core 只消费 normalized facts：

```text
DBX Host API 1.3 metadata DTO
        ↓
DbxHostSchemaMetadataProvider (#30)
        ↓
SchemaSeed TableSchema / normalized schema facts
        ↓
Generation Model
```

SchemaSeed 不因本文获得以下权限或能力：

- 不调用任何尚未正式公开的 metadata method；
- 不把上游 proposal 的 permission 或 API version 写入 manifest；
- 不依赖某个当前 wire nesting 或 DTO 字段命名；
- 不读取 private Store、Credential、private Tauri/frontend API；
- 不建立第二套数据库连接；
- 不执行数据库系统表 workaround。

### Phase 0 gate

已完成与仍待验证的边界如下：

1. DBX v0.6.21 已包含 Host API 1.3；#28 已对 MySQL / SQLite / PostgreSQL 完成真实 metadata Probe smoke；
2. #5 的公开 consumer path、metadata contract 与错误模型已由 PR #28 验证；
3. SchemaSeed #6 Phase 0 Gate 已由合并 PR #33 关闭；#30 production adapter 与 Core contract path 已实现；
4. Upstream #10244 已 merge 并随 DBX v0.6.23 正式发布，正式 Workbench 接收 direct TableContext 并实现 context refresh；manifest floor 已对齐 `>=0.6.23`，安装 smoke 仍 pending manual execution。Table Context 证据不替代 Metadata capability。

如果 metadata Host API 未满足，不得通过 workaround 开始真实 metadata acquisition 或 metadata-backed generation。Phase 1A 的 fixture-only Generation Core 是独立实现范围，不宣称 Phase 0 已通过，也不改变未来 Host integration gate。

## Issue #12 Acceptance Checklist

- [x] 明确 Column Generator、Semantic Generator、Consistency / Constraint Layer 的输入、输出、责任和禁止越界事项。
- [x] 明确 schema type 与 semantic type 的区别，并定义 inference confidence、evidence、unknown 和失败 / 降级策略。
- [x] 完成 deterministic seed 的作用域、Preview / Regenerate / Export 预期和 plan 变化稳定性设计。
- [x] 完成 nullable、default、identity / auto increment 与生成 / NULL / omit 行为的设计。
- [x] 完成 user override、confirmed mapping、automatic inference、schema fallback 的 precedence，并保留 hard constraint conflict 的可解释性。
- [x] 形成 `ColumnSchema`、`GenerationRule`、`SemanticType`、`ConstraintRule`、`GenerationPlan` 等概念说明，并明确不是 DBX SDK/wire contract。
- [x] 明确不依赖 AI 的 deterministic baseline，以及 unknown/unsupported/invalid/generation-impossible 的 diagnostics 形态。
- [x] 明确原始 Issue #9917、已合并 PR #10043、Metadata Consumer Probe、Phase 0 Gate 的依赖边界，没有通过 workaround 绕过 upstream。

本 checklist 只表示 Issue #12 的设计交付完成；它本身不证明 Phase 0 Gate、Generator 实现或 DBX upstream 状态。当前 Phase 0 #6 已由 PR #33 关闭，Generation Core 已由 Phase 1 实现，production metadata adapter 由 #30 交付。
