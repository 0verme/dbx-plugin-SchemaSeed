import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { handleRuntimeRpcRequest } from "../backend/schema-seed-runtime.mjs";
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
  assert.equal(first.id, 1);
  assert.equal(first.error, undefined);
  assert.equal(first.result.plan.table.tableIdentity, schema.tableIdentity);
  assert.equal(first.result.plan.rowCount, 5);
  assert.equal(first.result.generated.status, "ready");
  assert.equal(first.result.generated.rows.length, 5);
  assert.deepEqual(first.result.generated.rows, replay.result.generated.rows);
});

test("runtime rejects oversized or malformed preview input without generating rows", () => {
  const tooManyRows = handleRuntimeRpcRequest(request({ schema, options: { ...options, rowCount: 101 } }));
  assert.equal(tooManyRows.error.code, -32602);
  assert.match(tooManyRows.error.message, /1 to 100/);

  const invalidSchema = handleRuntimeRpcRequest(request({ schema: { columns: [] }, options }));
  assert.equal(invalidSchema.error.code, -32602);
  assert.match(invalidSchema.error.message, /non-empty normalized schema/);
});

test("same backend keeps Phase 0 Probe RPC separate from production generation RPC", () => {
  const initialized = handleRuntimeRpcRequest({ jsonrpc: "2.0", id: "init", method: "plugin/initialize", params: {} });
  assert.equal(initialized.result.plugin.id, "io.github.0verme.schema-seed");

  const unsupported = handleRuntimeRpcRequest({ jsonrpc: "2.0", id: 4, method: "not/a-method", params: {} });
  assert.equal(unsupported.error.code, -32601);
});

test("production generation RPC has no fixture, DBX Host, credential or database connection dependency", async () => {
  const source = await readFile(path.join(root, "src/generation/generation-runtime-protocol.mjs"), "utf8");
  assert.doesNotMatch(source, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
  assert.doesNotMatch(source, /window\.dbxPlugin|getTableMetadata|credentialStore|password|username|information_schema|pg_catalog|\bSHOW\s|\bPRAGMA\b|new\s+(?:Pool|Client|Connection)\b/i);
});
