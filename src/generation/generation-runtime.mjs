import { generateRows } from "./generation-engine.mjs";
import { buildGenerationPlan } from "./generation-plan.mjs";

const MAX_PREVIEW_ROWS = 100;
const ALLOWED_OPTIONS = new Set(["rowCount", "seed", "locale", "mode", "rules", "constraints", "validateOnly", "semanticOverrides", "semanticMappings", "sampleEvidence"]);
const SAMPLE_EVIDENCE_FIELDS = new Set([
  "column", "kind", "sampleCount", "matchedCount", "distinctCount", "min", "max", "zeroCount", "candidates", "suffixes",
  "temporalKind", "nullCount", "nullRate", "observedCount", "observedMin", "observedMax", "precision", "timezoneAware",
]);
const RESTRICTED_TEMPORAL_FIELDS = new Set([
  "column", "kind", "sampleCount", "temporalKind", "nullCount", "nullRate", "observedCount", "precision", "timezoneAware",
]);

/**
 * Validate and execute the existing Core preview contract. This entrypoint is
 * shared by the DBX WebView and the historical JSON-RPC adapter; it has no
 * Host, database, credential, fixture, or network access.
 * @param {unknown} schema
 * @param {unknown} options
 * @returns {{ plan: object, generated: object }}
 */
export function executeGenerationPreview(schema, options) {
  const validated = validateParams({ schema, options });
  const { validateOnly = false, ...generationOptions } = validated.options;
  const plan = buildGenerationPlan(validated.schema, generationOptions);
  const generated = validateOnly
    ? { rows: [], diagnostics: [...plan.diagnostics], status: plan.status }
    : generateRows(plan);
  return { plan, generated };
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
  if (params.options.sampleEvidence !== undefined) validateSampleEvidencePayload(params.options.sampleEvidence);
  if (params.options.locale !== "zh-CN" && params.options.locale !== "en") {
    throw new RangeError("Workbench preview locale must be zh-CN or en");
  }
  return { schema: params.schema, options: params.options };
}

/** @param {unknown} value */
function validateSampleEvidencePayload(value) {
  if (!Array.isArray(value)) throw new TypeError("sampleEvidence must contain value-free inference summaries");
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !SAMPLE_EVIDENCE_FIELDS.has(key))) {
      throw new TypeError("sampleEvidence may contain only bounded profile fields and safe categorical labels; raw sample values are forbidden");
    }
    if (entry.kind === "temporal_shape" && Object.keys(entry).some((key) => !RESTRICTED_TEMPORAL_FIELDS.has(key))) {
      throw new TypeError("temporal_shape sampleEvidence must not contain observed bounds or values");
    }
  }
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
