import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  TABLE_CONTEXT_METHOD,
  isRecord,
  probeTableContextPayload,
} from "./table-context.mjs";
import { pendingTableContextStore } from "./probe-state.mjs";

export const JSON_RPC_VERSION = "2.0";
export const PLUGIN_PROTOCOL_VERSION = 1;
export const TAKE_TABLE_CONTEXT_METHOD = "schemaMetadataProbe/takeTableContext";

/**
 * Handle DBX's public sidecar JSON-RPC requests. The only cross-call state is
 * a short-lived, one-shot table identity for the documented Workbench handoff.
 *
 * @param {unknown} request
 * @returns {Record<string, unknown> | null}
 */
export function handleRpcRequest(request) {
  const id = isRecord(request) && Object.hasOwn(request, "id") ? request.id : null;
  if (!isRecord(request)) return errorResponse(id, -32600, "Invalid Request");
  if (request.jsonrpc !== JSON_RPC_VERSION || typeof request.method !== "string") {
    return errorResponse(id, -32600, "Invalid Request");
  }

  if (request.method === "plugin/initialize") {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id,
      result: {
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        capabilities: [],
        plugin: { id: PLUGIN_ID, version: PLUGIN_VERSION },
      },
    };
  }

  // Notifications do not receive a response from the sidecar.
  if (!Object.hasOwn(request, "id")) return null;

  if (request.method === TAKE_TABLE_CONTEXT_METHOD) {
    return { jsonrpc: JSON_RPC_VERSION, id, result: { context: pendingTableContextStore.take() } };
  }

  if (request.method !== TABLE_CONTEXT_METHOD) {
    return errorResponse(id, -32601, `Method not found: ${request.method}`);
  }

  const probe = probeTableContextPayload(request.params);
  if (!probe.ok) return errorResponse(id, -32602, probe.message);
  pendingTableContextStore.remember(probe.context);
  return { jsonrpc: JSON_RPC_VERSION, id, result: probe.result };
}

export function parseProtocolLine(line) {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false, response: errorResponse(null, -32700, "Invalid JSON") };
  }
}

function errorResponse(id, code, message) {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } };
}
