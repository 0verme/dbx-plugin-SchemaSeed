# SchemaSeed Host API Requirements

**Status: Draft — consumer-side contract only**

本文件描述 SchemaSeed 的最小消费需求草案，不代表 DBX 已接受或已经实现该 API。最终的 API 命名、namespace、数据结构、版本策略和错误模型，必须以 DBX 上游真实实现为准。

## Design principles

- SchemaSeed 只消费正式、公开、稳定的 Plugin Host API。
- SchemaSeed 不获取数据库连接凭据，也不自行建立第二套连接系统。
- Contract 只覆盖 Phase 0 需要验证的最小能力，不提前冻结大而全的 Host API。

## Table Context

Consumer-side sketch：

```ts
interface TableContext {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
}
```

SchemaSeed 不需要也不应该获取：

```text
host
port
username
password
credential
connectionString
```

## Table Metadata

目标方向（占位调用形状，不是已确认的 DBX API）：

```text
host.metadata.getTable(...)
```

返回 DB-neutral metadata 的消费模型草案：

```ts
interface TableMetadata {
  columns: ColumnMetadata[];
  primaryKey?: PrimaryKey;
  foreignKeys?: ForeignKey[];
  uniqueConstraints?: UniqueConstraint[];
  checkConstraints?: CheckConstraint[];
  indexes?: Index[];
}
```

v0.1 至少需要 `columns` 中能够表达：

- column name
- data type
- nullable
- length
- precision
- scale
- default

`PrimaryKey`、`ForeignKey`、`UniqueConstraint`、`CheckConstraint` 和 `Index` 在此阶段只作为需求名称，不预设 DBX 的 wire shape 或 API 结构。

## Contract decisions pending audit

以下决策必须根据 DBX 上游真实能力确定：

- API 命名
- namespace
- Table Context 的生命周期与来源
- Metadata 返回结构及 DB-neutral 映射
- PostgreSQL / MySQL / SQLite 的能力差异
- API 版本策略与兼容性承诺
- 错误模型
- 缺失能力的表达方式

## Non-goals

本草案不定义 Generator、Faker、Semantic Inference、Constraint Engine、Relation Planner、Exporter、数据库系统表 workaround 或 Direct Insert。
