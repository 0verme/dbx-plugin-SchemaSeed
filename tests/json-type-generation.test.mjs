import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { exportCsv } from "../src/export/csv-exporter.mjs";
import { createExportDataset } from "../src/export/export-dataset.mjs";
import { exportJson } from "../src/export/json-exporter.mjs";
import { exportInsertSql } from "../src/export/sql-exporter.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { executeGenerationPreview } from "../src/generation/generation-runtime.mjs";
import { getCompatibleGenerationRules } from "../src/generation/generation-rules.mjs";
import { probeDbxDataSamples } from "../src/host/dbx-data-sample-probe.mjs";
import {
  isJsonDocumentValue,
  serializeJsonDocumentValue,
  unwrapJsonDocumentValue,
} from "../src/json-document.mjs";
import { DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { interpretColumnType } from "../src/schema/schema-interpreter.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";

const CONTEXT = Object.freeze({ connectionId: "mock-connection", database: "mock_db", table: "empty_json_table" });

function jsonSchema(columns, tableIdentity = "mock:json") {
  return { tableIdentity, columns };
}

function runCore(schema, options = {}) {
  const plan = buildGenerationPlan(schema, { rowCount: 50, seed: "json-seed", ...options });
  const generated = generateRows(plan);
  return { plan, generated };
}

function rowPayload(row, column) {
  assert.ok(isJsonDocumentValue(row[column]), `${column} is a typed JSON document, not SQL NULL`);
  return unwrapJsonDocumentValue(row[column]);
}

function jsonHostResponse(columns) {
  return {
    columns,
    fieldCapabilities: { length: "supported", precision: "supported", scale: "supported", default: "supported" },
  };
}

function corePreview(schema, options) {
  const result = executeGenerationPreview(schema, options);
  // Production preview responses cross a JSON-compatible runtime boundary.
  return JSON.parse(JSON.stringify(result));
}

describe("MySQL JSON schema generation", () => {
  it("preserves raw DBX json metadata and enters the schema fallback path", async () => {
    const provider = new DbxHostSchemaMetadataProvider({
      capabilities: { schemaMetadataApi: true },
      async getTableMetadata() {
        return jsonHostResponse([
          { name: "payload", dataType: "json", nullable: false, default: null },
        ]);
      },
    });
    const schema = await provider.getTableMetadata({ tableContext: CONTEXT });
    const type = interpretColumnType(schema.columns[0]);
    const { plan, generated } = runCore(schema, { sampleEvidence: [] });

    assert.equal(schema.columns[0].dataType.value, "json");
    assert.equal(type.kind, "json");
    assert.equal(plan.status, "ready");
    assert.equal(plan.columns[0].rule.kind, "json");
    assert.equal(plan.diagnostics.some(({ code }) => code === "unsupported_type"), false);
    assert.equal(generated.status, "ready");
    assert.equal(generated.rows.length, 50);
    assert.ok(generated.rows.every((row) => isJsonDocumentValue(row.payload)));

    const overriddenPlan = buildGenerationPlan(schema, {
      rowCount: 10,
      seed: "legacy-json-override",
      overrides: { payload: { type: "json", nullProbability: 0 } },
    });
    const overridden = generateRows(overriddenPlan);
    assert.equal(overriddenPlan.status, "ready");
    assert.equal(overridden.status, "ready");
    assert.ok(overridden.rows.every((row) => isJsonDocumentValue(row.payload)));
  });

  it("generates empty-source mixed schemas with nullable, NOT NULL, and multiple JSON fields", () => {
    const schema = jsonSchema([
      { name: "id", dataType: "int", nullable: false },
      { name: "required_payload", dataType: "json", nullable: false },
      { name: "optional_payload", dataType: "JSON", nullable: true },
      { name: "other_payload", dataType: "json", nullable: false },
      { name: "label", dataType: "varchar(12)", nullable: false },
    ]);
    const options = { rowCount: 50, seed: "empty-source", sampleEvidence: [] };
    const first = runCore(schema, options);
    const replay = runCore(schema, options);
    const differentSeed = runCore(schema, { ...options, seed: "another-empty-source" });

    assert.equal(first.plan.status, "ready");
    assert.equal(first.generated.status, "ready");
    assert.equal(first.generated.rows.length, 50);
    assert.deepEqual(first.generated.rows, replay.generated.rows);
    assert.notDeepEqual(first.generated.rows, differentSeed.generated.rows);
    assert.ok(first.generated.rows.every((row) => Number.isSafeInteger(row.id)));
    assert.ok(first.generated.rows.every((row) => isJsonDocumentValue(row.required_payload)));
    assert.ok(first.generated.rows.every((row) => row.optional_payload === null || isJsonDocumentValue(row.optional_payload)));
    assert.ok(first.generated.rows.every((row) => isJsonDocumentValue(row.other_payload)));
    assert.ok(first.generated.rows.every((row) => typeof row.label === "string" && row.label.length <= 12));
    assert.deepEqual(getCompatibleGenerationRules(first.plan.columns[1].schema).filter((kind) => kind !== "auto"), ["constant", "enum", "null_ratio"]);
  });

  it("generates deterministic JSON values from every supported root JSON type", () => {
    const { plan, generated } = runCore(jsonSchema([
      { name: "payload", dataType: "json", nullable: false },
    ]), { rowCount: 1_000, seed: "all-json-root-kinds", sampleEvidence: [] });
    assert.equal(plan.status, "ready");
    assert.equal(generated.status, "ready");

    const kinds = new Set();
    for (const row of generated.rows) {
      const value = rowPayload(row, "payload");
      kinds.add(value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
      const encoded = serializeJsonDocumentValue(row.payload);
      assert.deepEqual(JSON.parse(encoded), value);
      assert.doesNotMatch(encoded, /undefined|NaN/u);
    }
    assert.deepEqual([...kinds].sort(), ["array", "boolean", "null", "number", "object", "string"]);
    assert.ok(generated.rows.some((row) => Array.isArray(rowPayload(row, "payload"))));
    assert.ok(generated.rows.some((row) => {
      const value = rowPayload(row, "payload");
      return value && !Array.isArray(value) && Array.isArray(value.values);
    }), "generated objects contain deterministic nested values");
  });

  it("accepts explicit constants and enums for nested objects, arrays, strings, numbers, booleans, and JSON null", () => {
    const values = [
      { nested: ["逗号,引号\"", { enabled: true, missing: null }] },
      [1, false, "中文🙂"],
      "root string",
      42.125,
      false,
      null,
    ];
    for (const [index, value] of values.entries()) {
      const schema = jsonSchema([{ name: `payload_${index}`, dataType: "json", nullable: false }], `explicit-json-${index}`);
      const plan = buildGenerationPlan(schema, {
        rowCount: 1,
        seed: `explicit-${index}`,
        rules: { [`payload_${index}`]: { kind: "constant", value } },
      });
      const generated = generateRows(plan);
      assert.equal(plan.status, "ready", JSON.stringify(value));
      assert.equal(generated.status, "ready", JSON.stringify(value));
      assert.deepEqual(plan.columns[0].generationRule.value, value, "the rule editor retains structured JSON constants");
      assert.deepEqual(plan.columns[0].ruleFields[0].value, value, "the JSON editor receives the original structured value");
      assert.deepEqual(rowPayload(generated.rows[0], `payload_${index}`), value);
    }

    const enumValues = [{ b: 2, a: 1 }, ["array"], "text", 7, true, null];
    const enumSchema = jsonSchema([{ name: "payload", dataType: "json", nullable: false }], "json-enum");
    const enumPlan = buildGenerationPlan(enumSchema, {
      rowCount: 80,
      seed: "json-enum-seed",
      rules: { payload: { kind: "enum", values: enumValues } },
    });
    const enumRows = generateRows(enumPlan);
    assert.equal(enumPlan.status, "ready");
    assert.equal(enumRows.status, "ready");
    assert.ok(enumRows.rows.every((row) => enumValues.some((value) => isDeepStrictEqual(value, rowPayload(row, "payload")))));

    const badValues = [Number.NaN, undefined, 1n, new Date("2025-01-01T00:00:00Z")];
    const cyclic = {};
    cyclic.self = cyclic;
    badValues.push(cyclic);
    for (const [index, value] of badValues.entries()) {
      const plan = buildGenerationPlan(enumSchema, {
        rowCount: 1,
        seed: `invalid-json-${index}`,
        rules: { payload: { kind: "constant", value } },
      });
      assert.equal(plan.status, "blocked");
      assert.equal(plan.diagnostics.some(({ code }) => code === "generation_rule_incompatible"), true);
    }
  });

  it("distinguishes SQL NULL from JSON literal null in generated cells, CSV, and MySQL INSERT SQL", () => {
    const schema = jsonSchema([
      { name: "json_null", dataType: "json", nullable: false },
      { name: "sql_null", dataType: "json", nullable: true },
    ], "null-semantics");
    const plan = buildGenerationPlan(schema, {
      rowCount: 1,
      seed: "null-semantics",
      rules: {
        json_null: { kind: "constant", value: null },
        sql_null: { kind: "null_ratio", ratio: 1 },
      },
    });
    const generated = generateRows(plan);
    assert.equal(plan.status, "ready");
    assert.equal(generated.status, "ready");
    assert.equal(rowPayload(generated.rows[0], "json_null"), null);
    assert.equal(generated.rows[0].sql_null, null);

    const dataset = createExportDataset(plan, generated, { table: { database: "mock_db", table: "null_semantics" } });
    const csv = exportCsv(dataset, { mode: "raw" });
    assert.equal(csv, "json_null,sql_null\r\nnull,");
    const sql = exportInsertSql(dataset, { header: false });
    assert.match(sql, /CAST\(CONVERT\(X'6e756c6c' USING utf8mb4\) AS JSON\),\n    NULL/u);
    assert.match(exportJson(dataset), /"json_null": null,[\s\S]*"sql_null": null/u,
      "row-oriented JSON follows the existing SQL NULL-to-JSON-null export contract");
  });

  it("keeps JSON objects structured and safely serializes CSV and SQL special characters", () => {
    const payload = {
      text: '中文, "quoted"; apostrophe \' ; backslash \\ ; line\nnext 🙂',
      nested: [{ value: "a,b" }, ["line\nfeed", "\""]],
    };
    const schema = jsonSchema([{ name: "payload", dataType: "json", nullable: false }], "json-exports");
    const plan = buildGenerationPlan(schema, {
      rowCount: 1,
      seed: "json-export-seed",
      rules: { payload: { kind: "constant", value: payload } },
    });
    const generated = generateRows(plan);
    const dataset = createExportDataset(plan, generated, { table: { database: "mock_db", table: "json_export" } });

    const json = exportJson(dataset);
    assert.deepEqual(JSON.parse(json)[0].payload, payload, "JSON export does not double-encode objects/arrays");
    const canonicalPayload = rowPayload(generated.rows[0], "payload");
    const expectedCsvCell = JSON.stringify(canonicalPayload).replaceAll('"', '""');
    assert.equal(exportCsv(dataset, { mode: "raw" }), `payload\r\n"${expectedCsvCell}"`);

    const sql = exportInsertSql(dataset, { header: false });
    const utf8Hex = Buffer.from(JSON.stringify(canonicalPayload), "utf8").toString("hex");
    assert.ok(sql.includes(`CAST(CONVERT(X'${utf8Hex}' USING utf8mb4) AS JSON)`));
    assert.doesNotMatch(sql, /apostrophe ' ; backslash/u, "raw input is never interpolated into SQL");
    assert.match(sql, /CAST\(CONVERT\(X'[0-9a-f]+' USING utf8mb4\) AS JSON\)/u);
  });

  it("blocks JSON defaults and JSON unique constraints instead of guessing their semantics", () => {
    const defaulted = buildGenerationPlan(jsonSchema([
      { name: "payload", dataType: "json", nullable: false, default: "(JSON_OBJECT())" },
    ], "json-default"), { rowCount: 2, seed: "default" });
    assert.equal(defaulted.status, "blocked");
    assert.equal(defaulted.diagnostics.find(({ code }) => code === "json_default_unsupported")?.blocking, true);

    const unique = buildGenerationPlan(jsonSchema([
      { name: "payload", dataType: "json", nullable: false },
      { name: "id", dataType: "int", nullable: false },
    ], "json-unique"), {
      rowCount: 2,
      seed: "unique",
      constraints: [
        { id: "json-unique", kind: "unique", column: "payload" },
        { id: "json-composite", kind: "composite_unique", columns: ["payload", "id"] },
      ],
    });
    assert.equal(unique.status, "blocked");
    assert.equal(unique.diagnostics.filter(({ code }) => code === "constraint_capacity_unknown").length, 2);

    const nonNullableNullRule = buildGenerationPlan(jsonSchema([
      { name: "payload", dataType: "json", nullable: false },
    ], "json-not-null"), {
      rowCount: 1,
      seed: "not-null",
      rules: { payload: { kind: "null_ratio", ratio: 0.1 } },
    });
    assert.equal(nonNullableNullRule.status, "blocked");
    assert.equal(nonNullableNullRule.diagnostics.some(({ code }) => code === "nullability_rule_conflict"), true);
  });

  it("preserves unsupported diagnostics for non-JSON database types", () => {
    const plan = buildGenerationPlan(jsonSchema([
      { name: "opaque", dataType: "GEOGRAPHY", nullable: false },
    ], "non-json-unsupported"), { rowCount: 1, seed: "unsupported" });
    const diagnostic = plan.diagnostics.find(({ code }) => code === "unsupported_type");
    assert.equal(plan.status, "blocked");
    assert.equal(diagnostic?.severity, "unsupported");
    assert.equal(diagnostic?.blocking, true);
    assert.equal(generateRows(plan).status, "blocked");
  });

  it("falls back to schema generation when the authorized empty sample contains no usable rows", async () => {
    let sampledRequest;
    const emptyDataHost = {
      capabilities: { dataApi: true },
      async queryData(request) {
        sampledRequest = request;
        return { columns: [{ name: "metric_count" }], rows: [] };
      },
    };
    const provider = new DbxHostSchemaMetadataProvider({
      capabilities: { schemaMetadataApi: true },
      async getTableMetadata() {
        return jsonHostResponse([
          { name: "metric_count", dataType: "int", nullable: false },
          { name: "payload", dataType: "json", nullable: false, default: null },
        ]);
      },
    });
    const controller = new DbxGenerationWorkbenchController({
      provider,
      preview: corePreview,
      sampleProbe: ({ context, schema }) => probeDbxDataSamples(emptyDataHost, context, schema, { includeStatus: true }),
      seedFactory: () => "new-empty-seed",
    });

    let view = await controller.setContext(CONTEXT);
    assert.equal(view.status, "idle", "validation-only planning succeeds before optional sampling");
    assert.equal(view.plan.status, "ready");
    assert.deepEqual(view.preview.rows, []);

    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "ready");
    assert.equal(view.sampleStatus.state, "empty");
    assert.equal(view.sampleStatus.fields.find(({ column }) => column === "metric_count")?.state, "no_data");
    assert.match(sampledRequest.sql, /SELECT ss\.metric_count FROM empty_json_table/u);
    assert.doesNotMatch(sampledRequest.sql, /payload/u, "JSON source values are not sampled or copied");
    assert.equal(view.preview.rows.length, 50);
    assert.ok(view.preview.rows.every((row) => isJsonDocumentValue(row.payload)));
    assert.equal(view.export.enabled, true);
    assert.deepEqual(JSON.parse(controller.prepareExport("json").content), view.preview.rows.map((row) => ({
      metric_count: row.metric_count,
      payload: unwrapJsonDocumentValue(row.payload),
    })));
  });

  it("keeps sampling failure status separate from safe JSON fallback generation", async () => {
    const provider = new DbxHostSchemaMetadataProvider({
      capabilities: { schemaMetadataApi: true },
      async getTableMetadata() {
        return jsonHostResponse([
          { name: "metric_count", dataType: "int", nullable: false },
          { name: "payload", dataType: "json", nullable: false, default: null },
        ]);
      },
    });
    let sampleProbeCalled = false;
    const controller = new DbxGenerationWorkbenchController({
      provider,
      preview: corePreview,
      sampleProbe: async () => {
        sampleProbeCalled = true;
        return {
          sampleUsed: false,
          evidence: [],
          sampleStatus: { state: "permission_denied", fields: [
            { column: "metric_count", state: "permission_denied" },
            { column: "payload", state: "skipped", reason: "not_selected" },
          ] },
        };
      },
    });
    await controller.setContext(CONTEXT);
    const view = await controller.dispatch({ type: "generate" });
    assert.equal(sampleProbeCalled, true);
    assert.equal(view.status, "ready");
    assert.equal(view.sampleStatus.state, "permission_denied");
    assert.equal(view.preview.rows.length, 50);
    assert.equal(view.diagnostics.some(({ code }) => code === "unsupported_type"), false);
  });
});
