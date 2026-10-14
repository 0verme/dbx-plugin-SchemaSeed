import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { toColumnViewModel, toSettingsDraftColumnViewModel } from "../src/workbench/workbench-view-model.mjs";

const translator = createI18n("en-US");
const { schema, issues } = normalizeTableSchema({
  tableIdentity: "settings-draft-view-model",
  columns: [{ name: "status", dataType: "varchar", length: 16, nullable: false }],
});
assert.deepEqual(issues, []);

function plan(rules = {}) {
  return buildGenerationPlan(schema, { rowCount: 4, seed: "settings-draft-view-model", rules });
}

const committedPlan = plan({ status: { kind: "enum", values: ["new", "ready"] } });
const defaultPlan = plan();
const committedColumn = toColumnViewModel(committedPlan.columns[0], committedPlan.diagnostics, { translator });
const draft = { rules: {}, constraints: [] };

describe("advanced settings column Draft view model", () => {
  it("renders Core defaults instead of falling back to a committed manual enum after restore", () => {
    const restored = toSettingsDraftColumnViewModel(committedColumn, draft, {
      defaultsRestored: true,
      defaultPlan,
      schemaColumn: schema.columns[0],
      translator,
    });
    const coreDefault = toColumnViewModel(defaultPlan.columns[0], defaultPlan.diagnostics, { translator });

    assert.equal(restored.generationRule.kind, "auto");
    assert.equal(restored.selectedMapping, coreDefault.selectedMapping);
    assert.equal(restored.rule.kind, coreDefault.rule.kind);
    assert.notEqual(restored.selectedMapping, committedColumn.selectedMapping);
    assert.equal(restored.ruleFields.length, 0);
  });

  it("uses an explicit Auto placeholder until validation returns the Core-resolved defaults", () => {
    const restored = toSettingsDraftColumnViewModel(committedColumn, draft, {
      defaultsRestored: true,
      schemaColumn: schema.columns[0],
      translator,
    });

    assert.equal(restored.generationRule.kind, "auto");
    assert.equal(restored.selectedMapping, translator("ruleKind.auto"));
    assert.equal(restored.rule.source, "auto");
    assert.equal(restored.ruleFields.length, 0);
  });

  it("keeps later explicit Draft edits visible over the restored Core defaults", () => {
    const editedDraft = { rules: { status: { kind: "enum", values: ["open", "closed"] } }, constraints: [] };
    const edited = toSettingsDraftColumnViewModel(committedColumn, editedDraft, {
      defaultsRestored: true,
      defaultPlan,
      schemaColumn: schema.columns[0],
      translator,
    });

    assert.equal(edited.generationRule.kind, "enum");
    assert.deepEqual(edited.generationRule.values, ["open", "closed"]);
    assert.equal(edited.selectedMapping, translator("ruleKind.enum"));
  });

  it("retains committed-rule rendering before the user restores defaults", () => {
    const currentDraft = toSettingsDraftColumnViewModel(committedColumn, draft, {
      schemaColumn: schema.columns[0],
      translator,
    });

    assert.equal(currentDraft.generationRule.kind, "enum");
    assert.deepEqual(currentDraft.generationRule.values, ["new", "ready"]);
  });
});
