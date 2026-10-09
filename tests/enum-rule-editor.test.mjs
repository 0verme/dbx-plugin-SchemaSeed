import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { validateGenerationRule } from "../src/generation/generation-rules.mjs";
import { createI18n, SUPPORTED_UI_LOCALES } from "../src/i18n/index.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { toColumnViewModel } from "../src/workbench/workbench-view-model.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";

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
    assert.equal(enumValidation(integer, [1, 2, 3]).valid, true);
    assert.equal(enumValidation(integer, [1, "2"]).diagnostics[0].code, "generation_rule_incompatible");
    assert.equal(enumValidation(integer, [1, null]).diagnostics[0].code, "generation_rule_incompatible");

    const bool = column("boolean");
    assert.equal(enumValidation(bool, [true, false]).valid, true);
    assert.equal(enumValidation(bool, [true, "false"]).diagnostics[0].code, "generation_rule_incompatible");
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
      "enumInput.incompatible", "enumInput.returnNotLossless", "enumInput.fixFirst", "enumInput.previewInvalid",
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
    assert.match(source, /enumDraftPending\(\) \|\| exportSaveState/u);
    assert.match(source, /renderPreview\(viewModel, t, pendingEnumDraft\)/u);
    assert.match(source, /data-enum-json/u);
    assert.match(source, /dataset\.enumMode = "json"/u);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /from ["'](?:react|svelte|@kumo-ui)/u);
  });
});
