import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportButtonState } from "../web/render.mjs";

describe("Workbench export button state", () => {
  it("enables CSV and JSON after a ready preview", () => {
    assert.deepEqual(exportButtonState({ status: "ready", export: { enabled: true } }), { csv: true, json: true });
  });

  it("keeps both downloads enabled when a preview is ready with warnings", () => {
    assert.deepEqual(exportButtonState({ status: "ready_with_warnings", export: { enabled: true } }), { csv: true, json: true });
  });

  it("disables both downloads for blocked, preview error, loading, or busy state", () => {
    for (const state of [
      { status: "blocked", export: { enabled: false } },
      { status: "preview_error", export: { enabled: false } },
      { status: "loading", export: { enabled: true } },
      { status: "ready", export: { enabled: true }, exportBusy: true },
    ]) {
      assert.deepEqual(exportButtonState(state), { csv: false, json: false });
    }
  });
});
