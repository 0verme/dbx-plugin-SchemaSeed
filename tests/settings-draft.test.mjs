import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSettingsDraft,
  resetSettingsDraft,
  resettableSettingsCounts,
  restoreSettingsDraft,
  sameSettingsConfiguration,
  settingsDraftChanged,
  settingsSchemaFingerprint,
} from "../src/workbench/settings-draft.mjs";

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

  it("counts only explicit overrides in the full current-table schema", () => {
    const configuration = {
      rules: {
        visible: { kind: "sequence", start: 1, step: 1 },
        hiddenBySearch: { kind: "enum", values: [1001, 1002] },
        alreadyAuto: { kind: "auto" },
        notInSchema: { kind: "constant", value: "ignore" },
      },
      constraints: [{ id: "manual-1", kind: "unique", column: "visible" }],
    };
    assert.deepEqual(resettableSettingsCounts(configuration, [
      { name: "visible" }, { name: "hiddenBySearch" }, { name: "alreadyAuto" },
    ]), { fields: 2, constraints: 1, total: 3 });
    assert.deepEqual(resettableSettingsCounts({ rules: { id: { kind: "auto" } }, constraints: [] }, [{ name: "id" }]), {
      fields: 0, constraints: 0, total: 0,
    });
  });

  it("resets the entire draft atomically and restores typed values from a complete snapshot", () => {
    const rules = {
      label: { kind: "enum", values: ["张三", "李四"] },
      count: { kind: "enum", values: [1, 2, 3] },
      id: { kind: "enum", values: [1001, 1002, 1003] },
      amount: { kind: "enum", values: ["12.50", "13.25"] },
    };
    const constraints = [
      { id: "manual-1", kind: "unique", column: "id" },
      { id: "manual-2", kind: "composite_unique", columns: ["id", "count"] },
    ];
    const draft = createSettingsDraft(rules, constraints, "table-A");
    const result = resetSettingsDraft(draft, [
      { name: "label" }, { name: "count" }, { name: "id" }, { name: "amount" },
    ]);

    assert.equal(result.changed, true);
    assert.deepEqual(result.counts, { fields: 4, constraints: 2, total: 6 });
    assert.deepEqual(draft.rules, {});
    assert.deepEqual(draft.constraints, []);
    assert.deepEqual(rules.id.values, [1001, 1002, 1003], "the committed input is not mutated");

    draft.rules.afterRestore = { kind: "constant", value: "temporary" };
    restoreSettingsDraft(draft, result.snapshot);
    assert.deepEqual(draft.rules, rules);
    assert.deepEqual(draft.constraints, constraints);
    assert.deepEqual(draft.rules.label.values, ["张三", "李四"]);
    assert.deepEqual(draft.rules.count.values, [1, 2, 3]);
    assert.deepEqual(draft.rules.id.values, [1001, 1002, 1003]);
    assert.deepEqual(draft.rules.amount.values, ["12.50", "13.25"]);
  });

  it("does not create a draft mutation when the current table already uses defaults", () => {
    const draft = createSettingsDraft({ id: { kind: "auto" } }, [], "table-A");
    const before = structuredClone({ rules: draft.rules, constraints: draft.constraints });
    const result = resetSettingsDraft(draft, [{ name: "id" }]);
    assert.equal(result.changed, false);
    assert.equal(result.snapshot, null);
    assert.deepEqual({ rules: draft.rules, constraints: draft.constraints }, before);
    assert.equal(settingsDraftChanged(draft), false);
  });

  it("treats a plain Auto choice as the same configuration as the implicit Core default", () => {
    assert.equal(sameSettingsConfiguration({ rules: { id: { kind: "auto" } }, constraints: [] }, { rules: {}, constraints: [] }), true);
    assert.equal(sameSettingsConfiguration({ rules: { id: { kind: "sequence", start: 1, step: 1 } }, constraints: [] }, { rules: {}, constraints: [] }), false);
  });

  it("binds a draft schema token to all normalized metadata facts", () => {
    const first = { tableIdentity: "table", columns: [{ name: "id", nullable: { state: "known", value: false } }] };
    const same = { columns: [{ nullable: { value: false, state: "known" }, name: "id" }], tableIdentity: "table" };
    const changed = { tableIdentity: "table", columns: [{ name: "id", nullable: { state: "known", value: true } }] };
    assert.equal(settingsSchemaFingerprint(first), settingsSchemaFingerprint(same));
    assert.notEqual(settingsSchemaFingerprint(first), settingsSchemaFingerprint(changed));
  });
});
