import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { probeDbxDataSamples, buildSampleSelectQuery, DATA_SAMPLE_FIELD_MAX_LENGTH, DATA_SAMPLE_ROW_LIMIT, DATA_SAMPLE_TIMEOUT_MS, getSampleProbeCandidates } from "../src/host/dbx-data-sample-probe.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { interpretColumnType } from "../src/schema/schema-interpreter.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";
import { toColumnViewModel } from "../src/workbench/workbench-view-model.mjs";
import { createI18n } from "../src/i18n/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = { connectionId: "connection-A", database: "app", schema: "public", table: "p_admin_user" };
const privateNames = ["张三", "李四", "王小红", "赵六", "钱七"];
const privateStates = ["ACTIVE", "DISABLED", "ACTIVE", "LOCKED", "DISABLED"];
const privateRoles = ["ADMIN", "EDITOR", "ADMIN", "VIEWER", "ADMIN"];

function schemaOf(columns, tableIdentity = "dbx:p_admin_user") {
  return normalizeTableSchema({ tableIdentity, columns }).schema;
}

function sampleTableSchema() {
  return schemaOf([
    { name: "display_name", dataType: "varchar", nullable: false, length: 128 },
    { name: "status", dataType: "varchar", nullable: false, length: 32 },
    { name: "role", dataType: "varchar", nullable: false, length: 32 },
    { name: "email", dataType: "varchar", nullable: true, length: 254 },
    { name: "payload", dataType: "text", nullable: true },
    { name: "picture", dataType: "blob", nullable: true },
    { name: "last_login_at", dataType: "timestamp", nullable: true, precision: 6 },
    { name: "id", dataType: "integer", nullable: false },
  ]);
}

function resultFor(rows) {
  return {
    dbType: "postgres",
    columns: [{ name: "display_name" }, { name: "status" }, { name: "role" }],
    rows,
    truncated: false,
    elapsedMs: 1,
  };
}

function patternRows(names = privateNames, states = privateStates, roles = privateRoles) {
  return names.map((name, index) => [name, states[index], roles[index]]);
}

test("metadata-ready or unsupported columns produce no sampling candidates and no queryData call", async () => {
  let calls = 0;
  const host = { capabilities: { dataApi: true }, queryData: async () => { calls += 1; return resultFor([]); } };
  const metadataSufficient = schemaOf([
    { name: "id", dataType: "integer", nullable: false },
    { name: "name", dataType: "varchar", nullable: false, length: 128 },
    { name: "email", dataType: "varchar", nullable: true, length: 254 },
    { name: "created_at", dataType: "timestamp", nullable: false, precision: 6 },
  ]);
  assert.deepEqual(getSampleProbeCandidates(metadataSufficient), []);
  assert.deepEqual(await probeDbxDataSamples(host, context, metadataSufficient), { sampleUsed: false, evidence: [] });
  assert.equal(calls, 0);

  const tableSchema = sampleTableSchema();
  const candidates = getSampleProbeCandidates(tableSchema);
  assert.deepEqual(candidates, [
    { name: "display_name", kind: "name", sampling: "direct" },
    { name: "status", kind: "enum", sampling: "direct" },
    { name: "role", kind: "enum", sampling: "direct" },
  ]);
  assert.equal(candidates.some(({ name }) => ["payload", "picture", "last_login_at", "id", "email"].includes(name)), false);
});

test("bounded category varchar remains a direct-projection candidate", () => {
  const schema = schemaOf([{ name: "category", dataType: "varchar", nullable: true, length: 64 }]);
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "category", kind: "enum", sampling: "direct" },
  ]);
});

