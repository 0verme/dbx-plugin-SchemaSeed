# SchemaSeed Roadmap

> 本文件只同步本任务真实进度，不提前关闭 Phase 0，也不把 DBX 未公开 API 写成已实现事实。

## Phase 0 — Feasibility / Host API

### 目标

确认 DBX 能通过正式插件协议提供：

- Table Context
- Schema Metadata

### 当前状态

```text
Table Context:
  source audit: VERIFIED (#9918, latest t8y2/dbx origin/main)
  consumer probe: IMPLEMENTED
  real DBX manual smoke: PENDING USER VERIFICATION

Schema Metadata:
  WAITING_UPSTREAM_9917

Overall Phase 0:
  NOT_CLOSED
```

### Table Context path

```text
DBX Sidebar Table Node
  → `context-menu` + `menu: "table"`
  → `contextMenu/io.github.0verme.schema-seed.table-context-probe`
  → SchemaSeed JSONL backend
  → TableContext adapter
  → native DBX toast
```

The adapter is the only boundary that reads the DBX raw table payload. SchemaSeed's internal consumer shape is intentionally separate from the DBX wire shape.

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

当前不是 `READY`：Table Context 仍需 Windows DBX 手工验证，Schema Metadata 等待 `t8y2/dbx#9917`。

### 禁止事项

- 读取 DBX private Store
- 读取 Credential 文件
- 调用 private frontend module
- 为获取 Metadata 建立第二套数据库连接系统
- 执行数据库 introspection workaround
- 实现 Generator、Faker、Constraint Engine、Relation Planner 或 Exporter
- 修改 `t8y2/dbx`

## 后续版本规划

等待 `t8y2/dbx#9917` merge 后，单独设计 Metadata Host API consumer；本任务不提前消费或猜测其 method、permission、SDK type 或 wire shape。
