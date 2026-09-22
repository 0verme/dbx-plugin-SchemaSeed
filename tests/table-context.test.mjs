import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import path from "node:path";

import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  TABLE_CONTEXT_METHOD,
  normalizeTableContextPayload,
} from "../src/table-context.mjs";
import { handleRpcRequest } from "../src/probe-protocol.mjs";

const backend = fileURLToPath(new URL("../backend/schema-seed-probe.mjs", import.meta.url));

function request(params, method = TABLE_CONTEXT_METHOD, id = 1) {
  return handleRpcRequest({ jsonrpc: "2.0", id, method, params });
}

function contextFrom(response) {
  assert.equal(response?.error, undefined);
  assert.ok(response?.result?.context);
  return response.result.context;
}

describe("SchemaSeed Table Context adapter", () => {
  it("normalizes a complete #9918 table payload", () => {
    const response = request({
      table: { connectionId: "conn-1", database: "app", schema: "public", table: "users" },
      ignored: "not part of the contract",
    });

    assert.deepEqual(contextFrom(response), {
      connectionId: "conn-1",
      database: "app",
      schema: "public",
      table: "users",
    });
    assert.deepEqual(JSON.parse(response.result.message), response.result.context);
  });

  it("accepts an omitted database", () => {
    const response = request({ table: { connectionId: "conn-1", schema: "main", table: "users" } });
    assert.deepEqual(contextFrom(response), { connectionId: "conn-1", schema: "main", table: "users" });
  });

  it("accepts an omitted schema", () => {
    const response = request({ table: { connectionId: "conn-1", database: "app", table: "users" } });
    assert.deepEqual(contextFrom(response), { connectionId: "conn-1", database: "app", table: "users" });
  });

  it("fails closed when a required field is missing", () => {
    const missingTable = request({ table: { connectionId: "conn-1", schema: "public" } });
    const missingConnection = request({ table: { table: "users" } });

    assert.equal(missingTable.error.code, -32602);
    assert.match(missingTable.error.message, /table\.table/);
    assert.equal(missingConnection.error.code, -32602);
    assert.match(missingConnection.error.message, /table\.connectionId/);
  });

  it("rejects malformed host payloads instead of reading display labels or unknown state", () => {
    for (const payload of [null, [], { table: null }, { table: { connectionId: "conn-1", table: 42 } }, { table: { connectionId: "conn-1", table: "users", schema: null } }]) {
      const normalized = normalizeTableContextPayload(payload);
      assert.equal(normalized.ok, false, JSON.stringify(payload));
    }
  });

  it("treats an unsupported contribution method as capability unsupported", () => {
    const response = request({ table: { connectionId: "conn-1", table: "users" } }, "contextMenu/io.github.0verme.schema-seed.unknown");
    assert.equal(response.error.code, -32601);
  });

  it("keeps old-host behavior safe: an old connection payload is not accepted as table context", () => {
    const initialize = handleRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "plugin/initialize",
      params: { host: { hostApiVersion: "1.0.0" } },
    });
    assert.deepEqual(initialize.result, {
      protocolVersion: 1,
      capabilities: [],
      plugin: { id: PLUGIN_ID, version: PLUGIN_VERSION },
    });

    // A host without #9918 does not expose menu: "table". If a legacy-shaped
    // request reaches the backend, it must fail rather than infer a table.
    const legacy = request({ connection: { id: "conn-1", database: "app" } });
    assert.equal(legacy.error.code, -32602);
  });

  it("refreshes A → B → C without retaining optional fields from the prior table", () => {
    const tables = [
      { connectionId: "conn-1", database: "app", schema: "public", table: "table_a" },
      { connectionId: "conn-1", database: "app", schema: "public", table: "table_b" },
      { connectionId: "conn-2", table: "table_c" },
    ];

    const contexts = tables.map((table, index) => contextFrom(request({ table }, TABLE_CONTEXT_METHOD, index + 1)));
    assert.deepEqual(contexts, [
      { connectionId: "conn-1", database: "app", schema: "public", table: "table_a" },
      { connectionId: "conn-1", database: "app", schema: "public", table: "table_b" },
      { connectionId: "conn-2", table: "table_c" },
    ]);
    assert.equal("database" in contexts[2], false);
    assert.equal("schema" in contexts[2], false);
  });

  it("serves the real JSONL sidecar handshake and invocation path", () => {
    const input = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "plugin/initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: TABLE_CONTEXT_METHOD, params: { table: { connectionId: "conn-1", table: "users" } } }),
    ].join("\n") + "\n";
    const result = spawnSync(process.execPath, [backend], { input, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(responses[0].result.plugin.id, PLUGIN_ID);
    assert.deepEqual(responses[1].result.context, { connectionId: "conn-1", table: "users" });
  });
});
