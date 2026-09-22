# SchemaSeed

SchemaSeed 是一款 DBX 测试数据生成插件。

当前分支只实现 **Phase 0：Table Context Consumer Probe**，不实现 Generator、Faker、Constraint Engine、Metadata Provider 或正式 Workbench。

## 当前状态

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

## Probe architecture

```text
DBX Sidebar Table Node
  → native `context-menu` contribution (`menu: "table"`)
  → `contextMenu/io.github.0verme.schema-seed.table-context-probe`
  → JSONL sidecar
  → `normalizeTableContextPayload`
  → internal `TableContext`
  → native DBX toast with JSON
```

The adapter consumes only the #9918 payload:

```json
{
  "table": {
    "connectionId": "...",
    "database": "...",
    "schema": "...",
    "table": "..."
  }
}
```

`TableContext` is SchemaSeed's internal consumer contract. It is not a claim that DBX's wire payload has the same top-level shape. The probe is stateless, drops unknown fields, fails closed on missing required fields, and never reads credentials or metadata.

## Local verification

Node.js 22+ is used only for this lightweight probe sidecar and its tests:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run build` creates an unsigned `universal` `.dbxp` development candidate with the staged inputs declared in `dbx-plugin.toml`. The package uses the DBX-supported JSONL sidecar protocol and a small Unix/Windows launcher pair; the Windows launcher requires Node.js 22+ on the test machine. Enable DBX's **Allow unsigned development package** option before installing the candidate. The current DBX SDK CLI's native backend builder is Rust/Go-only, so this Node sidecar uses the repository-local deterministic packager instead of pretending to be a native backend build.

## Boundaries

- Depends on `t8y2/dbx#9918` table context only.
- Does not consume `host.schema.*`, `host.metadata.*`, `getColumns`, `describeTable`, or `getTableMetadata`.
- Does not execute `information_schema`, `pg_catalog`, `SHOW COLUMNS`, `SHOW CREATE TABLE`, or `PRAGMA table_info`.
- Does not open PostgreSQL, MySQL, or SQLite connections.
- Does not read DBX private Store, credentials, connection strings, private frontend modules, private Tauri commands, or undocumented APIs.
- Metadata remains `WAITING_UPSTREAM_9917`; if #9917 becomes available during this work, this PR still does not consume it.

## Long-term direction

以下内容属于 roadmap，不代表当前已经可用：

- Schema-aware generation
- Deterministic seed
- Constraint-aware values
- Semantic inference
- Relational datasets
- SQL / CSV / JSON export
- Read-only by default

本轮不读取 DBX 私有 Store、Credential 文件或未公开前端模块，不维护第二套数据库连接体系，也不修改 `t8y2/dbx`。只有在 Phase 0 Gate 明确后，才进入后续功能设计。

## Phase 0 documents

- [Roadmap](docs/ROADMAP.md)
- [Host API Audit](docs/HOST_API_AUDIT.md)
- [Host API Requirements](docs/HOST_API_REQUIREMENTS.md)
- [Phase 0 Feasibility Report](docs/PHASE0_FEASIBILITY_REPORT.md)