test("native unbounded text admits only existing strong semantic candidates", () => {
  const schema = schemaOf([
    { name: "category", dataType: "text", nullable: true, length: { state: "unavailable", reason: "DBX omitted length metadata" } },
    { name: "status", dataType: "text", nullable: true },
    { name: "role", dataType: "text", nullable: true },
    { name: "type", dataType: "text", nullable: true },
    { name: "display_name", dataType: "text", nullable: true },
    { name: "billing_email", dataType: "text", nullable: true },
    { name: "primary_phone", dataType: "text", nullable: true },
    { name: "description", dataType: "text", nullable: true },
    { name: "content", dataType: "text", nullable: true },
    { name: "remark", dataType: "text", nullable: true },
    { name: "notes", dataType: "text", nullable: true },
    { name: "generic_unknown", dataType: "text", nullable: true },
    { name: "payload", dataType: "text", nullable: true },
    { name: "category_unbounded_varchar", dataType: "varchar", nullable: true, length: { state: "absent" } },
  ]);
  const category = schema.columns.find(({ name }) => name === "category");
  assert.equal(category.length.state, "unavailable");
  assert.deepEqual(interpretColumnType(category), {
    kind: "varchar",
    parameters: {},
    capacity: { model: "unbounded", source: "native-text-type" },
  });
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "category", kind: "enum", sampling: "truncate" },
    { name: "status", kind: "enum", sampling: "truncate" },
    { name: "role", kind: "enum", sampling: "truncate" },
    { name: "type", kind: "enum", sampling: "truncate" },
    { name: "display_name", kind: "name", sampling: "truncate" },
    { name: "billing_email", kind: "email", sampling: "truncate" },
    { name: "primary_phone", kind: "mobile", sampling: "truncate" },
  ]);
});

test("PostgreSQL category text triggers a bounded sample query and summary only", async () => {
  const schema = schemaOf([{
    name: "category",
    dataType: "text",
    nullable: true,
    length: { state: "unavailable", reason: "DBX omitted length metadata" },
  }]);
  const requests = [];
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    async queryData(request) {
      requests.push(request);
      return {
        columns: [{ name: "category" }],
        rows: [["active"], ["active"], ["active"], ["archived"], ["archived"]],
      };
    },
  }, { ...context, table: "audit_results" }, schema);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].maxRows, 8);
  assert.equal(requests[0].timeoutMs, DATA_SAMPLE_TIMEOUT_MS);
  assert.match(requests[0].sql, /^SELECT SUBSTR\(ss\.category, 1, 1024\) AS category FROM audit_results AS ss LIMIT 8$/);
  assert.deepEqual(evidence, {
    sampleUsed: true,
    evidence: [{ column: "category", kind: "enum_like", sampleCount: 5, distinctCount: 2 }],
  });
  assert.doesNotMatch(JSON.stringify(evidence), /active|archived/);
});

test("dataApi capability false gracefully falls back without queryData", async () => {
  let calls = 0;
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: false },
    queryData: async () => { calls += 1; throw new Error("must not call"); },
  }, context, sampleTableSchema());
  assert.deepEqual(result, { sampleUsed: false, evidence: [] });
  assert.equal(calls, 0);
});

test("queryData reads only uncertain candidate columns using bounded rows and timeout", async () => {
  const requests = [];
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    async queryData(request) {
      requests.push(request);
      return resultFor(patternRows());
    },
  }, context, sampleTableSchema(), { timeoutMs: 99_000 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].connectionId, context.connectionId);
  assert.equal(requests[0].database, context.database);
  assert.equal(requests[0].schema, context.schema);
  assert.equal(requests[0].maxRows, DATA_SAMPLE_ROW_LIMIT);
  assert.equal(requests[0].timeoutMs, DATA_SAMPLE_TIMEOUT_MS, "an excessive timeout is clamped to the local bound");
  assert.match(requests[0].sql, /^SELECT ss\.display_name, ss\.status, ss\.role FROM p_admin_user AS ss LIMIT 8$/);
  assert.doesNotMatch(requests[0].sql, /\*|payload|picture|last_login_at|email|id/);
  assert.match(requests[0].sql, /^SELECT\b/i);
  assert.doesNotMatch(requests[0].sql, /;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
  assert.deepEqual(evidence, {
    sampleUsed: true,
    evidence: [
      { column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5 },
      { column: "status", kind: "enum_like", sampleCount: 5, distinctCount: 3 },
      { column: "role", kind: "enum_like", sampleCount: 5, distinctCount: 3 },
    ],
  });
});

