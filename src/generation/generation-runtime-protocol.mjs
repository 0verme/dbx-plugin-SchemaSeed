import { executeGenerationPreview } from "./generation-runtime.mjs";
import { GENERATION_PREVIEW_METHOD } from "./generation-runtime-contract.mjs";

export { GENERATION_PREVIEW_METHOD } from "./generation-runtime-contract.mjs";
export const GENERATION_RUNTIME_JSON_RPC_VERSION = "2.0";

/**
 * Compatibility adapter for the former sidecar JSON-RPC method. Production UI
 * now calls executeGenerationPreview locally; keeping this adapter preserves
 * the wire contract for protocol-level tests and any historical callers.
 * @param {unknown} request
 * @returns {Record<string, unknown> | null}
 */
export function handleGenerationRuntimeRequest(request) {
  const id = isRecord(request) && Object.hasOwn(request, "id") ? request.id : null;
  if (!isRecord(request) || request.jsonrpc !== GENERATION_RUNTIME_JSON_RPC_VERSION
    || request.method !== GENERATION_PREVIEW_METHOD) return null;
  if (!Object.hasOwn(request, "id")) return null;

  try {
    const result = isRecord(request.params)
      ? executeGenerationPreview(request.params.schema, request.params.options)
      : executeGenerationPreview(undefined, undefined);
    return { jsonrpc: GENERATION_RUNTIME_JSON_RPC_VERSION, id, result };
  } catch (error) {
    return {
      jsonrpc: GENERATION_RUNTIME_JSON_RPC_VERSION,
      id,
      error: {
        code: -32602,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
