import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { exportCsv } from "../src/export/csv-exporter.mjs";
import { createExportDataset } from "../src/export/export-dataset.mjs";
import { exportJson } from "../src/export/json-exporter.mjs";
import { exportInsertSql } from "../src/export/sql-exporter.mjs";
import { describeConstraintDomain } from "../src/generation/constraint-domain.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import { probeDbxDataSamples, getSampleProbeCandidates } from "../src/host/dbx-data-sample-probe.mjs";
import { isSensitiveSampleColumn } from "../src/semantic/sample-evidence.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";
import { toColumnViewModel } from "../src/workbench/workbench-view-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures/samples/audit_results.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const schema = normalizeTableSchema(fixture.schema).schema;
const tableContext = { connectionId: "fixture-connection", database: "analytics", schema: "public", table: "audit_results" };

async function profileFixture() {
  const candidates = getSampleProbeCandidates(schema);
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    async queryData(request) {
      assert.equal(request.maxRows, 8);
      assert.equal(request.timeoutMs, 3_000);
      assert.doesNotMatch(request.sql, /\bid\b|task_id|message/);
      return {
        columns: candidates.map(({ name }) => ({ name })),
        rows: fixture.sampleRows.slice(0, 8).map((row) => candidates.map(({ name }) => row[name])),
      };
    },
  }, tableContext, schema);
  return { candidates, result };
}

test("audit_results golden profile selects categorical, numeric-range, and filename strategies", async () => {
  const { candidates, result } = await profileFixture();
  assert.deepEqual(candidates.map(({ name, kind }) => [name, kind]), [
    ["category", "text"], ["file_name", "filename"], ["line_no", "numeric"],
    ["rule_name", "name"], ["level", "text"],
  ]);
  assert.deepEqual(result.evidence.filter(({ column }) => ["category", "level"].includes(column)).map(({ column, candidates: labels }) => ({
    column,
    values: labels.map(({ value }) => value),
  })), [
    { column: "category", values: ["dws", "hive", "python", "sbin", "config", "recv"] },
    { column: "level", values: ["err", "warn", "info"] },
  ]);

  const options = { rowCount: 20, seed: "audit-results-golden", locale: "zh-CN", sampleEvidence: result.evidence };
  const plan = buildGenerationPlan(schema, options);
  const generated = generateRows(plan);
  const replay = generateRows(buildGenerationPlan(schema, options));
  assert.equal(generated.status, "ready");
  assert.deepEqual(generated.rows, replay.rows, "the same seed replays sample-derived generation exactly");

  const columnPlan = (name) => plan.columns.find((entry) => entry.schema.name === name);
  assert.equal(columnPlan("category").rule.kind, "sample_enum");
  assert.equal(columnPlan("category").rule.source, "sample_inference");
  assert.deepEqual(columnPlan("category").rule.parameters.candidates, [
    { value: "dws", frequency: 3 }, { value: "hive", frequency: 1 }, { value: "python", frequency: 1 },
    { value: "sbin", frequency: 1 }, { value: "config", frequency: 1 }, { value: "recv", frequency: 1 },
  ]);
  assert.equal(columnPlan("level").rule.kind, "sample_enum");
  assert.equal(columnPlan("level").rule.source, "sample_inference");
  assert.equal(columnPlan("line_no").rule.kind, "sample_numeric");
  assert.equal(columnPlan("line_no").rule.source, "sample_inference");
  assert.deepEqual({
    min: columnPlan("line_no").rule.parameters.min,
    max: columnPlan("line_no").rule.parameters.max,
    zeroCount: columnPlan("line_no").rule.parameters.zeroCount,
    sampleCount: columnPlan("line_no").rule.parameters.sampleCount,
  }, { min: 0, max: 88, zeroCount: 1, sampleCount: 8 });
  assert.equal(columnPlan("file_name").rule.kind, "sample_filename");
  assert.equal(columnPlan("file_name").rule.source, "sample_inference");
  assert.equal(columnPlan("rule_name").rule.kind, "varchar", "sensitive semantic labels keep their synthetic fallback");
  const zh = createI18n("zh-CN");
  assert.equal(toColumnViewModel(columnPlan("category"), plan.diagnostics, { translator: zh }).recommendation.label, "枚举值");
  assert.equal(toColumnViewModel(columnPlan("line_no"), plan.diagnostics, { translator: zh }).recommendation.label, "样本范围");
  assert.equal(toColumnViewModel(columnPlan("file_name"), plan.diagnostics, { translator: zh }).recommendation.label, "采样文件名");
  assert.equal(toColumnViewModel(columnPlan("line_no"), plan.diagnostics, { translator: zh }).mappingStatusToken, "sampleStrategy");

  const categories = new Set(["dws", "hive", "python", "sbin", "config", "recv"]);
  const levels = new Set(["err", "warn", "info"]);
  const suffixes = new Set([".sql", ".hql", ".py", ".sh", ".json"]);
  for (const row of generated.rows) {
    assert.ok(categories.has(row.category), `unexpected category ${String(row.category)}`);
    assert.ok(levels.has(row.level), `unexpected level ${String(row.level)}`);
    assert.ok(Number.isInteger(row.line_no) && row.line_no >= 0 && row.line_no <= 88);
    assert.match(row.file_name, /^generated_[A-Za-z0-9]+\.[a-z0-9]+$/u);
    assert.ok(suffixes.has(row.file_name.slice(row.file_name.lastIndexOf("."))));
  }
  const sourceNames = fixture.sampleRows.map((row) => row.file_name);
  assert.ok(generated.rows.every((row) => !sourceNames.includes(row.file_name)), "source file stems are never copied");
  assert.doesNotMatch(JSON.stringify(plan), /null_check|syntax_rule|required_field|duplicate_rule|unique_key|not_null|type_check|valid_email|synthetic fixture message/);
  assert.doesNotMatch(JSON.stringify(generated.rows), /null_check|syntax_rule|required_field|duplicate_rule|unique_key|not_null|type_check|valid_email|synthetic fixture message/);
});

