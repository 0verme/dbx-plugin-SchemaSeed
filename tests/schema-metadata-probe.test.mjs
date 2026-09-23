import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  runDbxSchemaMetadataProbe,
  SCHEMA_METADATA_PROBE_ERROR_CODES as ERROR,
} from "../src/host/dbx-schema-metadata-probe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tableContext = { connectionId: "conn-1", database: "app", schema: "public", table: "customer" };
const metadata = {
  columns: [
    { name: "id", dataType: "integer", nullable: false, precision: 32, default: null },
    { name: "name", dataType: "varchar", nullable: true, length: 120 },
  ],
  fieldCapabilities: {
    length: "unsupported",
    precision: "supported",
    scale: "unknown",
    default: "unknown",
  },
};

function availableHost(getTableMetadata) {
  return { capabilities: { schemaMetadataApi: true }, getTableMetadata };
}

test("capability missing or false is gated without requesting metadata", async () => {
  for (const capabilities of [undefined, {}, { schemaMetadataApi: false }]) {
    let calls = 0;
    const result = await runDbxSchemaMetadataProbe({ capabilities, getTableMetadata: async () => { calls += 1; return metadata; } }, tableContext);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, ERROR.CAPABILITY_UNAVAILABLE);
    assert.equal(result.capability.available, false);
    assert.equal(calls, 0);
  }

  const advertisedWithoutMethod = await runDbxSchemaMetadataProbe({ capabilities: { schemaMetadataApi: true } }, tableContext);
  assert.equal(advertisedWithoutMethod.diagnostics[0].code, ERROR.CAPABILITY_UNAVAILABLE);
  assert.equal(advertisedWithoutMethod.capability.available, false);
});

test("valid TableContext calls the public metadata function with identity only", async () => {
  const requests = [];
  const result = await runDbxSchemaMetadataProbe(availableHost(async (context) => {
    requests.push(context);
    return metadata;
  }), tableContext);

  assert.equal(result.ok, true);
  assert.deepEqual(requests, [tableContext]);
  assert.deepEqual(result.context, tableContext);
  assert.deepEqual(result.metadata, metadata);
  assert.equal(result.capability.name, "schemaMetadataApi");
  assert.equal(result.hostApi.requirement, "^1.3");
  assert.equal(result.hostApi.runtimeVersion, "not_exposed_to_workbench");
});

test("omitted database and schema stay omitted from the public API request", async () => {
  let request;
  const result = await runDbxSchemaMetadataProbe(availableHost(async (context) => {
    request = context;
    return metadata;
  }), { connectionId: " conn-1 ", table: " customer " });

  assert.equal(result.ok, true);
  assert.deepEqual(request, { connectionId: "conn-1", table: "customer" });
  assert.equal(Object.hasOwn(request, "database"), false);
  assert.equal(Object.hasOwn(request, "schema"), false);
});

test("missing or malformed TableContext has a stable diagnostic", async () => {
  let calls = 0;
  const result = await runDbxSchemaMetadataProbe(availableHost(async () => { calls += 1; return metadata; }), null);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, ERROR.MISSING_TABLE_CONTEXT);
  assert.equal(calls, 0);
});

test("metadata normalization preserves optional nulls and unsupported/unknown provenance", async () => {
  const response = {
    columns: [{ name: "id", dataType: "integer", nullable: false, precision: null, default: null, ignored: "drop" }],
    fieldCapabilities: { length: "unsupported", precision: "unknown", scale: "supported", default: "unknown", future: "ignored" },
    extra: "ignored",
  };
  const result = await runDbxSchemaMetadataProbe(availableHost(async () => response), tableContext);

  assert.equal(result.ok, true);
  assert.deepEqual(result.metadata, {
    columns: [{ name: "id", dataType: "integer", nullable: false, precision: null, default: null }],
    fieldCapabilities: { length: "unsupported", precision: "unknown", scale: "supported", default: "unknown" },
  });
  assert.equal(Object.hasOwn(result.metadata.columns[0], "length"), false);
  for (const field of ["primaryKey", "foreignKey", "unique", "check", "comment", "identity"]) {
    assert.equal(result.futureCapabilities[field].status, "not_exposed");
  }
});

test("metadata request failures distinguish connection, permission, and generic host errors", async () => {
  const cases = [
    ["Connection is not open", ERROR.CONNECTION_NOT_OPEN],
    ["Connection session is not open for the requested database", ERROR.CONNECTION_NOT_OPEN],
    ["Plugin has not declared permission 'host.schema:read'", ERROR.PERMISSION_DENIED],
    ["provider returned an unexpected failure", ERROR.METADATA_REQUEST_FAILED],
  ];
  for (const [message, code] of cases) {
    const result = await runDbxSchemaMetadataProbe(availableHost(async () => { throw new Error(message); }), tableContext);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, code);
    assert.equal(result.diagnostics[0].message, message);
  }
});

test("invalid metadata response has a stable diagnostic and is never fabricated", async () => {
  const result = await runDbxSchemaMetadataProbe(availableHost(async () => ({
    columns: [{ name: "id", dataType: "integer", nullable: "false" }],
    fieldCapabilities: { length: "unknown", precision: "unknown", scale: "unknown", default: "unknown" },
  })), tableContext);

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, ERROR.INVALID_METADATA_RESPONSE);
  assert.equal(Object.hasOwn(result, "metadata"), false);
});

test("one probe performs only one injected public metadata Host API call", async () => {
  const calls = [];
  const host = {
    capabilities: { schemaMetadataApi: true },
    getTableMetadata: async (context) => { calls.push(["getTableMetadata", context]); return metadata; },
  };
  await runDbxSchemaMetadataProbe(host, tableContext);
  assert.deepEqual(calls, [["getTableMetadata", tableContext]]);

  const implementation = await readFile(path.join(root, "src/host/dbx-schema-metadata-probe.mjs"), "utf8");
  const ui = await readFile(path.join(root, "ui/app.mjs"), "utf8");
  const forbidden = /information_schema|pg_catalog|\bSHOW\s+(?:COLUMNS|CREATE\s+TABLE)|\bPRAGMA\s+table_info|new\s+(?:Pool|Client|Connection)\b|createConnection\s*\(|@tauri|tauri::/i;
  assert.equal(forbidden.test(implementation), false);
  assert.equal(forbidden.test(ui), false);
  assert.match(ui, /window\.dbxPlugin/);
});
