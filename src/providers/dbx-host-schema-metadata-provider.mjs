import { makeDiagnostic } from "../diagnostics.mjs";
import { requestDbxTableMetadata } from "../host/dbx-schema-metadata-probe.mjs";
import { normalizeTableSchema } from "../schema/schema-model.mjs";

const FIELD_NAMES = ["length", "precision", "scale", "default"];
const ERROR_DIAGNOSTICS = Object.freeze({
  capability_unavailable: {
    severity: "unsupported",
    code: "metadata_capability_unavailable",
    action: "Use a DBX host that exposes Host API 1.3 schema metadata and schemaMetadataApi.",
  },
  permission_denied: {
    severity: "error",
    code: "metadata_permission_denied",
    action: "Verify the plugin declares and has been granted host.schema:read.",
  },
  missing_table_context: {
    severity: "error",
    code: "table_context_invalid",
    action: "Open the provider with a valid DBX TableContext (connectionId and table).",
  },
  connection_not_open: {
    severity: "error",
    code: "metadata_connection_not_open",
    action: "Open the existing DBX connection/session and retry; SchemaSeed does not reconnect.",
  },
  invalid_metadata_response: {
    severity: "error",
    code: "metadata_invalid_response",
    action: "Check the DBX Host API 1.3 response contract; no fixture or guessed schema was substituted.",
  },
  metadata_request_failed: {
    severity: "error",
    code: "metadata_request_failed",
    action: "Check the DBX connection/session and retry the public metadata request.",
  },
});

/**
 * Production adapter for DBX's public Host API 1.3 metadata contract.
 * The Host bridge is injected by the DBX runtime caller; no global, private
 * DBX API, database connection, or fixture provider is accessed here.
 */
export class DbxHostSchemaMetadataProvider {
  /** @param {{ capabilities?: unknown, getTableMetadata?: (context: object) => Promise<unknown> }} host */
  constructor(host) {
    this.host = host;
  }

  /**
   * @param {import("../schema/schema-metadata-provider.mjs").TableSchemaRequest} request
   * @returns {Promise<import("../schema/schema-model.mjs").TableSchema>}
   */
  async getTableMetadata(request) {
    const result = await requestDbxTableMetadata(this.host, request?.tableContext);
    if (!result.ok) {
      throw makeProviderError(result.diagnostics[0], request?.tableContext);
    }

    const { context, metadata } = result;
    for (const column of metadata.columns) {
      for (const field of FIELD_NAMES) {
        if (metadata.fieldCapabilities[field] === "unsupported"
          && Object.hasOwn(column, field)
          && column[field] !== null
          && column[field] !== undefined) {
          throw makeInvalidResponseError(
            `fieldCapabilities.${field} is unsupported but column ${column.name} provides a value`,
            context,
          );
        }
      }
    }

    const tableIdentity = tableIdentityFor(context);
    const columns = metadata.columns.map((column) => ({
      name: column.name,
      dataType: knownFact(column.dataType, "DBX Host API 1.3 column.dataType"),
      nullable: knownFact(column.nullable, "DBX Host API 1.3 column.nullable"),
      length: structuredFact(column, "length", metadata.fieldCapabilities.length),
      precision: structuredFact(column, "precision", metadata.fieldCapabilities.precision),
      scale: structuredFact(column, "scale", metadata.fieldCapabilities.scale),
      default: structuredFact(column, "default", metadata.fieldCapabilities.default),
      identity: {
        state: "unknown",
        reason: "Identity metadata is not exposed by DBX Host API 1.3.",
        provenance: "DBX Host API 1.3 identity=not_exposed",
      },
    }));

    const { schema, issues } = normalizeTableSchema({ tableIdentity, columns });
    if (issues.length > 0) {
      throw makeInvalidResponseError(issues.map((issue) => issue.reason).join("; "), context);
    }
    return schema;
  }
}

/** @param {unknown} value @param {string} provenance */
function knownFact(value, provenance) {
  return { state: "known", value, provenance };
}

/** @param {Record<string, unknown>} column @param {string} field @param {string} capability */
function structuredFact(column, field, capability) {
  const present = Object.hasOwn(column, field) && column[field] !== undefined;
  const value = column[field];
  const presence = present ? (value === null ? "null" : "present") : "omitted";
  const provenance = `DBX Host API 1.3 fieldCapabilities.${field}=${capability}; column.${field}=${presence}`;

  if (present && value !== null) return { state: "known", value, provenance };
  if (capability === "unsupported") {
    return { state: "unsupported", reason: `DBX reports structured ${field} metadata as unsupported.`, provenance };
  }
  if (capability === "unknown") {
    return { state: "unknown", reason: `DBX does not know whether structured ${field} metadata is available.`, provenance };
  }
  if (present) {
    return { state: "absent", reason: `DBX explicitly returned null for ${field}.`, provenance };
  }
  return { state: "unavailable", reason: `DBX supports ${field} metadata but omitted it for this column.`, provenance };
}

/** @param {{ code?: string, message?: string } | undefined} source @param {unknown} context */
function makeProviderError(source, context) {
  const code = typeof source?.code === "string" ? source.code : "metadata_request_failed";
  const mapping = ERROR_DIAGNOSTICS[code] ?? ERROR_DIAGNOSTICS.metadata_request_failed;
  const message = typeof source?.message === "string" ? source.message : "DBX metadata request failed.";
  const diagnostic = makeDiagnostic({
    severity: mapping.severity,
    code: mapping.code,
    table: tableIdentityForError(context),
    rule: "dbx-host-metadata",
    reason: `${message} ${mapping.action}`,
    blocking: true,
  });
  return new DbxHostSchemaMetadataError(diagnostic);
}

/** @param {string} message @param {unknown} context */
function makeInvalidResponseError(message, context) {
  return makeProviderError({ code: "invalid_metadata_response", message }, context);
}

/** @param {unknown} context */
function tableIdentityForError(context) {
  if (context && typeof context === "object" && typeof context.table === "string" && context.table.trim()) {
    return context.table.trim();
  }
  return "<unknown-table>";
}

/** @param {{ connectionId: string, database?: string, schema?: string, table: string }} context */
function tableIdentityFor(context) {
  return `dbx:${JSON.stringify([context.connectionId, context.database ?? null, context.schema ?? null, context.table])}`;
}

export class DbxHostSchemaMetadataError extends Error {
  /** @param {import("../diagnostics.mjs").GenerationDiagnostic} diagnostic */
  constructor(diagnostic) {
    super(diagnostic.reason);
    this.name = "DbxHostSchemaMetadataError";
    this.code = diagnostic.code;
    this.diagnostic = diagnostic;
  }
}
