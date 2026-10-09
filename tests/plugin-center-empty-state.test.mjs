import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { executeGenerationPreview } from "../src/generation/generation-runtime.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";
import { renderWorkbenchContextVisibility } from "../ui/generation-workbench/visibility.mjs";
import { selectInitialContext } from "../ui/generation-workbench/context.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKBENCH_UI = path.join(root, "ui/generation-workbench/app.mjs");
const VALID_CONTEXT = Object.freeze({ connectionId: "connection-A", database: "sales", schema: "public", table: "customer" });

function createHarness() {
  const metadataCalls = [];
  const previewCalls = [];
  const schema = normalizeTableSchema({
    tableIdentity: "test-table",
    columns: [{ name: "id", dataType: "integer", nullable: false }],
  }).schema;
  const controller = new DbxGenerationWorkbenchController({
    provider: {
      async getTableMetadata(request) {
        metadataCalls.push(request);
        return schema;
      },
    },
    async preview(...args) {
      previewCalls.push(args);
      return executeGenerationPreview(...args);
    },
  });
  return { controller, metadataCalls, previewCalls };
}

function createVisibilityRoot() {
  const nodes = new Map([
    ["#sswb-empty-state", { hidden: true }],
    ["#sswb-workbench-content", { hidden: false }],
    ["#sswb-status", { hidden: false }],
  ]);
  return {
    nodes,
    querySelector(selector) {
      const node = nodes.get(selector);
      assert.ok(node, `known visibility selector: ${selector}`);
      return node;
    },
  };
}

function markupOf(source) {
  return /const WORKBENCH_MARKUP = `([\s\S]*?)`;/.exec(source)?.[1] ?? "";
}

describe("plugin-center missing table context", () => {
  it("treats only absent values and an empty record as empty without requesting metadata or generation", async () => {
    const { controller, metadataCalls, previewCalls } = createHarness();

    let view;
    for (const context of [undefined, null, {}]) {
      view = await controller.setContext(context);
      assert.equal(view.status, "empty");
      assert.equal(view.context, null);
      assert.deepEqual(view.diagnostics, []);
    }
    assert.equal(controller.contextRevision, 1, "equivalent empty notifications are deduplicated");

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

  it("keeps non-empty incomplete contexts invalid and retry does not reclassify them as empty", async () => {
    for (const context of [{ connectionId: "A" }, { table: "users" }, [], new Map(), new Date()]) {
      const { controller, metadataCalls, previewCalls } = createHarness();
      let view = await controller.setContext(context);
      assert.equal(view.status, "blocked");
      assert.equal(view.diagnostics[0]?.code, "table_context_invalid");

      view = await controller.dispatch({ type: "retry" });
      assert.equal(view.status, "blocked");
      assert.equal(view.diagnostics[0]?.code, "table_context_invalid");
      assert.deepEqual(metadataCalls, []);
      assert.deepEqual(previewCalls, []);
    }
  });

  it("recovers across Host context updates and projects real ViewModel state to page visibility", async () => {
    const { controller, metadataCalls, previewCalls } = createHarness();
    const root = createVisibilityRoot();
    controller.subscribe((view) => renderWorkbenchContextVisibility(root, view.status));

    let view = await controller.setContext({});
    assert.equal(view.status, "empty");
    assert.equal(root.nodes.get("#sswb-empty-state").hidden, false);
    assert.equal(root.nodes.get("#sswb-workbench-content").hidden, true);
    assert.equal(root.nodes.get("#sswb-status").hidden, true);

    view = await controller.setContext(VALID_CONTEXT);
    assert.notEqual(view.status, "empty");
    assert.ok(view.plan, "a valid TableContext creates a GenerationPlan");
    assert.ok(view.export.enabled, "the valid context completes normal generation");
    assert.equal(root.nodes.get("#sswb-empty-state").hidden, true);
    assert.equal(root.nodes.get("#sswb-workbench-content").hidden, false);
    assert.equal(root.nodes.get("#sswb-status").hidden, false);

    view = await controller.setContext({});
    assert.equal(view.status, "empty");
    assert.equal(view.context, null);
    assert.equal(view.plan, null);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);
    assert.deepEqual(view.diagnostics, []);
    assert.equal(root.nodes.get("#sswb-empty-state").hidden, false);
    assert.equal(root.nodes.get("#sswb-workbench-content").hidden, true);
    assert.equal(metadataCalls.length, 1);
    assert.equal(previewCalls.length, 1);

    view = await controller.setContext({ connectionId: "A" });
    assert.equal(view.status, "blocked");
    assert.equal(view.diagnostics[0]?.code, "table_context_invalid");
    view = await controller.setContext(VALID_CONTEXT);
    assert.notEqual(view.status, "blocked");
    assert.deepEqual(view.diagnostics, []);
    assert.equal(metadataCalls.length, 2);
    assert.equal(previewCalls.length, 2);
  });

  it("uses the Host context when defined, including null, and only falls back when absent", () => {
    const staleInitContext = { connectionId: "stale", table: "users" };
    assert.equal(selectInitialContext({ context: null }, staleInitContext), null);
    assert.deepEqual(selectInitialContext({ context: {} }, staleInitContext), {});
    assert.equal(selectInitialContext({}, undefined), undefined);
    assert.equal(selectInitialContext({}, staleInitContext), staleInitContext);
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
    assert.match(source, /renderWorkbenchContextVisibility\(root, viewModel\.status\)/u);
    assert.match(source, /controller\.setContext\(selectInitialContext\(host, initialContext\)\)/u);
    assert.match(source, /host\.onContext\(\(context\) =>[\s\S]*?controller\.setContext\(context\)/u);
    const visibilitySource = await readFile(path.join(root, "ui/generation-workbench/visibility.mjs"), "utf8");
    assert.match(visibilitySource, /root\.querySelector\("#sswb-empty-state"\)[\s\S]*?root\.querySelector\("#sswb-workbench-content"\)[\s\S]*?root\.querySelector\("#sswb-status"\)/u);
    assert.match(source, /viewModel\.status === "empty" && sqlDialog\.isOpen/u);

    const bootSource = await readFile(path.join(root, "ui/app.mjs"), "utf8");
    assert.ok(bootSource.indexOf("await host.ready") < bootSource.indexOf("mountGenerationWorkbench"));
    assert.match(bootSource, /selectInitialContext\(host, latestInit\?\.context\)/u);
    assert.ok(bootSource.indexOf("await mountGenerationWorkbench") < bootSource.indexOf("elements.boot.hidden = true"));

    const stylesheet = await readFile(path.join(root, "ui/generation-workbench.css"), "utf8");
    assert.match(stylesheet, /\.sswb-empty-card[^}]*var\(--sswb-panel\)/u);
    assert.match(stylesheet, /\.sswb-empty-state\[hidden\], \.sswb-workbench-content\[hidden\]/u);
  });
});
