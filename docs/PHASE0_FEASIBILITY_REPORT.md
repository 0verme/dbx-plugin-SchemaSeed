# SchemaSeed Phase 0 Feasibility Report

Status: NOT_CLOSED

## v0.1 Required

| Capability | Result | Evidence |
|---|---|---|
| Table Context | VERIFIED; probe IMPLEMENTED; manual smoke PENDING USER VERIFICATION | DBX #9918 latest `origin/main`; `manifest.json`; `src/table-context.mjs`; `backend/schema-seed-probe.mjs` |
| Columns | WAITING_UPSTREAM_9917 | No public metadata Host API is consumed by this probe. |
| Type | WAITING_UPSTREAM_9917 | Same metadata boundary. |
| Nullable | WAITING_UPSTREAM_9917 | Same metadata boundary. |
| Length | WAITING_UPSTREAM_9917 | Same metadata boundary. |
| Precision / Scale | WAITING_UPSTREAM_9917 | Same metadata boundary. |
| Default | WAITING_UPSTREAM_9917 | Same metadata boundary. |

## Table Context probe

The verified #9918 path is:

```text
DBX Sidebar Tree table node
→ native `context-menu` contribution with `menu: "table"`
→ `contextMenu/io.github.0verme.schema-seed.table-context-probe`
→ JSONL backend
→ thin table payload adapter
→ SchemaSeed internal TableContext
→ `{ message: JSON.stringify(context) }` toast
```

The consumer model is internal:

```ts
interface TableContext {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
}
```

It is not the DBX wire payload. The actual #9918 wire payload nests this object under `params.table`; `database` and `schema` are omitted when unavailable.

## Schema Metadata

```text
WAITING_UPSTREAM_9917
```

No metadata workaround or second database connection is used.

## Future Capabilities

| Capability | Result | Target |
|---|---|---|
| Comment | WAITING_UPSTREAM_9917 / future contract | v0.2 |
| Primary Key | WAITING_UPSTREAM_9917 / future contract | v0.3 |
| UNIQUE | WAITING_UPSTREAM_9917 / future contract | v0.3 |
| CHECK | WAITING_UPSTREAM_9917 / future contract | v0.3 |
| Identity | WAITING_UPSTREAM_9917 / future contract | v0.3 |
| Foreign Key | WAITING_UPSTREAM_9917 / future contract | v0.4 |

## Final Gate

Overall Phase 0 remains:

```text
NOT_CLOSED
```

`READY` is not claimed. Table Context source audit is verified and the consumer probe is implemented, but real DBX manual smoke is pending and Schema Metadata is waiting for #9917.
