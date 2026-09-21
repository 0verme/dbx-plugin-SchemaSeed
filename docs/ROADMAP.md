# SchemaSeed Roadmap

> 完整 roadmap 待从用户提供的原始文档同步。当前仓库只冻结 Phase 0 执行边界。

本文件目前不重建未提供的完整版本规划，避免在原始 roadmap 缺失时擅自改变产品方向。

## Phase 0 — Feasibility / Host API

### 目标

确认 DBX 能通过正式插件协议提供：

- Table Context
- Schema Metadata

### 审计范围

- `connectionId`
- `database`
- `schema`
- `table`
- `columns`
- `type`
- `nullable`
- `length`
- `precision`
- `scale`
- `default`
- `comment`
- `primary key`
- `foreign key`
- `unique`
- `check`
- `identity / auto increment`

### Gate

必须明确：

```text
Schema Acquisition Path
```

最终状态只能是：

- `READY`
- `READY_WITH_FOLLOWUPS`
- `BLOCKED`

当前状态：`NOT_EVALUATED`。本阶段尚未进行 DBX 源码审计。

### 禁止事项

- 读取 DBX private Store
- 读取 Credential 文件
- 调用 private frontend module
- 为获取 Metadata 建立第二套数据库连接系统
- 实现 Generator、Faker、Constraint Engine、Relation Planner 或 Exporter
- 修改 `t8y2/dbx`

## 后续版本规划

待用户提供完整 roadmap 原文后同步，保持原始含义不变。