test("strongly rejected name patterns counter weak file_name and rule_name aliases", async () => {
  const cases = [
    {
      column: "file_name",
      values: ["foo.sql", "main.py", "UserService.java", "README.md", "schema.json", "data.csv", "index.ts", "Makefile"],
      matchedCount: 0,
    },
    {
      column: "rule_name",
      values: ["null_check", "syntax_rule", "required_field", "duplicate_rule", "unique_key", "not_null", "type_check", "valid_email"],
      matchedCount: 0,
    },
    {
      column: "file_name",
      values: ["张三", "foo.sql", "main.py", "UserService.java", "README.md", "schema.json", "data.csv", "index.ts"],
      matchedCount: 1,
    },
  ];

  for (const { column, values, matchedCount } of cases) {
    const schema = schemaOf([{ name: column, dataType: "varchar", nullable: true, length: 128 }]);
    const result = await probeDbxDataSamples({
      capabilities: { dataApi: true },
      queryData: async () => ({ columns: [{ name: column }], rows: values.map((value) => [value]) }),
    }, context, schema);
    assert.deepEqual(result, {
      sampleUsed: true,
      evidence: [{ column, kind: "chinese_name_pattern_rejected", sampleCount: 8, matchedCount }],
    });
    for (const value of values) assert.equal(JSON.stringify(result).includes(value), false, `sample value ${value} must not escape`);

    const plan = buildGenerationPlan(schema, { rowCount: 2, seed: "negative-name-evidence", sampleEvidence: result.evidence });
    const inferred = plan.columns[0];
    assert.equal(inferred.inference.status, "unknown");
    assert.deepEqual(inferred.inference.candidates, []);
    assert.equal(inferred.semanticMapping.status, "unknown");
    assert.equal(inferred.rule.kind, "varchar");
    assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required"), false);
  }
});

test("mixed pattern samples remain inconclusive and preserve the weak candidate", async () => {
  const schema = schemaOf([{ name: "file_name", dataType: "varchar", nullable: true, length: 128 }]);
  const values = ["张三", "李四", "王小红", "赵六", "foo.sql", "main.py", "rule_x", "README.md"];
  const sampleResult = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns: [{ name: "file_name" }], rows: values.map((value) => [value]) }),
  }, context, schema);
  assert.deepEqual(sampleResult, { sampleUsed: true, evidence: [] });

  const plan = buildGenerationPlan(schema, { rowCount: 2, seed: "mixed-name-evidence", sampleEvidence: sampleResult.evidence });
  assert.equal(plan.columns[0].inference.semanticType, "name");
  assert.equal(plan.columns[0].inference.confidence, "medium");
  assert.equal(plan.columns[0].semanticMapping.status, "needs_confirmation");
});

test("enum sample thresholds stay unchanged while successful evidence-free samples are recorded", async () => {
  const schema = schemaOf([
    { name: "category", dataType: "varchar", nullable: true, length: 32 },
    { name: "status", dataType: "varchar", nullable: true, length: 32 },
  ]);
  const categoryValues = ["dws", "dws", "hive", "python", "sbin", "config", "recv", "dws"];
  const statusValues = ["active", "active", "inactive", "active", "pending", "inactive", "pending", "active"];
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({
      columns: [{ name: "category" }, { name: "status" }],
      rows: categoryValues.map((category, index) => [category, statusValues[index]]),
    }),
  }, context, schema);

  assert.equal(result.sampleUsed, true);
  assert.deepEqual(result.evidence, [{ column: "status", kind: "enum_like", sampleCount: 8, distinctCount: 3 }]);
  const plan = buildGenerationPlan(schema, { rowCount: 2, seed: "enum-threshold", sampleEvidence: result.evidence });
  assert.equal(plan.columns[0].inference.recommendation, null, "category with 8 rows / 6 values stays inconclusive");
  assert.deepEqual(plan.columns[1].inference.recommendation, { kind: "enum", source: "sample_inference" });
});

test("all-NULL and inconsistent name samples do not create inference evidence", async () => {
  const allNull = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => resultFor(Array.from({ length: DATA_SAMPLE_ROW_LIMIT }, () => [null, null, null])),
  }, context, sampleTableSchema());
  assert.deepEqual(allNull, { sampleUsed: false, evidence: [] });

  const mixed = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => resultFor([["张三", "ACTIVE", "ADMIN"], ["A1", "DISABLED", "EDITOR"], ["test", "ACTIVE", "ADMIN"], ["UNKNOWN", "LOCKED", "VIEWER"]]),
  }, context, sampleTableSchema());
  assert.deepEqual(mixed, { sampleUsed: true, evidence: [] });
});

test("permission denial, query errors, and timeout return metadata-only evidence", async () => {
  const denied = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => { throw new Error("PLUGIN_DATA_ACCESS_NOT_GRANTED: private sample detail"); },
  }, context, sampleTableSchema());
  assert.deepEqual(denied, { sampleUsed: false, evidence: [] });

  const errored = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => { throw new Error("query failed"); },
  }, context, sampleTableSchema());
  assert.deepEqual(errored, { sampleUsed: false, evidence: [] });

  const timedOut = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: () => new Promise(() => {}),
  }, context, sampleTableSchema(), { timeoutMs: 1 });
  assert.deepEqual(timedOut, { sampleUsed: false, evidence: [] });
});

