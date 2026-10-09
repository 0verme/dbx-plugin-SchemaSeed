import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createI18n } from "../src/i18n/index.mjs";
import { previewSummary } from "../src/i18n/workbench-messages.mjs";
import { PREVIEW_ACTION_STATES, previewPrimaryAction, previewState } from "../src/workbench/preview-action-state.mjs";

function state(overrides = {}) {
  return {
    status: "idle",
    stage: "ready",
    context: { table: "customer" },
    canGenerate: true,
    hasCurrentDataset: false,
    ...overrides,
  };
}

describe("preview primary action state contract", () => {
  it("uses the current seed and configuration while EMPTY", () => {
    const action = previewPrimaryAction(state());
    assert.deepEqual(action, {
      state: PREVIEW_ACTION_STATES.EMPTY,
      action: "generate",
      labelKey: "actions.generate",
      disabled: false,
      busy: false,
    });
    assert.equal(previewState(state({ context: null, canGenerate: false })), PREVIEW_ACTION_STATES.EMPTY);
    const planning = previewPrimaryAction(state({ status: "loading", stage: "planning" }));
    assert.equal(planning.state, PREVIEW_ACTION_STATES.EMPTY);
    assert.equal(planning.disabled, true, "generation stays disabled until initial planning finishes");
  });

  it("keeps initial planning disabled and marks row generation as busy", () => {
    const action = previewPrimaryAction(state({ status: "loading", stage: "generation" }));
    assert.deepEqual(action, {
      state: PREVIEW_ACTION_STATES.GENERATING,
      action: "generate",
      labelKey: "actions.generatingPreview",
      disabled: true,
      busy: true,
    });
    assert.equal(previewState(state({ status: "loading", stage: "metadata" })), PREVIEW_ACTION_STATES.EMPTY);
  });

  it("changes READY to one atomic new-seed action only for a committed dataset", () => {
    for (const status of ["ready", "warning"]) {
      const action = previewPrimaryAction(state({ status, hasCurrentDataset: true }));
      assert.equal(action.state, PREVIEW_ACTION_STATES.READY);
      assert.equal(action.action, "generate-new-data");
      assert.equal(action.labelKey, "actions.generateNewData");
      assert.equal(action.disabled, false);
    }
    assert.equal(previewState(state({ status: "ready", hasCurrentDataset: false })), PREVIEW_ACTION_STATES.EMPTY);
  });

  it("regenerates DIRTY settings without selecting a replacement seed", () => {
    const action = previewPrimaryAction(state({ status: "dirty" }));
    assert.equal(action.state, PREVIEW_ACTION_STATES.DIRTY);
    assert.equal(action.action, "generate");
    assert.equal(action.labelKey, "actions.regeneratePreview");
    assert.equal(action.disabled, false);
    const blocked = previewPrimaryAction(state({ status: "blocked" }));
    assert.equal(blocked.state, PREVIEW_ACTION_STATES.DIRTY);
    assert.equal(blocked.disabled, false, "blocked plans can be revalidated through the primary action");
  });

  it("summarizes committed rows and distinguishes the last generated settings from edits", () => {
    const zh = createI18n("zh-CN");
    const summary = previewSummary({
      lastSuccessfulParameters: { seed: "generated-seed" },
      lastSuccessfulParametersCurrent: true,
      plan: { seed: "edited-seed" },
      preview: { rows: [{ id: 1 }, { id: 2 }] },
    }, zh);
    assert.equal(summary, "2 行 · 种子 generated-seed");

    const staleSummary = previewSummary({
      lastSuccessfulParameters: { rowCount: 50, seed: "generated-seed", locale: "zh-CN" },
      lastSuccessfulParametersCurrent: false,
      controls: { rowCount: 8, seed: "edited-seed", locale: "en" },
      preview: { rows: [] },
    }, zh);
    assert.equal(staleSummary, "上次预览参数：50 行 · 种子 generated-seed · 数据语言 zh-CN（当前设置已变更）");
  });

  it("offers a same-input retry after generation failure and context retry after metadata failure", () => {
    const generationRetry = previewPrimaryAction(state({ status: "error", stage: "generation" }));
    assert.equal(generationRetry.state, PREVIEW_ACTION_STATES.ERROR);
    assert.equal(generationRetry.action, "generate");
    assert.equal(generationRetry.labelKey, "actions.retryGeneration");
    assert.equal(generationRetry.disabled, false);

    const metadataRetry = previewPrimaryAction(state({ status: "error", stage: "metadata", canGenerate: false }));
    assert.equal(metadataRetry.action, "retry");
    assert.equal(metadataRetry.labelKey, "actions.retry");
    assert.equal(metadataRetry.disabled, false);
  });
});
