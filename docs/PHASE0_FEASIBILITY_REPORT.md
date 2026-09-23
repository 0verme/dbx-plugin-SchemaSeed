# SchemaSeed Phase 0 Feasibility Report

Status: NOT_CLOSED

## Current Status

```text
t8y2/dbx#10043: MERGED
Merge commit: d5a05a98840e54726bfec0c7dadabb8dc9a4c755
Schema Metadata Host API: UPSTREAM_AVAILABLE (Host API 1.3)
Consumer Probe: IMPLEMENTED / READY_FOR_REAL_DBX_SMOKE
Real DBX Smoke: NOT RUN (upstream says the API ships in the next DBX version)
Issue #5: OPEN (manual smoke pending)
Issue #6 / Phase 0 Gate: OPEN / NOT_CLOSED
```

Facts below were checked against the merge commit's source and official `plugin-development` documentation, not the old `WAITING_UPSTREAM_9917` notes.

## Public Table Context Contract

The table contribution is invoked as:

```text
context-menu (`menu: "table")
→ contextMenu/io.github.0verme.schema-seed.table-context-probe
→ JSONL sidecar
```

DBX sends `params.table` with `connectionId`, `table`, and optional `database` / `schema`. It contains table identity only, not credentials, connection strings, or raw connection configuration. The sidecar validates and normalizes this into SchemaSeed's internal `TableContext`.

## Table Context → Workbench Handoff

```text
DIRECT_CONTEXT_MENU_TO_WORKBENCH_HANDOFF: NOT_AVAILABLE
```

The documented context-menu surface invokes a backend RPC and returns a native toast; it has no documented direct "open Workbench with context" operation. `openWorkbench(id, context)` exists as a frontend Host API, but a native context-menu callback is not a Workbench iframe and cannot call it.

The Probe uses the narrow public two-step alternative:

```text
context-menu backend RPC
→ plugin-owned in-memory latest TableContext (10-minute TTL, one-shot)
→ user opens the declared Probe Workbench
→ Workbench calls window.dbxPlugin.invoke("schemaMetadataProbe/takeTableContext")
→ Workbench calls window.dbxPlugin.getTableMetadata(TableContext)
```

Official plugin docs specify that sidecars are persistent and shared per plugin process. The handoff stores only the normalized non-credential table identity. It does not read DBX private Store, credentials, or private frontend/Tauri APIs.

## Host API 1.3 Contract

Manifest declaration:

```json
{
  "engines": { "host_api": "^1.3" },
  "permissions": ["host.schema:read"]
}
```

Runtime capability gate: `window.dbxPlugin.capabilities.schemaMetadataApi` must be `true` before calling:

```js
window.dbxPlugin.getTableMetadata({ connectionId, database?, schema?, table })
```

The Workbench UI does not expose a runtime Host API version through the documented interface; it displays the manifest requirement (`^1.3`) and the runtime capability separately.

### Request Semantics

- `connectionId` and `table` are required, trimmed, non-empty identifiers, each limited to 256 characters.
- `database` and `schema` are optional and are omitted when unavailable; empty strings are not public identities. When omitted, DBX resolves its existing configured/default scope where available.
- The connection/session must already be open. DBX does not reconnect, create a pool, or route to another connection. A closed connection rejects with `Connection is not open`; a requested database with no matching open session is also rejected.
- Missing `host.schema:read` is rejected by the Host bridge before the metadata backend is reached. Older hosts should advertise a missing/false capability; the consumer gates on that rather than probing the method.

### Response and Provenance

The narrow response is `{ columns, fieldCapabilities }`:

- Each column provides `name`, `dataType`, and `nullable`; `length`, `precision`, `scale`, and `default` are optional and may remain `null` or omitted.
- `fieldCapabilities` reports `supported`, `unsupported`, or `unknown` for `length`, `precision`, `scale`, and `default`. The Probe preserves these values and preserves optional null/omitted values; it does not synthesize `false`, `0`, empty strings, or empty arrays.
- Comments, PK, FK, UNIQUE, CHECK, credentials, driver objects, and arbitrary SQL results are not exposed by Host API 1.3. The Probe records these as `not_exposed`, not as provider `unsupported`.
- The public response does not include database type. Actual PostgreSQL / MySQL / SQLite runtime support remains a real-DBX smoke follow-up; it is not inferred from the merge or from generic API shape.

### Error Model

Host calls reject their Promise; Host API 1.3 does not define a structured error-code enum. The Probe maps observed/documented failures to stable local diagnostics:

- `capability_unavailable`
- `permission_denied`
- `missing_table_context`
- `connection_not_open`
- `metadata_request_failed`
- `invalid_metadata_response`

The connection-not-open message is documented by DBX; permission failures are identified from the Host bridge's declared-permission rejection. Other provider/transport failures remain `metadata_request_failed` with the original message.

## Probe and Packaging Boundary

The packaged Probe Workbench displays Host API requirement, capability, Table Context, normalized Host response, future-field exposure status, and diagnostics. The fixture-driven Phase 1A–1D Workbench is not packaged. The `.dbxp` includes only the existing sidecar, the Probe UI, and the minimal consumer module.

No production `DbxHostSchemaMetadataProvider`, Generator changes, Constraint / Relation / SCD behavior, SQL Export, second database connection, system-catalog query, `SHOW`, or `PRAGMA` workaround is included.

## Validation and Manual Smoke

Automated tests cover capability gating, required/optional TableContext fields, successful API request, metadata errors, connection/permission failures, normalization, provenance preservation, one public API call only, static boundary checks, Manifest contract, and actual `.dbxp` resource/checksum contents.

Upstream maintainer comment on PR #10043 says the merge will be released in the next DBX version. The latest published DBX release found during this task is v0.6.20 (2026-09-22), before the merge; no DBX executable/runtime is available in this workspace. Therefore no real DBX smoke is claimed. Record the smoke as `READY_FOR_REAL_DBX_SMOKE`, not `VERIFIED`, until a released Host API 1.3 build is tested against PostgreSQL, MySQL, and SQLite.

## Phase 0 Gate

```text
NOT_CLOSED
```

Issue #6 remains OPEN. This report records Issue #5 implementation and its remaining manual-smoke condition; it does not make the final Phase 0 `READY`, `READY_WITH_FOLLOWUPS`, or `BLOCKED` decision.