test("query builder combines direct and truncated projections while keeping LIMIT 8", () => {
  const query = buildSampleSelectQuery(context, [
    { name: "bounded_field", kind: "enum", sampling: "direct" },
    { name: "category", kind: "enum", sampling: "truncate" },
  ]);
  assert.deepEqual(query, {
    sql: "SELECT ss.bounded_field, SUBSTR(ss.category, 1, 1024) AS category FROM p_admin_user AS ss LIMIT 8",
    columns: ["bounded_field", "category"],
  });
});

test("identifier renderer fails closed for unsafe tables and excludes unsafe columns", async () => {
  const direct = { name: "status", kind: "enum", sampling: "direct" };
  assert.equal(buildSampleSelectQuery({ ...context, table: "users; DROP TABLE accounts" }, [direct]), null);
  assert.equal(buildSampleSelectQuery({ ...context, table: "user" }, [direct]), null);
  assert.equal(buildSampleSelectQuery(context, [{ ...direct, name: "status; DELETE FROM users" }]), null);
  assert.deepEqual(buildSampleSelectQuery(context, [
    direct,
    { name: "status; DELETE FROM users", kind: "enum", sampling: "truncate" },
  ]), {
    sql: "SELECT ss.status FROM p_admin_user AS ss LIMIT 8",
    columns: ["status"],
  });

  let calls = 0;
  const unsafeTableResult = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => { calls += 1; return resultFor([]); },
  }, { ...context, table: "users; DROP TABLE accounts" }, sampleTableSchema());
  assert.deepEqual(unsafeTableResult, { sampleUsed: false, evidence: [] });
  assert.equal(calls, 0, "an unsafe table identifier skips the whole probe");
});

test("sample values longer than 1024 characters cannot enter evidence", async () => {
  const schema = schemaOf([{ name: "category", dataType: "text", nullable: true }]);
  const privateValueA = `private-a-${"x".repeat(DATA_SAMPLE_FIELD_MAX_LENGTH)}`;
  const privateValueB = `private-b-${"y".repeat(DATA_SAMPLE_FIELD_MAX_LENGTH)}`;
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({
      columns: [{ name: "category" }],
      rows: [[privateValueA], [privateValueA], [privateValueB], [privateValueB]],
    }),
  }, context, schema);
  assert.deepEqual(evidence, { sampleUsed: false, evidence: [] });
  assert.doesNotMatch(JSON.stringify(evidence), /private-a|private-b/);
});

test("sample summaries raise display_name confidence but never copy source values into synthetic rows", () => {
  const schema = schemaOf([
    { name: "display_name", dataType: "varchar", nullable: false, length: 128 },
    { name: "status", dataType: "varchar", nullable: false, length: 32 },
    { name: "role", dataType: "varchar", nullable: false, length: 32 },
    { name: "last_login_at", dataType: "timestamp", nullable: false, precision: 6 },
    { name: "amount", dataType: "numeric", nullable: false, precision: 12, scale: 3 },
  ]);
  const sampleEvidence = [
    { column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5 },
    { column: "status", kind: "enum_like", sampleCount: 5, distinctCount: 3 },
    { column: "role", kind: "enum_like", sampleCount: 5, distinctCount: 3 },
  ];
  const plan = buildGenerationPlan(schema, { rowCount: 20, seed: "synthetic-only", sampleEvidence });
  const generated = generateRows(plan);
  const displayName = plan.columns.find((column) => column.schema.name === "display_name");
  assert.equal(displayName.inference.confidence, "high");
  assert.equal(displayName.semanticMapping.selected, true);
  assert.equal(displayName.rule.kind, "semantic:name");
  assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required" && entry.column === "display_name"), false);
  assert.ok(generated.rows.every((row) => !privateNames.includes(row.display_name)));
  assert.ok(generated.rows.every((row) => !privateStates.includes(row.status)));
  assert.ok(generated.rows.every((row) => !privateRoles.includes(row.role)));

  for (const name of ["status", "role"]) {
    const column = plan.columns.find((entry) => entry.schema.name === name);
    assert.equal(column.inference.recommendation.kind, "enum");
    const view = toColumnViewModel(column, plan.diagnostics, { translator: createI18n("zh-CN") });
    assert.equal(view.recommendation.label, "枚举值");
  }
  const timestamp = plan.table.columns.find((column) => column.name === "last_login_at");
  assert.deepEqual(timestamp.precision, { state: "known", value: 6 });
  assert.equal(plan.diagnostics.some((entry) => entry.code === "timestamp_precision_unknown" && entry.column === "last_login_at"), false);
  assert.deepEqual(plan.table.columns.find((column) => column.name === "amount").precision, { state: "known", value: 12 });
  assert.deepEqual(plan.table.columns.find((column) => column.name === "amount").scale, { state: "known", value: 3 });
  assert.doesNotMatch(JSON.stringify(plan), /张三|李四|王小红|赵六|钱七|ACTIVE|DISABLED|LOCKED|ADMIN|EDITOR|VIEWER/);
  assert.doesNotMatch(JSON.stringify(generated.rows), /张三|李四|王小红|赵六|钱七|ACTIVE|DISABLED|LOCKED|ADMIN|EDITOR|VIEWER/);
});

