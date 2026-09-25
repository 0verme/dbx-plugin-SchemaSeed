import { generateRows } from "./generation-engine.mjs";
import { buildGenerationPlan } from "./generation-plan.mjs";
import { GENERATION_PREVIEW_METHOD } from "./generation-runtime-contract.mjs";

export { GENERATION_PREVIEW_METHOD } from "./generation-runtime-contract.mjs";
export const GENERATION_RUNTIME_JSON_RPC_VERSION = "2.0";
const MAX_PREVIEW_ROWS = 100;
const ALLOWED_OPTIONS = new Set(["rowCount", "seed", "locale", "mode", "rules", "constraints", "validateOnly", "semanticOverrides", "semanticMappings"]);

/**
 * Build and execute an existing Core GenerationPlan for the packaged Workbench.
 * This RPC accepts normalized SchemaSeed domain facts only; it has no Host,
 * database, credential, fixture, or network access.
 * @param {unknown} request
 * @returns {Record<string, unknown> | null}
 */
export function handleGenerationRuntimeRequest(request) {
  const id = isRecord(request) && Object.hasOwn(request, "id") ? request.id : null;
  if (!isRecord(request) || request.jsonrpc !== GENERATION_RUNTIME_JSON_RPC_VERSION
    || request.method !== GENERATION_PREVIEW_METHOD) return null;
  if (!Object.hasOwn(request, "id")) return null;

  try {
    const { schema, options } = validateParams(request.params);
    const { validateOnly = false, ...generationOptions } = options;
    const plan = buildGenerationPlan(schema, generationOptions);
    const generated = validateOnly
      ? { rows: [], diagnostics: [...plan.diagnostics], status: plan.status }
      : generateRows(plan);
    return { jsonrpc: GENERATION_RUNTIME_JSON_RPC_VERSION, id, result: { plan, generated } };
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

/** @param {unknown} params */
function validateParams(params) {
  if (!isRecord(params) || !isRecord(params.schema) || !isRecord(params.options)) {
    throw new TypeError("generation/preview requires normalized schema and options objects");
  }
  if (!Array.isArray(params.schema.columns) || params.schema.columns.length === 0) {
    throw new TypeError("generation/preview requires a non-empty normalized schema");
  }
  const unknownOptions = Object.keys(params.options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unknownOptions.length > 0) throw new TypeError(`Unsupported generation option(s): ${unknownOptions.join(", ")}`);
  if (!Number.isSafeInteger(params.options.rowCount) || params.options.rowCount < 1 || params.options.rowCount > MAX_PREVIEW_ROWS) {
    throw new RangeError(`Workbench preview rows must be from 1 to ${MAX_PREVIEW_ROWS}`);
  }
  if (typeof params.options.seed !== "string") throw new TypeError("Workbench preview seed must be text");
  if (params.options.validateOnly !== undefined && typeof params.options.validateOnly !== "boolean") {
    throw new TypeError("validateOnly must be a boolean when provided");
  }
  if (params.options.locale !== "zh-CN" && params.options.locale !== "en") {
    throw new RangeError("Workbench preview locale must be zh-CN or en");
  }
  return { schema: params.schema, options: params.options };
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
