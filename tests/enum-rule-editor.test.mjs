import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { validateGenerationRule } from "../src/generation/generation-rules.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { createExportDataset } from "../src/export/export-dataset.mjs";
import { exportCsv } from "../src/export/csv-exporter.mjs";
import { exportJson } from "../src/export/json-exporter.mjs";
import { exportInsertSql } from "../src/export/sql-exporter.mjs";
import { createI18n, SUPPORTED_UI_LOCALES } from "../src/i18n/index.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { toColumnViewModel } from "../src/workbench/workbench-view-model.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { canEditEnumCandidatesAsTags } from "../ui/generation-workbench/candidate-input.mjs";

function column(dataType, extra = {}) {
  return normalizeTableSchema({
    tableIdentity: `enum-editor:${dataType}`,
    columns: [{ name: "value", dataType, nullable: false, ...extra }],
  }).schema.columns[0];
}

function enumValidation(schemaColumn, values) {
  return validateGenerationRule(schemaColumn, { kind: "enum", values }, { tableIdentity: "enum-editor-test" });
}

describe("enum candidate rule editor contract", () => {
  it("keeps Core field-specific candidate types, empty strings, and duplicate rejection", () => {
    const text = column("varchar", { length: 8 });
    assert.equal(enumValidation(text, ["", "A", "张三"]).valid, true);
    assert.equal(enumValidation(text, ["A", null]).diagnostics[0].code, "generation_rule_incompatible");
    assert.equal(enumValidation(text, []).diagnostics[0].reason, "Enum values must contain at least one candidate");
    assert.match(enumValidation(text, ["A", "A"]).diagnostics[0].reason, /must be unique/u);

    const integer = column("integer");
    assert.equal(enumValidation(integer, [1, -1, 0, 2_147_483_647]).valid, true);
    assert.equal(enumValidation(integer, [2_147_483_648]).valid, false);
    assert.equal(enumValidation(integer, [1, "2"]).diagnostics[0].code, "generation_rule_incompatible");
    assert.equal(enumValidation(integer, [1, null]).diagnostics[0].code, "generation_rule_incompatible");

    const bigint = column("bigint");
    assert.equal(enumValidation(bigint, [1, -1, Number.MAX_SAFE_INTEGER]).valid, true);
    assert.equal(enumValidation(bigint, [Number.MAX_SAFE_INTEGER + 1]).valid, false);
    assert.equal(enumValidation(bigint, ["9223372036854775807"]).valid, false);

    const decimal = column("decimal", { precision: 26, scale: 6 });
    assert.deepEqual(enumValidation(decimal, ["0.1", "12.50", "-99.99", "12345678901234567890.123456"]).rule.values,
      ["0.100000", "12.500000", "-99.990000", "12345678901234567890.123456"]);
    assert.equal(enumValidation(column("decimal", { precision: 5, scale: 2 }), ["12.501"]).valid, false);
    assert.equal(enumValidation(column("decimal", { precision: 5, scale: 2 }), ["1234.56"]).valid, false);

    const bool = column("boolean");
    assert.equal(enumValidation(bool, [true, false]).valid, true);
    assert.equal(enumValidation(bool, [true, "false"]).diagnostics[0].code, "generation_rule_incompatible");
  });

  it("routes bigint through the shared integer family to the real Tag Input capability", () => {
    const schema = normalizeTableSchema({
      tableIdentity: "bigint-tag-family",
      columns: [{ name: "id", dataType: "bigint", nullable: false }],
    }).schema;
    const plan = buildGenerationPlan(schema, { rules: { id: { kind: "enum", values: [1001, 1002] } } });
    const columnView = toColumnViewModel(plan.columns[0], plan.diagnostics);
    assert.equal(columnView.schemaFamily, "integer");
    assert.equal(canEditEnumCandidatesAsTags(columnView.schemaFamily, columnView.generationRule.values), true);
  });

  it("preserves bigint and high-precision decimal values through GenerationPlan and all exports", () => {
    const schema = normalizeTableSchema({
      tableIdentity: "typed-enum-precision",
      columns: [
        { name: "id", dataType: "bigint", nullable: false },
        { name: "amount", dataType: "numeric", precision: 26, scale: 6, nullable: false },
      ],
    }).schema;
    const bigintValues = [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1];
    const decimalValues = ["12345678901234567890.123456", "0.100000"];
    const plan = buildGenerationPlan(schema, {
      rowCount: 24,
      seed: "typed-enum-precision",
      rules: {
        id: { kind: "enum", values: bigintValues },
        amount: { kind: "enum", values: decimalValues },
      },
    });
    assert.notEqual(plan.status, "blocked");
    assert.deepEqual(plan.columns.find((entry) => entry.schema.name === "id").rule.parameters.values, bigintValues);
    assert.deepEqual(plan.columns.find((entry) => entry.schema.name === "amount").rule.parameters.values, decimalValues);

    const generated = generateRows(plan);
    assert.notEqual(generated.status, "blocked");
    assert.deepEqual(generateRows(plan), generated, "same Seed and plan remain deterministic");
    assert.ok(generated.rows.every((row) => bigintValues.includes(row.id)));
    assert.ok(generated.rows.every((row) => decimalValues.includes(row.amount)));

    const dataset = createExportDataset(plan, generated, { table: { table: "records" } });
    const jsonRows = JSON.parse(exportJson(dataset));
    assert.ok(jsonRows.every((row) => bigintValues.includes(row.id)));
    assert.ok(jsonRows.every((row) => decimalValues.includes(row.amount) && typeof row.amount === "string"));
    const csv = exportCsv(dataset, { header: false });
    const sql = exportInsertSql(dataset, { header: false });
    assert.match(csv, /12345678901234567890\.123456/u);
    assert.match(sql, /9007199254740991/u);
    assert.match(sql, /'12345678901234567890\.123456'/u);
  });

  it("preserves JSON documents, including JSON null, without string coercion", () => {
    const json = column("json");
    const values = ["A", null, 1, true, ["nested"], { b: 2, a: 1 }];
    const validation = enumValidation(json, values);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.rule.values, ["A", null, 1, true, ["nested"], { a: 1, b: 2 }]);
    assert.equal(enumValidation(json, ["null"]).valid, true);
    assert.notDeepEqual(validation.rule.values, ["A", "null", "1", "true", '["nested"]', '{"a":1,"b":2}']);
  });

  it("shows invalid explicit enum rules as invalid rules, not unsupported strategies", () => {
    const schema = normalizeTableSchema({
      tableIdentity: "enum-invalid-display",
      columns: [{ name: "state", dataType: "varchar", nullable: false, length: 16 }],
    }).schema;
    const plan = buildGenerationPlan(schema, { rules: { state: { kind: "enum", values: [] } } });
    assert.equal(plan.status, "blocked");
    const english = toColumnViewModel(plan.columns[0], plan.diagnostics, { translator: createI18n("en-US") });
    const chinese = toColumnViewModel(plan.columns[0], plan.diagnostics, { translator: createI18n("zh-CN") });
    assert.equal(english.selectedMapping, "Invalid rule");
    assert.equal(chinese.selectedMapping, "规则无效");
  });

  it("localizes all new tag editor and validation copy in Chinese and English", () => {
    const keys = [
      "enumInput.label", "enumInput.placeholder", "enumInput.count", "enumInput.remove", "enumInput.clear",
      "enumInput.advanced", "enumInput.backToTags", "enumInput.empty", "enumInput.invalidJson",
      "enumInput.incompatible", "enumInput.invalidInteger", "enumInput.integerRange", "enumInput.bigintRange",
      "enumInput.invalidDecimal", "enumInput.decimalPrecision", "enumInput.decimalJsonNumber", "enumInput.decimalMetadataUnknown",
      "enumInput.invalidBoolean", "enumInput.invalidDate", "enumInput.invalidTimestamp", "enumInput.timestampPrecision",
      "enumInput.returnNotLossless", "enumInput.fixFirst", "enumInput.previewInvalid",
    ];
    for (const locale of SUPPORTED_UI_LOCALES) {
      const t = createI18n(locale);
      for (const key of keys) assert.equal(t.has(key), true, `${locale} defines ${key}`);
    }
    assert.equal(createI18n("zh-CN")("enumInput.empty"), "请至少添加 1 个候选值");
    assert.equal(createI18n("en-US")("enumInput.empty"), "Add at least one candidate.");
  });

  it("wires keyboard, paste and invalid-draft export gates into the native Workbench UI", async () => {
    const source = await readFile(new URL("../ui/generation-workbench/app.mjs", import.meta.url), "utf8");
    assert.match(source, /addEventListener\("keydown", onEnumKeydown\)/u);
    assert.match(source, /addEventListener\("paste", onEnumPaste\)/u);
    assert.match(source, /shouldAddCandidateOnEnter\(event\)/u);
    assert.match(source, /shouldRemoveLastCandidateOnBackspace\(/u);
    assert.match(source, /canEditEnumCandidatesAsTags\(column\.schemaFamily, values\)/u);
    assert.match(source, /parseCandidateText\(column\.schemaFamily, target\.value\)/u);
    assert.match(source, /enumDraftPending\(\) \|\| exportSaveState/u);
    assert.match(source, /renderPreview\(viewModel, t, pendingEnumDraft\)/u);
    assert.match(source, /data-enum-json/u);
    assert.match(source, /dataset\.enumMode = "json"/u);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /from ["'](?:react|svelte|@kumo-ui)/u);
  });
});