test("controller reports metadata-only when there are no probe candidates", async () => {
  const schema = schemaOf([{ name: "id", dataType: "integer", nullable: false }]);
  let calls = 0;
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    async sampleProbe() { calls += 1; return { sampleUsed: true, evidence: [] }; },
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });
  assert.equal(calls, 0);
  assert.equal(view.sampleUsed, false);
});

test("controller marks valid sample rows as used even when no semantic evidence is produced", async () => {
  const schema = schemaOf([{ name: "category", dataType: "text", nullable: true }]);
  const values = ["dws", "dws", "hive", "python", "sbin", "config", "recv", "dws"];
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    sampleProbe: ({ context: sampleContext, schema: sampleSchema }) => probeDbxDataSamples({
      capabilities: { dataApi: true },
      queryData: async () => ({ columns: [{ name: "category" }], rows: values.map((value) => [value]) }),
    }, sampleContext, sampleSchema),
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });

  assert.equal(view.sampleUsed, true);
  assert.deepEqual(controller.sampleEvidence, []);
  assert.equal(view.columns.find((column) => column.column === "category").recommendation, null);
});

test("Workbench session probes a table once, caches summaries only, and never resamples for UI edits", async () => {
  const schemaA = sampleTableSchema();
  const schemaB = schemaOf([{ name: "display_name", dataType: "varchar", nullable: false, length: 128 }], "dbx:other");
  const sampleCalls = [];
  const previewCalls = [];
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata({ tableContext }) { return tableContext.table === "alpha" ? schemaA : schemaB; } },
    async sampleProbe(request) {
      sampleCalls.push(request.context.table);
      return [{ column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5, values: privateNames }];
    },
    async preview(schema, options) {
      previewCalls.push(structuredClone(options));
      const plan = buildGenerationPlan(schema, options);
      return { plan, generated: generateRows(plan) };
    },
  });

  let view = await controller.setContext({ ...context, table: "alpha" });
  assert.equal(sampleCalls.length, 1);
  assert.equal(view.sampleUsed, true);
  assert.equal(view.columns.find((column) => column.column === "display_name").confidenceKey, "high");
  assert.equal(Object.hasOwn(previewCalls[0].sampleEvidence[0], "values"), false);
  assert.doesNotMatch(JSON.stringify(previewCalls[0].sampleEvidence), /张三|李四|王小红/);

  view = await controller.dispatch({ type: "update-controls", controls: { rowCount: 5, seed: "new-seed", locale: "zh-CN" } });
  assert.equal(sampleCalls.length, 1);
  await controller.setContext({ ...context, table: "alpha" });
  assert.equal(sampleCalls.length, 1);
  await controller.setContext({ ...context, table: "beta" });
  await controller.setContext({ ...context, table: "alpha" });
  assert.deepEqual(sampleCalls, ["alpha", "beta"], "returning to a table reuses the in-session sample evidence");
  assert.ok(previewCalls.every((options) => !JSON.stringify(options.sampleEvidence).includes("张三")));
});

