import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { handleGenerationRuntimeRequest as handleRuntimeRpcRequest } from "../src/generation/generation-runtime-protocol.mjs";
import { executeGenerationPreview } from "../src/generation/generation-runtime.mjs";
import { GENERATION_PREVIEW_METHOD } from "../src/generation/generation-runtime-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = {
  tableIdentity: "dbx:[\"conn\",\"sales\",\"public\",\"customer\"]",
  columns: [
    { name: "customer_id", dataType: "integer", nullable: false },
    { name: "label", dataType: "varchar", nullable: false, length: 32 },
  ],
};
const options = { rowCount: 5, seed: "replay-seed", locale: "en", mode: "safe_synthetic" };

function request(params, id = 1) {
  return { jsonrpc: "2.0", id, method: GENERATION_PREVIEW_METHOD, params };
}

test("production runtime builds the existing GenerationPlan and generates deterministic preview rows", () => {
  const first = handleRuntimeRpcRequest(request({ schema, options }));
  const replay = handleRuntimeRpcRequest(request({ schema, options }, 2));
  const local = executeGenerationPreview(schema, options);
  assert.equal(first.id, 1);
  assert.equal(first.error, undefined);
  assert.equal(first.result.plan.table.tableIdentity, schema.tableIdentity);
  assert.equal(first.result.plan.rowCount, 5);
  assert.equal(first.result.generated.status, "ready");
  assert.equal(first.result.generated.rows.length, 5);
  assert.deepEqual(first.result.generated.rows, replay.result.generated.rows);
  assert.deepEqual(local, first.result, "local Workbench execution and compatibility RPC share the exact runtime contract");
});

test("runtime transports GenerationRules and manual constraints through validation-only requests", () => {
  const optionsWithRules = {
    ...options,
    rules: { customer_id: { kind: "sequence", start: 5, step: 3 } },
    constraints: [{ id: "customer-id", kind: "unique", column: "customer_id" }],
  };
  const preview = handleRuntimeRpcRequest(request({ schema, options: optionsWithRules }));
  assert.equal(preview.result.plan.columns[0].generationRule.kind, "sequence");
  assert.equal(preview.result.plan.constraintPlan.constraints[0].kind, "unique");
  assert.deepEqual(preview.result.generated.rows.map((row) => row.customer_id), [5, 8, 11, 14, 17]);

  const validation = handleRuntimeRpcRequest(request({ schema, options: { ...optionsWithRules, validateOnly: true } }));
  assert.equal(validation.error, undefined);
  assert.equal(validation.result.plan.status, "ready");
  assert.equal(validation.result.plan.constraintPlan.constraints[0].satisfiable, true);
  assert.deepEqual(validation.result.generated.rows, []);
  assert.equal(validation.result.generated.status, "ready");

  const invalid = handleRuntimeRpcRequest(request({
    schema,
    options: { ...options, rules: { customer_id: { kind: "random_integer", min: 0, max: Number.MAX_SAFE_INTEGER } } },
  }));
  assert.equal(invalid.result.plan.status, "blocked");
  assert.deepEqual(invalid.result.generated.rows, []);
  assert.ok(invalid.result.generated.diagnostics.some((entry) => entry.code === "generation_rule_incompatible"));

  const invalidConstraint = handleRuntimeRpcRequest(request({
    schema,
    options: { ...options, constraints: [{ id: "bad", kind: "unique", column: "missing" }] },
  }));
  assert.equal(invalidConstraint.result.plan.status, "blocked");
  assert.ok(invalidConstraint.result.plan.diagnostics.some((entry) => entry.code === "unknown_constraint_column"));
  assert.deepEqual(invalidConstraint.result.generated.rows, []);
});

