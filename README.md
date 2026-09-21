# SchemaSeed

Schema-aware test data generator for DBX.

SchemaSeed reads database schema, constraints and column semantics
to generate reproducible synthetic test data without copying real
business rows.

SchemaSeed 是一款 DBX 测试数据生成插件。

它读取数据库表结构、约束和字段语义，在不复制真实业务数据的情况下，
生成可复现的合成测试数据，并逐步支持主外键关系一致的多表数据集。

**Status: Phase 0 — DBX Host API Feasibility**

当前阶段只验证 DBX 正式、公开、稳定的 Plugin Host API 是否能够提供
Table Context 和 Schema Metadata。尚未实现数据生成器或正式 Workbench 功能。

## Long-term direction

以下内容属于 roadmap，不代表当前已经可用：

- Schema-aware generation
- Deterministic seed
- Constraint-aware values
- Semantic inference
- Relational datasets
- SQL / CSV / JSON export
- Read-only by default

## Phase 0 documents

- [Roadmap](docs/ROADMAP.md)
- [Host API Audit](docs/HOST_API_AUDIT.md)
- [Host API Requirements](docs/HOST_API_REQUIREMENTS.md)
- [Phase 0 Feasibility Report](docs/PHASE0_FEASIBILITY_REPORT.md)

## Explicit boundaries

本轮不读取 DBX 私有 Store、Credential 文件或未公开前端模块，不维护第二套数据库连接体系，
也不修改 `t8y2/dbx`。只有在 Phase 0 Gate 明确后，才进入后续功能设计。