test("no sample and inconclusive profiles preserve generic fallback; explicit rules stay highest priority", async () => {
  const fallback = buildGenerationPlan(schema, { rowCount: 8, seed: "no-sample" });
  for (const name of ["category", "file_name", "level"]) assert.equal(fallback.columns.find((column) => column.schema.name === name).rule.kind, "varchar");
  assert.equal(fallback.columns.find((column) => column.schema.name === "line_no").rule.kind, "integer");
  assert.ok(fallback.columns.every((column) => column.rule.source !== "sample_inference"));

  const allDistinct = {
    column: "category",
    kind: "enum_like",
    sampleCount: 8,
    distinctCount: 8,
    candidates: ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"].map((value) => ({ value, frequency: 1 })),
  };
  const conservative = buildGenerationPlan(schema, { rowCount: 8, seed: "weak-sample", sampleEvidence: [allDistinct] });
  assert.equal(conservative.columns.find((column) => column.schema.name === "category").rule.kind, "varchar");

  const shortFilename = normalizeTableSchema({
    tableIdentity: "short-file-name",
    columns: [{ name: "file_name", dataType: "varchar", length: 12, nullable: false }],
  }).schema;
  const incompatible = buildGenerationPlan(shortFilename, {
    rowCount: 4,
    seed: "too-short-for-generated-stem",
    sampleEvidence: [{
      column: "file_name", kind: "filename_pattern", sampleCount: 4, matchedCount: 4,
      suffixes: [{ suffix: ".sql", frequency: 4 }],
    }],
  });
  assert.equal(incompatible.columns[0].rule.kind, "varchar");
  assert.equal(incompatible.columns[0].inference.recommendation, null);

  const unknownType = normalizeTableSchema({
    tableIdentity: "unknown-profile-type",
    columns: [{ name: "category", dataType: { state: "unknown", reason: "test metadata unavailable" }, nullable: false }],
  }).schema;
  const unknownPlan = buildGenerationPlan(unknownType, {
    rowCount: 4,
    seed: "unknown-profile-type",
    sampleEvidence: [{
      column: "category", kind: "enum_like", sampleCount: 4, distinctCount: 2,
      candidates: [{ value: "active", frequency: 3 }, { value: "closed", frequency: 1 }],
    }],
  });
  assert.notEqual(unknownPlan.columns[0].rule.source, "sample_inference");

  const sampled = await profileFixture();
  const explicit = buildGenerationPlan(schema, {
    rowCount: 8,
    seed: "explicit-over-sample",
    sampleEvidence: sampled.result.evidence,
    rules: { category: { kind: "constant", value: "manual" } },
  });
  const category = explicit.columns.find((column) => column.schema.name === "category");
  assert.equal(category.rule.kind, "constant");
  assert.equal(category.rule.source, "explicit_user_rule");
  assert.ok(generateRows(explicit).rows.every((row) => row.category === "manual"));

  const semanticSchema = normalizeTableSchema({
    tableIdentity: "confirmed-semantic-before-sample",
    columns: [{ name: "display_name", dataType: "varchar", length: 128, nullable: false }],
  }).schema;
  const confirmedSemantic = buildGenerationPlan(semanticSchema, {
    rowCount: 4,
    seed: "confirmed-semantic-over-sample",
    semanticMappings: { display_name: "name" },
    sampleEvidence: [{
      column: "display_name", kind: "enum_like", sampleCount: 4, distinctCount: 2,
      candidates: [{ value: "alice", frequency: 2 }, { value: "bob", frequency: 2 }],
    }],
  });
  assert.equal(confirmedSemantic.columns[0].rule.kind, "semantic:name");
  assert.equal(confirmedSemantic.columns[0].rule.source, "confirmed_semantic_mapping");
  assert.notEqual(confirmedSemantic.columns[0].rule.kind, "sample_enum");
});

