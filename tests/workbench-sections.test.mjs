import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { createI18n, SUPPORTED_UI_LOCALES } from "../src/i18n/index.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { toColumnViewModel } from "../src/workbench/workbench-view-model.mjs";
import {
  blockingDiagnosticCount,
  initialSectionExpansion,
  sectionSummaries,
  shouldAutoExpandDiagnostics,
  WORKBENCH_SECTION_DEFAULTS,
} from "../src/workbench/workbench-sections.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_SOURCE = path.join(root, "ui/generation-workbench/app.mjs");

const SAMPLE_COLUMNS = Object.freeze([
  { name: "customer_id", dataType: "integer", nullable: false },
  { name: "customer_name", dataType: "varchar", nullable: false, length: 24 },
  { name: "email", dataType: "varchar", nullable: false, length: 64 },
  { name: "status", dataType: "varchar", nullable: false, length: 12 },
  { name: "note", dataType: "varchar", nullable: true, length: 100 },
  { name: "amount", dataType: "decimal", nullable: false, precision: 10, scale: 2 },
  { name: "flag", dataType: "boolean", nullable: false },
]);

const CONFIRMATION_WARNING = Object.freeze({
  severity: "warning",
  code: "semantic_confirmation_required",
  table: "customer",
  column: "customer_name",
  rule: "semantic-inference",
  reason: "candidate requires confirmation",
  blocking: false,
});

const BLOCKING_ERROR = Object.freeze({
  severity: "error",
  code: "generation_rule_invalid",
  table: "customer",
  column: "customer_name",
  rule: "auto",
  reason: "the rule is invalid",
  blocking: true,
});

/** Build real view-model columns for a 7-column table with two pending semantic confirmations. */
function sampleViewModel() {
  const { schema, issues } = normalizeTableSchema({ tableIdentity: "customer", columns: SAMPLE_COLUMNS });
  assert.deepEqual(issues, []);
  const plan = buildGenerationPlan(schema, { rowCount: 5, seed: "demo", locale: "zh-CN", mode: "safe_synthetic" });
  return {
    columns: plan.columns.map((column) => toColumnViewModel(column, plan.diagnostics, { translator: createI18n("zh-CN") })),
    diagnostics: plan.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function viewModel(overrides = {}) {
  return {
    status: "ready",
    stage: "ready",
    context: { database: "db", schema: "public", table: "customer" },
    columns: [],
    constraints: [],
    diagnostics: [],
    constraintPlan: null,
    preview: { columns: [], rows: [] },
    ...overrides,
  };
}

function markupOf(source) {
  return /const WORKBENCH_MARKUP = `([\s\S]*?)`;/.exec(source)?.[1] ?? "";
}

describe("Workbench section disclosure defaults", () => {
  it("keeps the three advanced sections collapsed and Preview expanded on first render", () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      const t = createI18n(locale);
      assert.deepEqual(initialSectionExpansion(viewModel(), t), WORKBENCH_SECTION_DEFAULTS, locale);
      assert.deepEqual(WORKBENCH_SECTION_DEFAULTS, { columns: false, constraints: false, diagnostics: false, preview: true });
    }
  });

  it("does not open Diagnostics for warning-only confirmation state", () => {
    const t = createI18n("zh-CN");
    const { columns, diagnostics } = sampleViewModel();
    assert.ok(columns.some((column) => column.mappingStatusToken === "needsConfirmation"));
    assert.equal(diagnostics.length > 0, true);
    assert.equal(diagnostics.every((diagnostic) => diagnostic.blocking === false), true);

    const expansion = initialSectionExpansion(viewModel({ status: "warning", columns, diagnostics }), t);
    assert.deepEqual(expansion, { columns: false, constraints: false, diagnostics: false, preview: true });
  });

  it("opens Diagnostics on first render when the workspace is already blocked or failed", () => {
    const t = createI18n("zh-CN");
    assert.equal(initialSectionExpansion(viewModel({ status: "blocked", diagnostics: [BLOCKING_ERROR] }), t).diagnostics, true);
    assert.equal(initialSectionExpansion(viewModel({ status: "error" }), t).diagnostics, true, "a failed runtime counts as blocking");
    assert.equal(initialSectionExpansion(viewModel({ status: "blocked" }), t).diagnostics, true, "a blocked state without detail still opens");
    assert.equal(initialSectionExpansion(viewModel({ status: "blocked" }), t).preview, true, "Preview stays expanded");
  });

  it("auto-opens only when blocking appears, not for warnings", () => {
    const t = createI18n("zh-CN");
    const blockingCount = blockingDiagnosticCount;

    // session: ready → warning → blocking → still blocking (user may collapse again)
    let previousBlockingCount = 0;
    const warningCount = blockingCount(viewModel({ status: "warning", diagnostics: [CONFIRMATION_WARNING] }), t);
    assert.equal(warningCount, 0, "warnings are not blocking");
    assert.equal(shouldAutoExpandDiagnostics(previousBlockingCount, warningCount), false, "a warning never opens Diagnostics");

    previousBlockingCount = warningCount;
    const blockedView = viewModel({ status: "blocked", diagnostics: [BLOCKING_ERROR] });
    const errorCount = blockingCount(blockedView, t);
    assert.equal(errorCount, 1, "a blocking Core diagnostic counts once");
    assert.equal(shouldAutoExpandDiagnostics(previousBlockingCount, errorCount), true, "a newly appeared blocking error opens Diagnostics");
    assert.equal(initialSectionExpansion(blockedView, t).diagnostics, true);

    assert.equal(shouldAutoExpandDiagnostics(errorCount, errorCount), false, "an already open blocked state does not override a manual collapse");
    assert.equal(shouldAutoExpandDiagnostics(errorCount, 0), false, "recovery does not force anything");
  });
});

