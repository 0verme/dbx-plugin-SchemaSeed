# DBX Host API Audit

本文件是 Phase 0 的源码级审计模板。当前只建立审计维度，尚未完成 DBX 源码审计；`TBD` 不代表能力存在。

## Baseline

- DBX repository:
- audited commit:
- audit date:

## Table Context

| Capability | Public Plugin API | DBX Internal | Evidence | Status |
|---|---|---|---|---|
| `connectionId` | TBD | TBD | | |
| `database` | TBD | TBD | | |
| `schema` | TBD | TBD | | |
| `table` | TBD | TBD | | |
| table context menu | TBD | TBD | | |

需要沿以下调用链确认正式能力，而不是仅凭 DBX 内部数据结构推断：

```text
Object Browser → Table Node → Context Menu → Plugin Invocation → Plugin Context Payload
```

## Schema Metadata

| Capability | Public Host API | DBX Internal | PostgreSQL | MySQL | SQLite | v0.1 Required |
|---|---|---|---|---|---|---|
| `columns` | TBD | TBD | TBD | TBD | TBD | YES |
| data type | TBD | TBD | TBD | TBD | TBD | YES |
| `nullable` | TBD | TBD | TBD | TBD | TBD | YES |
| `length` | TBD | TBD | TBD | TBD | TBD | YES |
| `precision` | TBD | TBD | TBD | TBD | TBD | YES |
| `scale` | TBD | TBD | TBD | TBD | TBD | YES |
| `default` | TBD | TBD | TBD | TBD | TBD | YES |
| `comment` | TBD | TBD | TBD | TBD | TBD | NO |
| primary key | TBD | TBD | TBD | TBD | TBD | NO |
| foreign key | TBD | TBD | TBD | TBD | TBD | NO |
| unique | TBD | TBD | TBD | TBD | TBD | NO |
| check | TBD | TBD | TBD | TBD | TBD | NO |
| identity / auto increment | TBD | TBD | TBD | TBD | TBD | NO |

## Classification

每项最终只能分类为：

- **A. Public API 已正式支持**
- **B. DBX 内部已有，但 Plugin Host API 未暴露**
- **C. DBX 当前没有合适抽象**

B / C 均视为 Host API Gap。

内部实现能够读取某项数据，不等于插件已经获得正式支持；审计必须提供 DBX 仓库、commit、文件路径、符号或 API 文档等可复核证据。

## Audit constraints

- 只审计公开 Plugin Host API 与 DBX 源码证据。
- 不读取 DBX 私有 Store。
- 不读取 DBX Credential 文件。
- 不调用未公开前端模块。
- 不为了拿 Metadata 建立第二套数据库连接体系。
- 本文件完成前不对 `Schema Acquisition Path` 做结论。
