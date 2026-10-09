import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { createI18n } from "../src/i18n/index.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKBENCH_UI = path.join(root, "ui/generation-workbench/app.mjs");

function markupOf(source) {
  return /const WORKBENCH_MARKUP = `([\s\S]*?)`;/.exec(source)?.[1] ?? "";
}

describe("plugin-center missing table context", () => {
  it("keeps a genuinely absent context out of diagnostics and never requests generation", async () => {
    const metadataCalls = [];
    const previewCalls = [];
    const controller = new DbxGenerationWorkbenchController({
      provider: { async getTableMetadata(context) { metadataCalls.push(context); return {}; } },
      async preview(...args) { previewCalls.push(args); return {}; },
      seedFactory: () => "next-seed",
    });

    let view = await controller.setContext(undefined);
    assert.equal(view.status, "empty");
    assert.equal(view.context, null);
    assert.deepEqual(view.diagnostics, []);

    for (const action of [
      { type: "generate" },
      { type: "update-controls", controls: { rowCount: 5, seed: "demo", locale: "zh-CN" } },
      { type: "new-seed" },
      { type: "retry" },
    ]) {
      view = await controller.dispatch(action);
      assert.equal(view.status, "empty", action.type);
      assert.deepEqual(view.diagnostics, [], action.type);
    }
    assert.deepEqual(metadataCalls, []);
    assert.deepEqual(previewCalls, []);
  });

  it("retains diagnostics for a returned but invalid context", async () => {
    const controller = new DbxGenerationWorkbenchController({
      provider: { async getTableMetadata() { assert.fail("invalid contexts must not reach the provider"); } },
      async preview() { assert.fail("invalid contexts must not reach generation"); },
    });

    const view = await controller.setContext({ connectionId: "connection-A" });
    assert.equal(view.status, "blocked");
    assert.equal(view.diagnostics.length, 1);
    assert.equal(view.diagnostics[0].code, "table_context_invalid");
  });

  it("provides localized guidance that matches the registered table-menu labels", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    const contributionId = `${manifest.id}.generate-test-data`;

    assert.equal(zh("empty.title"), "请先选择一张数据表");
    assert.match(zh("empty.description"), /DBX 左侧数据库导航树/u);
    assert.equal(zh("empty.path"), "数据库连接 → 数据表 → 右键 →");
    assert.equal(zh("empty.menuAction"), manifest.localizations["zh-CN"].contributions[contributionId].label);
    assert.equal(en("empty.menuAction"), manifest.localizations["en-US"].contributions[contributionId].label);
    for (const locale of [zh, en]) {
      for (const key of ["empty.title", "empty.description", "empty.path", "empty.menuAction", "empty.helper"]) {
        assert.notEqual(locale(key), key, `${locale.locale} translates ${key}`);
      }
    }
  });

  it("shows only the empty card for the empty view while preserving the ready-gated workbench", async () => {
    const source = await readFile(WORKBENCH_UI, "utf8");
    const markup = markupOf(source);
    const emptyPosition = markup.indexOf('id="sswb-empty-state"');
    const contentPosition = markup.indexOf('id="sswb-workbench-content"');
    const headerPosition = markup.indexOf("<header class=\"sswb-header\">");
    assert.ok(headerPosition >= 0 && headerPosition < emptyPosition, "the existing SchemaSeed header stays visible");
    assert.ok(emptyPosition >= 0 && contentPosition > emptyPosition, "the independent empty card precedes the complete Workbench");
    assert.match(markup, /id="sswb-empty-title" data-i18n="empty\.title"/u);
    assert.match(markup, /id="sswb-workbench-content" class="sswb-workbench-content"/u);
    assert.match(source, /viewModel\.status === "empty"[\s\S]*?sswb-empty-state[\s\S]*?sswb-workbench-content/u);
    assert.match(source, /sswb-status"\)\.hidden = missingTableContext/u);

    const bootSource = await readFile(path.join(root, "ui/app.mjs"), "utf8");
    assert.ok(bootSource.indexOf("await host.ready") < bootSource.indexOf("mountGenerationWorkbench"));
    assert.ok(bootSource.indexOf("await mountGenerationWorkbench") < bootSource.indexOf("elements.boot.hidden = true"));

    const stylesheet = await readFile(path.join(root, "ui/generation-workbench.css"), "utf8");
    assert.match(stylesheet, /\.sswb-empty-card[^}]*var\(--sswb-panel\)/u);
    assert.match(stylesheet, /\.sswb-empty-state\[hidden\], \.sswb-workbench-content\[hidden\]/u);
  });
});
