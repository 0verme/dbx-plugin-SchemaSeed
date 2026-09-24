import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { DbxHostSchemaMetadataError, DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tableContext = { connectionId: "dbx-connection-1", database: "app", schema: "public", table: "customer" };

function hostFor(response, calls = []) {
  return {
    capabilities: { schemaMetadataApi: true },
    async getTableMetadata(context) {
      calls.push(context);
      return response;
    },
  };
}

function response(columns, fieldCapabilities = {
  length: "supported",
  precision: "supported",
  scale: "supported",
  default: "supported",
}) {
  return { columns, fieldCapabilities };
}

test("production provider preserves optional values, availability, and DBX capability provenance", async () => {
  const schema = await new DbxHostSchemaMetadataProvider(hostFor(response([
    { name: "explicit_null", dataType: "VARCHAR", nullable: true, length: null, default: null },
    { name: "omitted", dataType: "INTEGER", nullable: false },
    { name: "actual_zero", dataType: "INTEGER", nullable: false, precision: 0, default: "" }
  ], { length: "supported", precision: "unknown", scale: "unsupported", default: "supported" })))
    .getTableMetadata({ tableContext });

  const [explicitNull, omitted, actualZero] = schema.columns;
  assert.equal(explicitNull.nullable.value, true);
  assert.deepEqual(explicitNull.length, {
    state: "absent",
    reason: "DBX explicitly returned null for length.",
    provenance: "DBX Host API 1.3 fieldCapabilities.length=supported; column.length=null",
  });
  assert.equal(explicitNull.default.state, "absent");
  assert.deepEqual(omitted.length, {
    state: "unavailable",
    reason: "DBX supports length metadata but omitted it for this column.",
    provenance: "DBX Host API 1.3 fieldCapabilities.length=supported; column.length=omitted",
  });
  assert.equal(omitted.precision.state, "unknown");
  assert.equal(omitted.scale.state, "unsupported");
  assert.equal(actualZero.precision.value, 0);
  assert.deepEqual(actualZero.default, {
    state: "known",
    value: "",
    provenance: "DBX Host API 1.3 fieldCapabilities.default=supported; column.default=present",
  });
  assert.equal(schema.columns[0].identity.state, "unknown");
  assert.equal(schema.columns[0].identity.provenance, "DBX Host API 1.3 identity=not_exposed");
  assert.equal(schema.columns[0].identity.reason, "Identity metadata is not exposed by DBX Host API 1.3.");
});

test("unknown capability plus null stays unknown, while a supplied value remains known", async () => {
  const schema = await new DbxHostSchemaMetadataProvider(hostFor(response([
    { name: "unknown_null", dataType: "VARCHAR", nullable: false, length: null },
    { name: "observed_value", dataType: "VARCHAR", nullable: false, length: 12 },
  ], { length: "unknown", precision: "unknown", scale: "unknown", default: "unknown" })))
    .getTableMetadata({ tableContext });

  assert.equal(schema.columns[0].length.state, "unknown");
  assert.match(schema.columns[0].length.reason, /does not know/);
  assert.equal(schema.columns[1].length.state, "known");
  assert.equal(schema.columns[1].length.value, 12);
  assert.match(schema.columns[1].length.provenance, /fieldCapabilities.length=unknown/);
});

test("production provider rejects contradictory capability values instead of silently remapping them", async () => {
  const provider = new DbxHostSchemaMetadataProvider(hostFor(response([
    { name: "value", dataType: "VARCHAR", nullable: false, length: 10 },
  ], { length: "unsupported", precision: "unknown", scale: "unknown", default: "unknown" })));

  await assert.rejects(provider.getTableMetadata({ tableContext }), (error) => {
    assert.ok(error instanceof DbxHostSchemaMetadataError);
    assert.equal(error.diagnostic.code, "metadata_invalid_response");
    assert.match(error.diagnostic.reason, /unsupported but column value provides a value/);
    assert.equal(error.diagnostic.blocking, true);
    return true;
  });
});

test("MySQL, PostgreSQL, and SQLite contract schemas flow through planning and generation", async (t) => {
  const cases = [
    {
      name: "MySQL",
      response: response([
        { name: "id", dataType: "int", nullable: false, default: null },
        { name: "label", dataType: "varchar", nullable: true, length: 32, default: "guest" },
        { name: "amount", dataType: "decimal", nullable: false, precision: 8, scale: 2, default: null },
      ]),
      expectedStatus: "ready",
    },
    {
      name: "PostgreSQL",
      response: response([
        { name: "id", dataType: "bigint", nullable: false, default: null },
        { name: "amount", dataType: "numeric", nullable: false, precision: 10, scale: 3, default: null },
        { name: "happened_at", dataType: "timestamp", nullable: false, precision: 6, default: null },
      ]),
      expectedStatus: "ready",
    },
    {
      name: "SQLite",
      response: response([
        { name: "id", dataType: "integer", nullable: false, default: null },
        { name: "label", dataType: "text", nullable: true, default: "untitled" },
      ], { length: "unsupported", precision: "unsupported", scale: "unsupported", default: "supported" }),
      expectedStatus: "blocked",
    },
  ];

  for (const contract of cases) {
    await t.test(contract.name, async () => {
      const calls = [];
      const provider = new DbxHostSchemaMetadataProvider(hostFor(contract.response, calls));
      const schema = await provider.getTableMetadata({ tableContext });
      const plan = buildGenerationPlan(schema, { rowCount: 8, seed: `contract-${contract.name}` });
      const generated = generateRows(plan);

      assert.equal(plan.table.tableIdentity, schema.tableIdentity);
      assert.equal(generated.status, contract.expectedStatus);
      assert.deepEqual(calls, [tableContext]);
      if (contract.name === "SQLite") {
        const label = schema.columns.find((column) => column.name === "label");
        assert.equal(label.length.state, "unsupported");
        assert.equal(label.length.value, undefined);
        assert.equal(plan.diagnostics.some((diagnostic) => diagnostic.code === "varchar_length_unknown"), true);
        assert.deepEqual(generated.rows, []);
      } else {
        assert.equal(generated.rows.length, 8);
        assert.equal(generated.rows[0].id !== undefined, true);
      }
    });
  }
});

test("TableContext is passed identity-only and scope contributes to stable domain identity", async () => {
  const calls = [];
  const provider = new DbxHostSchemaMetadataProvider(hostFor(response([
    { name: "id", dataType: "integer", nullable: false },
  ]), calls));
  const schema = await provider.getTableMetadata({ tableContext: { connectionId: "conn", table: "orders" } });

  assert.deepEqual(calls, [{ connectionId: "conn", table: "orders" }]);
  assert.match(schema.tableIdentity, /^dbx:/);
  assert.notEqual(schema.tableIdentity, (await new DbxHostSchemaMetadataProvider(hostFor(response([
    { name: "id", dataType: "integer", nullable: false },
  ]))).getTableMetadata({ tableContext: { connectionId: "other", table: "orders" } })).tableIdentity);
});

test("capability, permission, connection, context, and invalid-response failures are actionable diagnostics", async () => {
  const cases = [
    {
      host: { capabilities: { schemaMetadataApi: false }, getTableMetadata: async () => assert.fail("must not call Host API") },
      code: "metadata_capability_unavailable",
      action: /Host API 1\.3/,
      severity: "unsupported",
    },
    {
      host: { capabilities: { schemaMetadataApi: true }, getTableMetadata: async () => { throw new Error("Plugin has not declared permission 'host.schema:read'"); } },
      code: "metadata_permission_denied",
      action: /host\.schema:read/,
      severity: "error",
    },
    {
      host: { capabilities: { schemaMetadataApi: true }, getTableMetadata: async () => { throw new Error("Connection is not open"); } },
      code: "metadata_connection_not_open",
      action: /does not reconnect/,
      severity: "error",
    },
    {
      host: hostFor({ columns: [{ name: "id", dataType: "integer", nullable: "false" }], fieldCapabilities: { length: "supported", precision: "supported", scale: "supported", default: "supported" } }),
      code: "metadata_invalid_response",
      action: /response contract/,
      severity: "error",
    },
  ];

  for (const entry of cases) {
    await assert.rejects(new DbxHostSchemaMetadataProvider(entry.host).getTableMetadata({ tableContext }), (error) => {
      assert.ok(error instanceof DbxHostSchemaMetadataError);
      assert.equal(error.diagnostic.code, entry.code);
      assert.equal(error.diagnostic.severity, entry.severity);
      assert.match(error.diagnostic.reason, entry.action);
      assert.equal(error.diagnostic.table, "customer");
      assert.equal(error.diagnostic.blocking, true);
      return true;
    });
  }
});

test("missing TableContext fails before Host access and never falls back to fixtures", async () => {
  let calls = 0;
  const provider = new DbxHostSchemaMetadataProvider({
    capabilities: { schemaMetadataApi: true },
    async getTableMetadata() { calls += 1; return response([{ name: "id", dataType: "integer", nullable: false }]); },
  });
  await assert.rejects(provider.getTableMetadata({}), (error) => {
    assert.equal(error.diagnostic.code, "table_context_invalid");
    return true;
  });
  assert.equal(calls, 0);

  const providerSource = await readFile(path.join(root, "src/providers/dbx-host-schema-metadata-provider.mjs"), "utf8");
  const coreSource = await Promise.all([
    readFile(path.join(root, "src/generation/generation-plan.mjs"), "utf8"),
    readFile(path.join(root, "src/generation/generation-engine.mjs"), "utf8"),
  ]);
  assert.doesNotMatch(providerSource, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider/);
  assert.doesNotMatch(providerSource, /window\.dbxPlugin|information_schema|pg_catalog|\bSHOW\s|\bPRAGMA\b|credential|private store|private frontend|new\s+(?:Pool|Client|Connection)\b|createConnection\s*\(|@tauri|tauri::/i);
  assert.doesNotMatch(coreSource.join("\n"), /window\.dbxPlugin|getTableMetadata|DbxHostSchemaMetadataProvider|fieldCapabilities/);
});

test("SchemaFact normalization retains all domain states and source provenance", () => {
  const states = ["absent", "not_applicable", "unknown", "unavailable", "unsupported", "failed"];
  const { schema } = normalizeTableSchema({
    tableIdentity: "provenance",
    columns: [
      { name: "known", dataType: { state: "known", value: "text", provenance: "host:dataType" } },
      ...states.map((state) => ({
        name: state,
        dataType: { state, reason: `reason:${state}`, provenance: `host:${state}` },
      })),
    ],
  });
  assert.equal(schema.columns[0].dataType.provenance, "host:dataType");
  for (const [index, state] of states.entries()) {
    assert.equal(schema.columns[index + 1].dataType.state, state);
    assert.equal(schema.columns[index + 1].dataType.provenance, `host:${state}`);
  }
});
