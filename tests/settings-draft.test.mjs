import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSettingsDraft, sameSettingsConfiguration, settingsDraftChanged } from "../src/workbench/settings-draft.mjs";

describe("advanced settings draft", () => {
  it("isolates editable state from the effective rules and constraints", () => {
    const rules = { customer_id: { kind: "sequence", start: 1, step: 1 } };
    const constraints = [{ id: "unique-1", kind: "unique", column: "customer_id" }];
    const draft = createSettingsDraft(rules, constraints, "table-A");
    draft.rules.customer_id.start = 12;
    draft.constraints[0].column = "display_name";

    assert.equal(rules.customer_id.start, 1);
    assert.equal(constraints[0].column, "customer_id");
    assert.equal(settingsDraftChanged(draft), true);
    assert.equal(draft.contextKey, "table-A");
  });

  it("treats object key order as irrelevant but preserves ordered constraint columns", () => {
    assert.equal(sameSettingsConfiguration(
      { rules: { a: { kind: "sequence", start: 1, step: 1 } }, constraints: [{ id: "u", kind: "composite_unique", columns: ["a", "b"] }] },
      { rules: { a: { step: 1, start: 1, kind: "sequence" } }, constraints: [{ columns: ["a", "b"], kind: "composite_unique", id: "u" }] },
    ), true);
    assert.equal(sameSettingsConfiguration(
      { rules: {}, constraints: [{ id: "u", kind: "composite_unique", columns: ["a", "b"] }] },
      { rules: {}, constraints: [{ id: "u", kind: "composite_unique", columns: ["b", "a"] }] },
    ), false);
  });

  it("starts clean and recognizes a reverted draft as unchanged", () => {
    const draft = createSettingsDraft({ note: { kind: "constant", value: "seed" } }, [], "table-A");
    assert.equal(settingsDraftChanged(draft), false);
    draft.rules.note.value = "edited";
    assert.equal(settingsDraftChanged(draft), true);
    draft.rules.note.value = "seed";
    assert.equal(settingsDraftChanged(draft), false);
  });
});