test("raw sample values never reach the Core preview, synthetic rows, or export", async () => {
  const schema = schemaOf([
    { name: "display_name", dataType: "varchar", nullable: false, length: 128 },
    { name: "status", dataType: "varchar", nullable: false, length: 32 },
    { name: "role", dataType: "varchar", nullable: false, length: 32 },
  ]);
  const previewCalls = [];
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    async sampleProbe() {
      return [
        { column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5, values: privateNames },
        { column: "status", kind: "enum_like", sampleCount: 5, distinctCount: 3, values: privateStates },
        { column: "role", kind: "enum_like", sampleCount: 5, distinctCount: 3, values: privateRoles },
      ];
    },
    async preview(tableSchema, options) {
      previewCalls.push(structuredClone(options));
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });
  const privateValues = /张三|李四|王小红|赵六|钱七|ACTIVE|DISABLED|LOCKED|ADMIN|EDITOR|VIEWER/;

  assert.equal(view.export.enabled, true);
  assert.equal(Object.hasOwn(previewCalls[0].sampleEvidence[0], "values"), false);
  assert.doesNotMatch(JSON.stringify(previewCalls[0].sampleEvidence), privateValues);
  assert.doesNotMatch(JSON.stringify(view.preview.rows), privateValues);
  assert.doesNotMatch(controller.prepareExport("json").content, privateValues);
});

test("sample probe failure falls back to a usable metadata-only Workbench preview", async () => {
  const schema = schemaOf([{ name: "status", dataType: "text", nullable: true }]);
  let calls = 0;
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    async sampleProbe({ candidates }) {
      calls += 1;
      assert.deepEqual(candidates, [{ name: "status", kind: "enum", sampling: "truncate" }]);
      throw new Error("PLUGIN_DATA_ACCESS_NOT_GRANTED: private sample details");
    },
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });
  assert.equal(calls, 1);
  assert.equal(view.sampleUsed, false);
  assert.ok(view.preview.rows.length > 0);
  assert.equal(view.export.enabled, true);
  assert.deepEqual(controller.sampleEvidence, []);
  assert.doesNotMatch(JSON.stringify(view), /private sample details|PLUGIN_DATA_ACCESS_NOT_GRANTED/);
});

test("uncertain email and mobile candidates use pattern evidence, never their values", async () => {
  const schema = schemaOf([
    { name: "billing_email", dataType: "varchar", nullable: true, length: 254 },
    { name: "primary_phone", dataType: "varchar", nullable: true, length: 24 },
  ]);
  const sampleEmails = ["person1@example.org", "person2@example.org", "person3@example.org", "person4@example.org"];
  const samplePhones = ["13800000001", "13800000002", "13800000003", "13800000004"];
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "billing_email", kind: "email", sampling: "direct" },
    { name: "primary_phone", kind: "mobile", sampling: "direct" },
  ]);
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({
      columns: [{ name: "billing_email" }, { name: "primary_phone" }],
      rows: sampleEmails.map((email, index) => [email, samplePhones[index]]),
    }),
  }, context, schema);
  assert.deepEqual(evidence, {
    sampleUsed: true,
    evidence: [
      { column: "billing_email", kind: "email_pattern", sampleCount: 4, matchedCount: 4 },
      { column: "primary_phone", kind: "mobile_pattern", sampleCount: 4, matchedCount: 4 },
    ],
  });

  const plan = buildGenerationPlan(schema, { rowCount: 5, seed: "email-mobile-synthetic", sampleEvidence: evidence.evidence });
  const generated = generateRows(plan);
  for (const name of ["billing_email", "primary_phone"]) {
    const column = plan.columns.find((entry) => entry.schema.name === name);
    assert.equal(column.semanticMapping.selected, true);
    assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required" && entry.column === name), false);
  }
  assert.ok(generated.rows.every((row) => !sampleEmails.includes(row.billing_email)));
  assert.ok(generated.rows.every((row) => !samplePhones.includes(row.primary_phone)));
  assert.doesNotMatch(JSON.stringify(plan), /person1@example\.org|13800000001/);
});

test("sample evidence adds no raw values to logs or durable storage", async () => {
  const source = await readFile(path.join(root, "src/host/dbx-data-sample-probe.mjs"), "utf8");
  const app = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
  assert.doesNotMatch(source, /console\.(?:log|debug|info|warn|error)|localStorage|sessionStorage|telemetry|analytics|fetch\s*\(/i);
  assert.doesNotMatch(app, /console\.(?:log|debug|info|warn|error)|localStorage\.setItem\([^)]*sample/i);
});