test("runtime transports bounded sample profiles and rejects copied row values", () => {
  const withEvidence = handleRuntimeRpcRequest(request({
    schema: { ...schema, columns: [{ name: "display_name", dataType: "varchar", nullable: false, length: 128 }] },
    options: { ...options, sampleEvidence: [{ column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5 }] },
  }));
  assert.equal(withEvidence.error, undefined);
  assert.equal(withEvidence.result.plan.columns[0].semanticMapping.confidence, "high");
  assert.equal(withEvidence.result.plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required"), false);

  const negativeEvidence = handleRuntimeRpcRequest(request({
    schema: { ...schema, columns: [{ name: "file_name", dataType: "varchar", nullable: false, length: 128 }] },
    options: { ...options, sampleEvidence: [{ column: "file_name", kind: "chinese_name_pattern_rejected", sampleCount: 8, matchedCount: 0 }] },
  }));
  assert.equal(negativeEvidence.error, undefined);
  assert.equal(negativeEvidence.result.plan.columns[0].inference.status, "unknown");
  assert.equal(negativeEvidence.result.plan.columns[0].inference.evidence.some((entry) => entry.kind === "sample_name_pattern_rejected"), true);
  assert.equal(negativeEvidence.result.plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required"), false);

  const profiled = handleRuntimeRpcRequest(request({
    schema: {
      tableIdentity: schema.tableIdentity,
      columns: [
        { name: "category", dataType: "text", nullable: false },
        { name: "line_no", dataType: "integer", nullable: false },
        { name: "file_name", dataType: "text", nullable: false },
      ],
    },
    options: {
      ...options,
      sampleEvidence: [
        { column: "category", kind: "enum_like", sampleCount: 4, distinctCount: 2, candidates: [
          { value: "active", frequency: 3 }, { value: "pending", frequency: 1 },
        ] },
        { column: "line_no", kind: "numeric_range", sampleCount: 4, min: 0, max: 8, zeroCount: 1 },
        { column: "file_name", kind: "filename_pattern", sampleCount: 4, matchedCount: 4, suffixes: [
          { suffix: ".sql", frequency: 3 }, { suffix: ".py", frequency: 1 },
        ] },
      ],
    },
  }));
  assert.equal(profiled.error, undefined);
  assert.deepEqual(profiled.result.plan.columns.map(({ rule }) => rule.kind), ["sample_enum", "sample_numeric", "sample_filename"]);
  assert.ok(profiled.result.generated.rows.every((row) => ["active", "pending"].includes(row.category)));
  assert.ok(profiled.result.generated.rows.every((row) => Number.isInteger(row.line_no) && row.line_no >= 0 && row.line_no <= 8));
  assert.ok(profiled.result.generated.rows.every((row) => /^generated_[A-Za-z0-9]+\.(?:sql|py)$/u.test(row.file_name)));

  const temporal = handleRuntimeRpcRequest(request({
    schema: {
      tableIdentity: schema.tableIdentity,
      columns: [{ name: "started_at", dataType: "timestamp", nullable: true, precision: 6 }],
    },
    options: {
      ...options,
      sampleEvidence: [{
        column: "started_at", kind: "temporal_range", temporalKind: "timestamp", sampleCount: 4,
        nullCount: 1, nullRate: 0.25, observedCount: 3,
        observedMin: "2026-06-01 08:00:00.123456", observedMax: "2026-07-31 23:59:59.999999",
        precision: 6, timezoneAware: false,
      }],
    },
  }));
  assert.equal(temporal.error, undefined);
  assert.equal(temporal.result.plan.columns[0].rule.kind, "timestamp_range");
  assert.equal(temporal.result.plan.columns[0].nullProbability, 0.25);
  assert.ok(temporal.result.generated.rows.every((row) => row.started_at === null
    || (row.started_at >= "2026-06-01 08:00:00.123456" && row.started_at <= "2026-07-31 23:59:59.999999")));

  const restrictedTemporal = handleRuntimeRpcRequest(request({
    schema: {
      tableIdentity: schema.tableIdentity,
      columns: [{ name: "last_login_at", dataType: "timestamp without time zone", nullable: true }],
    },
    options: {
      ...options,
      sampleEvidence: [{
        column: "last_login_at", kind: "temporal_shape", temporalKind: "timestamp", sampleCount: 4,
        nullCount: 1, nullRate: 0.25, observedCount: 3, precision: 0, timezoneAware: false,
      }],
    },
  }));
  assert.equal(restrictedTemporal.error, undefined);
  assert.equal(restrictedTemporal.result.plan.columns[0].rule.kind, "timestamp");
  assert.equal(restrictedTemporal.result.plan.columns[0].rule.parameters.precision, 0);
  assert.doesNotMatch(JSON.stringify(restrictedTemporal.result.plan), /observedMin|observedMax/);
  assert.ok(restrictedTemporal.result.generated.rows.every((row) => row.last_login_at === null
    || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(row.last_login_at)));

  const restrictedTemporalWithBounds = handleRuntimeRpcRequest(request({
    schema: {
      tableIdentity: schema.tableIdentity,
      columns: [{ name: "last_login_at", dataType: "timestamp without time zone", nullable: true }],
    },
    options: {
      ...options,
      sampleEvidence: [{
        column: "last_login_at", kind: "temporal_shape", temporalKind: "timestamp", sampleCount: 4,
        nullCount: 0, nullRate: 0, observedCount: 4, precision: 0, timezoneAware: false,
        observedMin: "2026-07-18 09:30:00",
      }],
    },
  }));
  assert.equal(restrictedTemporalWithBounds.error.code, -32602);
  assert.match(restrictedTemporalWithBounds.error.message, /must not contain observed bounds or values/u);

  const withRawValues = handleRuntimeRpcRequest(request({
    schema,
    options: { ...options, sampleEvidence: [{ column: "label", kind: "enum_like", sampleCount: 4, distinctCount: 2, values: ["SECRET"] }] },
  }));
  assert.equal(withRawValues.error.code, -32602);
  assert.match(withRawValues.error.message, /sample values are forbidden/);
});

test("runtime rejects oversized or malformed preview input without generating rows", () => {
  const tooManyRows = handleRuntimeRpcRequest(request({ schema, options: { ...options, rowCount: 1_001 } }));
  assert.equal(tooManyRows.error.code, -32602);
  assert.match(tooManyRows.error.message, /1 to 1000/);

  const invalidSchema = handleRuntimeRpcRequest(request({ schema: { columns: [] }, options }));
  assert.equal(invalidSchema.error.code, -32602);
  assert.match(invalidSchema.error.message, /non-empty normalized schema/);
});

test("preview compatibility adapter delegates to the shared local executor", () => {
  const protocol = handleRuntimeRpcRequest(request({ schema, options }));
  assert.deepEqual(protocol.result, executeGenerationPreview(schema, options));
  assert.equal(handleRuntimeRpcRequest({ jsonrpc: "2.0", id: 1, method: "other/method", params: {} }), null);
  assert.equal(handleRuntimeRpcRequest({ jsonrpc: "2.0", method: GENERATION_PREVIEW_METHOD, params: { schema, options } }), null);
});

test("shared generation runtime has no fixture, DBX Host, credential or database connection dependency", async () => {
  for (const relative of ["src/generation/generation-runtime.mjs", "src/generation/generation-runtime-protocol.mjs"]) {
    const source = await readFile(path.join(root, relative), "utf8");
    assert.doesNotMatch(source, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
    assert.doesNotMatch(source, /window\.dbxPlugin|getTableMetadata|credentialStore|password|username|information_schema|pg_catalog|\bSHOW\s|\bPRAGMA\b|new\s+(?:Pool|Client|Connection)\b/i);
  }
});
