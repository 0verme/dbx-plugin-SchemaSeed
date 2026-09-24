# SchemaSeed Phase 0 Feasibility Report

Status: READY_WITH_FOLLOWUPS

## Gate Decision and Current Status

```text
Phase 0 Gate: READY_WITH_FOLLOWUPS
Issue #6: CLOSED by merged PR #33 (the original gate-closing PR used `Closes #6`)
Issue #5: CLOSED by merged PR #28
Runtime:
DBX v0.6.21 Windows Desktop (PR #28)
Host API: ^1.3
Permission: host.schema:read
Method: window.dbxPlugin.getTableMetadata({ connectionId, database?, schema?, table })
Runtime Matrix:
MySQL PASS
SQLite PASS
PostgreSQL PASS

Current follow-up status:
Issue #6: CLOSED by merged PR #33
Production adapter: implemented in Issue #30; DBX Workbench integration remains #31
Upstream TableContext → Workbench handoff: t8y2/dbx#10244 MERGED
```

### Frozen Schema Acquisition Path

```text
DBX Table Context
→ Public Plugin Host API
→ getTableMetadata()
→ columns metadata
→ SchemaSeed normalization
```

The v0.1 blocking capabilities proven by this path are Table Context, columns, type, nullable, length, precision, scale, default, and SchemaSeed normalization. Runtime details are recorded below from PR #28; this task consumes that evidence and does not rerun the Windows DBX smoke.

Facts below were checked against the merged upstream contract, official `plugin-development` documentation, and the merged PR #28 runtime evidence, not the old `WAITING_UPSTREAM_9917` notes.

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
DBX v0.6.21 Phase 0 Probe runtime: TWO_STEP_HANDOFF
Current upstream contract: t8y2/dbx#10244 MERGED
```

The DBX v0.6.21 runtime evidence remains the historical two-step Phase 0 Probe flow: right-click a table → `SchemaSeed：保存 Table Context` → sidecar temporarily stores identity-only context → user manually opens the Schema Metadata Probe Workbench. Separately, upstream PR [t8y2/dbx#10244](https://github.com/t8y2/dbx/pull/10244) has now merged the direct `context-menu → open-workbench` handoff, passing the current connection/table context and refreshing it when a Workbench tab is reused. This newer upstream contract is intended for #31; it is not part of #30 and does not block the provider. Runtime smoke for a DBX release containing #10244 belongs to #31.

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
- PK, FK, UNIQUE, CHECK, Comment, and Identity are not exposed by the current Host API 1.3 contract. These are future capabilities, not v0.1 blocking capabilities; the Probe records exposed future-capability statuses as `not_exposed`, not as provider `unsupported`.
- The public response does not include database type. Runtime support is established only for the separately tested DBX v0.6.21 MySQL, SQLite, and PostgreSQL cases recorded below; it is not inferred from the generic API shape.
- The Probe retains the unmodified Host API value as `rawHostResponse`; `metadata` is the separate SchemaSeed-normalized result. The UI labels and displays both values separately. Unknown fields are visible in the raw response but discarded from the normalized result.

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

The packaged Probe Workbench displays Host API requirement, capability, Table Context, Raw Host API response, SchemaSeed normalized result, future-field exposure status, and diagnostics. The fixture-driven Phase 1A–1D Workbench is not packaged. The `.dbxp` includes only the existing sidecar, the Probe UI, and the minimal consumer module.

No production `DbxHostSchemaMetadataProvider`, Generator changes, Constraint / Relation / SCD behavior, SQL Export, second database connection, system-catalog query, `SHOW`, or `PRAGMA` workaround is included.

Build artifact (local ignored output; unsigned development package):

```text
Path: dist/io.github.0verme.schema-seed-0.1.0-universal.dbxp
SHA-256: 971e21344684c792f0fc9bc73dd14957e17b6c3a88837c09ffb71f37b0d4459a
Size: 30,984 bytes
```

The package contract test verifies Manifest permissions/Host API requirement, the separate Raw/normalized UI labels, included Probe resources, excluded fixture Workbench resources, and SHA-256 checksums for packaged files.

## Runtime Baseline and Database Status

- Runtime baseline: DBX v0.6.21, Windows desktop. The local executable's FileVersion and ProductVersion both report `0.6.21`; a running process was observed. This verifies the installed release baseline only, not the Probe UI/API behavior.
- Upstream source: PR #10043 (merge commit `d5a05a98840e54726bfec0c7dadabb8dc9a4c755`); release notes for v0.6.21 list the read-only schema metadata Host API.
- API: `window.dbxPlugin.getTableMetadata({ connectionId, database?, schema?, table })`; manifest declares Host API `^1.3` and permission `host.schema:read`; runtime capability gate is `capabilities.schemaMetadataApi`.
- Context path: DBX table `context-menu` contribution (`menu: "table"`) → sidecar `contextMenu/<contribution-id>` → identity-only context staged for 10 minutes → Probe Workbench sidecar `invoke("schemaMetadataProbe/takeTableContext")` → public `getTableMetadata` call.

## v0.1 Blocking Capabilities

The blocking Schema Acquisition Path has been observed end-to-end on DBX v0.6.21 Windows Desktop:

```text
Table Context
→ Public Plugin Host API
→ getTableMetadata()
→ columns metadata
→ SchemaSeed normalization
```

| Database | Result | Runtime evidence |
|---|---|---|
| MySQL | PASS | Table Context obtained; `schemaMetadataApi = available`; raw response contained `columns` and `fieldCapabilities`; normalized result generated; `Diagnostics = []`. Observed column: `{ "name": "abc", "dataType": "varchar(255)", "nullable": true, "length": 255 }`. `length`, `precision`, `scale`, and `default`: `supported`. |
| SQLite | PASS | Database/schema/table: `main` / `main` / `abc`; full Table Context → metadata → normalization path completed; `Diagnostics = []`. `length`, `precision`, and `scale`: `unsupported`; `default`: `supported`. Normalized future statuses observed: `unique`, `check`, `comment`, `identity` = `not_exposed`. |
| PostgreSQL | PASS | Database/schema/table: `test` / `dwp` / `audit_results`; Table Context obtained; `schemaMetadataApi = available`; raw response contained fields; normalized result generated; `Diagnostics = []`. Observed columns include `id bigint NOT NULL`, `task_id bigint NOT NULL`, and `category text NOT NULL`. `length`, `precision`, `scale`, and `default`: `supported`. |

The SQLite `unsupported` capability values are provider capability declarations, not failures. No additional runtime behavior is inferred beyond these observations.

## Future Capabilities / Non-blocking Gaps

The current Host API 1.3 does not expose PK, FK, UNIQUE, CHECK, Comment, or Identity metadata. These are future capabilities and do not block the v0.1 acquisition path. Where returned in the normalized future-capability status, they are represented as `not_exposed`, not provider `unsupported`.

## Automated Coverage and Exception Path

Automated tests cover capability gating, required/optional TableContext fields, successful API request, metadata errors, connection/permission failures, Raw Host response preservation, normalization/provenance, one public API call only, static boundary checks, Manifest contract, and `.dbxp` resource/checksum contents. Unsupported capability and permission-denied behavior are automated contract coverage, not claims of live DBX permission manipulation.

The one-shot handoff replay path is also automated: after the pending context is consumed, another read returns no context; the Probe returns `missing_table_context` without requesting metadata. The UI renders this returned diagnostic through its normal error-result path. The supplied manual runtime evidence does not include a second-read/replay observation, so this is **automated coverage only**, not a manual runtime PASS. Likewise, no manual permission-denied or closed-connection failure is claimed.

## Phase 0 Gate

```text
READY_WITH_FOLLOWUPS
```

The original Gate decision was **READY_WITH_FOLLOWUPS**: the public v0.1 Schema Acquisition Path was proven end-to-end for MySQL, SQLite, and PostgreSQL. At that decision point, Host API 1.3 did not expose PK, FK, UNIQUE, CHECK, Comment, or Identity metadata, and the direct context-menu → Workbench handoff was not yet merged; those gaps were non-blocking. Upstream #10244 has since merged the handoff contract, while the future metadata fields remain unexposed. `not_exposed` is not equivalent to provider `unsupported`; it describes the Host API exposure boundary and makes no claim about whether a database or driver supports the capability. This was not `BLOCKED` because every v0.1 blocking capability and the legal public acquisition path had runtime evidence in DBX v0.6.21 Windows Desktop.

The original Gate-closing PR used `Closes #6`; Issue #6 is now CLOSED by merged PR #33. This Gate decision means only that SchemaSeed v0.1's public, legal Schema Acquisition Path is proven feasible and production integration / productization may proceed. At the time of that Gate decision it did not mean that a production `DbxHostSchemaMetadataProvider` or Generation Workbench existed. Current follow-up status: #30 implements the production metadata adapter and its Core contract path; #31 still owns the packaged DBX Generation Workbench/runtime integration, and Column Rules / Constraint Engine remain separate scope.