describe("Workbench section summaries", () => {
  it("summarizes field count and pending semantic confirmations", () => {
    const { columns, diagnostics } = sampleViewModel();
    const zh = sectionSummaries(viewModel({ status: "warning", columns, diagnostics }), createI18n("zh-CN"));
    assert.equal(zh.columns.text, "7 个字段 · 2 个待确认");
    assert.equal(zh.columns.severity, "warning");

    const en = sectionSummaries(viewModel({ status: "warning", columns, diagnostics }), createI18n("en-US"));
    assert.equal(en.columns.text, "7 fields · 2 to confirm");
    assert.equal(en.columns.severity, "warning");

    const clean = viewModel({ columns: columns.filter((column) => column.mappingStatusToken !== "needsConfirmation") });
    assert.equal(sectionSummaries(clean, createI18n("zh-CN")).columns.text, "5 个字段");
    assert.equal(sectionSummaries(clean, createI18n("zh-CN")).columns.severity, "none");
    assert.equal(sectionSummaries(viewModel(), createI18n("zh-CN")).columns.text, "0 个字段");
  });

  it("summarizes configured constraints and their blocking plan state", () => {
    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    const empty = viewModel();
    assert.deepEqual(sectionSummaries(empty, zh).constraints, { text: "未配置", severity: "none" });
    assert.deepEqual(sectionSummaries(empty, en).constraints, { text: "Not configured", severity: "none" });

    const configured = viewModel({ constraints: [{ id: "manual-1" }, { id: "manual-2" }, { id: "manual-3" }] });
    assert.deepEqual(sectionSummaries(configured, zh).constraints, { text: "3 条", severity: "none" });
    assert.deepEqual(sectionSummaries(configured, en).constraints, { text: "3 constraint(s)", severity: "none" });

    const blocked = viewModel({ constraints: [{ id: "manual-1" }], constraintPlan: { blocking: true, constraints: [] } });
    assert.deepEqual(sectionSummaries(blocked, zh).constraints, { text: "1 条", severity: "error" });
  });

  it("summarizes diagnostics as no issues, pending confirmations, or blocking errors", () => {
    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    assert.deepEqual(sectionSummaries(viewModel(), zh).diagnostics, { text: "无问题", severity: "none" });
    assert.deepEqual(sectionSummaries(viewModel(), en).diagnostics, { text: "No issues", severity: "none" });
    assert.deepEqual(sectionSummaries(viewModel({ status: "loading" }), zh).diagnostics, { text: "正在加载…", severity: "none" });

    const warnings = viewModel({ status: "warning", diagnostics: [CONFIRMATION_WARNING, { ...CONFIRMATION_WARNING, column: "email" }] });
    assert.deepEqual(sectionSummaries(warnings, zh).diagnostics, { text: "2 个待确认", severity: "warning" });
    assert.deepEqual(sectionSummaries(warnings, en).diagnostics, { text: "2 to confirm", severity: "warning" });

    const blocking = viewModel({ status: "blocked", diagnostics: [BLOCKING_ERROR] });
    assert.deepEqual(sectionSummaries(blocking, zh).diagnostics, { text: "1 个错误", severity: "error" });
    assert.deepEqual(sectionSummaries(blocking, en).diagnostics, { text: "1 error(s)", severity: "error" });
    assert.equal(sectionSummaries(blocking, zh).blockingCount, 1);

    const mixed = viewModel({ status: "blocked", diagnostics: [BLOCKING_ERROR, CONFIRMATION_WARNING] });
    assert.deepEqual(sectionSummaries(mixed, zh).diagnostics, { text: "1 个错误 · 1 个待确认", severity: "error" });

    const failed = viewModel({ status: "error" });
    assert.deepEqual(sectionSummaries(failed, zh).diagnostics, { text: "1 个错误", severity: "error" }, "a failed runtime never claims no issues");
  });

  it("localizes every summary key in both UI locales without unresolved placeholders", () => {
    const { columns, diagnostics } = sampleViewModel();
    const vm = viewModel({ status: "warning", columns, constraints: [{ id: "manual-1" }], diagnostics });
    for (const locale of SUPPORTED_UI_LOCALES) {
      const t = createI18n(locale);
      for (const key of [
        "columns.summary", "columns.summaryPending",
        "constraints.summary.none", "constraints.summary.count",
        "diagnostics.summary.none", "diagnostics.summary.pending", "diagnostics.summary.errors",
        "diagnostics.summary.issues", "diagnostics.summary.loading",
      ]) {
        assert.equal(t.has(key), true, `${locale} resolves ${key}`);
      }
      for (const summary of Object.values(sectionSummaries(vm, t)).filter((entry) => typeof entry === "object")) {
        assert.doesNotMatch(summary.text, /[{}]/, `${locale} leaves no unresolved placeholder in "${summary.text}"`);
        assert.doesNotMatch(summary.text, /summary\./, `${locale} does not leak a raw i18n key`);
      }
    }
  });
});