test("numeric profile domains account for observed zero availability before unique allocation", () => {
  const withoutZero = describeConstraintDomain({
    schema: {},
    rule: { kind: "sample_numeric", parameters: { numericKind: "integer", min: -2, max: 2, zeroCount: 0, sampleCount: 4 } },
  }, 4);
  assert.equal(withoutZero.capacity, 4n);
  assert.deepEqual(Array.from({ length: Number(withoutZero.capacity) }, (_value, index) => withoutZero.decode(BigInt(index))), [-2, -1, 1, 2]);

  const withZero = describeConstraintDomain({
    schema: {},
    rule: { kind: "sample_numeric", parameters: { numericKind: "integer", min: -2, max: 2, zeroCount: 1, sampleCount: 4 } },
  }, 4);
  assert.equal(withZero.capacity, 5n);
  assert.deepEqual(Array.from({ length: Number(withZero.capacity) }, (_value, index) => withZero.decode(BigInt(index))), [-2, -1, 0, 1, 2]);
});

test("sensitive and identifier-like columns cannot use observed categorical values", () => {
  const sensitiveSchema = normalizeTableSchema({
    tableIdentity: "privacy-guard",
    columns: [
      { name: "email", dataType: "varchar", length: 128, nullable: false },
      { name: "username", dataType: "varchar", length: 128, nullable: false },
      { name: "password", dataType: "varchar", length: 128, nullable: false },
      { name: "token", dataType: "varchar", length: 128, nullable: false },
      { name: "access_token", dataType: "varchar", length: 128, nullable: false },
      { name: "account_number", dataType: "varchar", length: 32, nullable: false },
      { name: "account_balance", dataType: "decimal", precision: 12, scale: 2, nullable: false },
      { name: "personal_name", dataType: "varchar", length: 64, nullable: false },
      { name: "mobile_phone", dataType: "varchar", length: 32, nullable: false },
      { name: "home_address", dataType: "varchar", length: 128, nullable: false },
      { name: "business_uuid", dataType: "varchar", length: 128, nullable: false },
      { name: "customer_code", dataType: "varchar", length: 32, nullable: false },
      { name: "user_id", dataType: "integer", nullable: false },
      { name: "file_id", dataType: "varchar", length: 128, nullable: false },
      { name: "safe_label", dataType: "varchar", length: 32, nullable: false },
    ],
  }).schema;
  const secretCandidates = ["alice", "bob"].map((value) => ({ value, frequency: 2 }));
  const sampleEvidence = [
    "email", "username", "password", "token", "access_token", "account_number", "personal_name", "mobile_phone", "home_address",
    "business_uuid", "customer_code", "user_id", "file_id",
  ].map((column) => ({
    column,
    kind: column === "file_id" ? "filename_pattern" : "enum_like",
    sampleCount: 4,
    distinctCount: 2,
    matchedCount: 4,
    candidates: secretCandidates,
    suffixes: [{ suffix: ".csv", frequency: 4 }],
  }));
  sampleEvidence.push({ column: "account_balance", kind: "numeric_range", sampleCount: 4, min: "1.00", max: "9.00", zeroCount: 0 });
  sampleEvidence.push({ column: "safe_label", kind: "enum_like", sampleCount: 4, distinctCount: 2, candidates: [
    { value: "open", frequency: 3 }, { value: "closed", frequency: 1 },
  ] });

  const plan = buildGenerationPlan(sensitiveSchema, { rowCount: 8, seed: "sensitive-sample", sampleEvidence });
  for (const name of [
    "email", "username", "password", "token", "access_token", "account_number", "personal_name", "mobile_phone", "home_address",
    "business_uuid", "customer_code", "user_id", "file_id", "account_balance",
  ]) {
    const column = plan.columns.find((entry) => entry.schema.name === name);
    assert.notEqual(column.rule.source, "sample_inference", name);
    assert.notEqual(column.rule.kind, "sample_enum", name);
    assert.notEqual(column.rule.kind, "sample_filename", name);
    if (["username", "email", "token", "password", "account_number"].includes(name)) {
      assert.equal(isSensitiveSampleColumn(name), true);
      assert.equal(column.rule.source, "schema_type_fallback");
    }
  }
  assert.notEqual(plan.columns.find((entry) => entry.schema.name === "account_balance").rule.kind, "sample_numeric");
  assert.equal(plan.columns.find((entry) => entry.schema.name === "safe_label").rule.kind, "sample_enum");
  const generated = generateRows(plan).rows;
  const serialized = JSON.stringify({ plan, generated });
  assert.doesNotMatch(serialized, /alice|bob/);
  assert.ok(generated.every((row) => !["alice", "bob"].includes(row.email)));
  assert.ok(generated.every((row) => !["alice", "bob"].includes(row.access_token)));
});

test("preview and CSV/JSON/INSERT SQL exports serialize the same sample-derived dataset", async () => {
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    translator: createI18n("zh-CN"),
    sampleProbe: ({ context, schema: sampleSchema }) => probeDbxDataSamples({
      capabilities: { dataApi: true },
      async queryData() {
        const candidates = getSampleProbeCandidates(sampleSchema);
        return {
          columns: candidates.map(({ name }) => ({ name })),
          rows: fixture.sampleRows.map((row) => candidates.map(({ name }) => row[name])),
        };
      },
    }, context, sampleSchema),
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext(tableContext);
  const generated = generateRows(controller.plan);
  const expected = createExportDataset(controller.plan, generated, { table: tableContext });
  assert.deepEqual(view.preview.rows, generated.rows);
  assert.equal(controller.prepareExport("json").content, exportJson(expected));
  assert.equal(controller.prepareExport("csv").content, exportCsv(expected, { header: true, mode: "spreadsheet_safe", bom: true }));
  assert.equal(controller.prepareExport("sql").content, exportInsertSql(expected, { header: true }));
});