describe("Workbench markup disclosure contract", () => {
  it("orders context, preview, columns, constraints and diagnostics", async () => {
    const markup = markupOf(await readFile(UI_SOURCE, "utf8"));
    assert.ok(markup.length > 0, "the Workbench markup is declared");
    const orderedIds = ["sswb-context-title", "sswb-preview-title", "sswb-columns-title", "sswb-constraints-title", "sswb-diagnostics-title"];
    const positions = orderedIds.map((id) => markup.indexOf(`id="${id}"`));
    for (const [index, position] of positions.entries()) {
      assert.ok(position >= 0, `${orderedIds[index]} is declared`);
      if (index > 0) assert.ok(position > positions[index - 1], `${orderedIds[index]} comes after ${orderedIds[index - 1]}`);
    }
  });

  it("renders the three advanced sections as collapsed details and keeps Preview always visible", async () => {
    const markup = markupOf(await readFile(UI_SOURCE, "utf8"));
    assert.equal((markup.match(/<details\b/g) ?? []).length, 3, "only the advanced sections are disclosures");
    for (const [section, detailsId, titleId] of [
      ["columns", "sswb-columns-details", "sswb-columns-title"],
      ["constraints", "sswb-constraints-details", "sswb-constraints-title"],
      ["diagnostics", "sswb-diagnostics-details", "sswb-diagnostics-title"],
    ]) {
      assert.match(markup, new RegExp(`<details[^>]*id="${detailsId}"[^>]*>`), `${section} is a details element`);
      assert.doesNotMatch(markup, new RegExp(`<details[^>]*id="${detailsId}"[^>]*\\bopen\\b`), `${section} starts collapsed`);
      assert.match(
        markup,
        new RegExp(`<summary[^>]*>(?:(?!</summary>)[\\s\\S])*id="${titleId}"`),
        `${titleId} is inside the summary so the whole header row toggles the section`,
      );
      assert.match(markup, new RegExp(`id="${detailsId.replace("-details", "-summary")}"`), `${section} exposes a collapsed summary slot`);
    }
    assert.doesNotMatch(markup, /<summary[^>]*>(?:(?!<\/summary>)[\s\S])*id="sswb-preview-title"/, "Preview is not a disclosure");
    assert.equal(/<details[^>]*>[\s\S]*id="sswb-preview-title"/.test(markup), false);
  });

  it("keeps the field strategy editor and both editor state slots inside their sections", async () => {
    const markup = markupOf(await readFile(UI_SOURCE, "utf8"));
    assert.match(
      markup,
      /<details[^>]*id="sswb-columns-details"[\s\S]*<tbody id="sswb-columns"><\/tbody>[\s\S]*id="sswb-rule-state"[\s\S]*<\/details>/,
      "the columns table and rule editor state stay in the columns section body",
    );
    assert.match(
      markup,
      /<details[^>]*id="sswb-constraints-details"[\s\S]*data-constraint-add[\s\S]*<tbody id="sswb-constraints-body"><\/tbody>[\s\S]*id="sswb-constraint-state"[\s\S]*<\/details>/,
      "add-constraint, the constraint table and state stay in the constraints section body",
    );
    const source = await readFile(UI_SOURCE, "utf8");
    assert.match(source, /data-rule-selector/, "the field rule selector is still rendered after expanding");
    assert.match(source, /data-rule-field/, "the field rule editor fields are still rendered after expanding");
  });

  it("keeps disclosure state in the page session only", async () => {
    const source = await readFile(UI_SOURCE, "utf8");
    assert.match(source, /renderSectionSummaries/);
    assert.match(source, /shouldAutoExpandDiagnostics/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, "no additional persistence mechanism is introduced");
  });
});
