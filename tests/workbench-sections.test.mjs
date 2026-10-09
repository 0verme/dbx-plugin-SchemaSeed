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

  it("keeps advanced sections as disclosures and renders SQL preview in a separate Modal", async () => {
    const markup = markupOf(await readFile(UI_SOURCE, "utf8"));
    assert.equal((markup.match(/<details\b/g) ?? []).length, 3, "only the three advanced sections remain disclosures");
    assert.match(markup, /<div id="sswb-sql-modal" class="sswb-modal" hidden>/, "the SQL Modal starts hidden");
    assert.match(markup, /role="dialog" aria-modal="true" aria-labelledby="sswb-sql-modal-title"/, "the Modal is announced as a modal dialog");
    assert.match(markup, /<pre id="sswb-sql-code-scroll"[^>]*tabindex="0"[^>]*><code id="sswb-sql-code"><\/code><\/pre>/, "SQL is rendered in a focusable, read-only code region");
    assert.doesNotMatch(markup, /sswb-sql-details|sswb-sql-content|sswb-sql-preview-error/, "the former bottom disclosure and textarea are removed");
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
    assert.match(markup, /<section class="sswb-panel" aria-labelledby="sswb-preview-title">/u, "Preview remains a visible section rather than a disclosure");
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

  it("renders a low-interference sample hint with localized lifecycle copy", async () => {
    const source = await readFile(UI_SOURCE, "utf8");
    const markup = markupOf(source);
    assert.match(markup, /<span id="sswb-sample-hint" class="sswb-section-hint"><\/span>/);
    assert.match(source, /viewModel\.sampleStatus\?\.state[\s\S]*columns\.sampleHint\./);
    assert.match(source, /fieldStatus\.state !== "skipped" \|\| needsSemanticConfirmation/);
    assert.match(source, /summaryKind === "chinese_name_pattern"[\s\S]*namePatternInsufficient/);
    assert.match(source, /semantic_confirmation_required[\s\S]*sampleFieldStatusText/);

    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    assert.match(zh("columns.sampleHint.pending"), /DBX Host 授权/u);
    assert.match(zh("columns.sampleHint.pending"), /最多读取 100 行/u);
    assert.match(zh("columns.sampleHint.sampled"), /部分字段已分析/u);
    assert.match(zh("columns.sampleHint.permission_denied"), /未授权/u);
    assert.match(en("columns.sampleHint.pending"), /DBX Host authorization/u);
    assert.match(en("columns.sampleHint.pending"), /limit of 100 rows/u);
    assert.match(en("columns.sampleHint.sampled"), /some fields/u);
    assert.match(en("columns.sampleHint.permission_denied"), /did not authorize/u);
    assert.match(zh("columns.sampleFieldStatus.namePatternUsed", { matchedCount: 4, sampleCount: 4 }), /格式无法区分实名、昵称/u);
    assert.match(en("columns.sampleFieldStatus.namePatternUsed", { matchedCount: 4, sampleCount: 4 }), /cannot distinguish a real name, nickname/u);

    const stylesheet = await readFile(path.join(root, "ui/generation-workbench.css"), "utf8");
    assert.match(stylesheet, /\.sswb-section-hint/);
    assert.doesNotMatch(stylesheet.match(/\.sswb-section-hint[^}]*}/)?.[0] ?? "", /warning|#[89a-f][0-9a-f]{5}/i);
  });

  it("shows a localized empty preview until the explicit Generate action runs", async () => {
    const source = await readFile(UI_SOURCE, "utf8");
    const markup = markupOf(source);
    assert.match(markup, /<button[^>]*data-sswb-action="preview"[^>]*><\/button>/u);
    assert.match(markup, /<div id="sswb-preview-empty" class="sswb-preview-empty" hidden>[\s\S]*data-i18n="preview\.empty\.title"[\s\S]*data-i18n="preview\.empty\.helper"[\s\S]*<\/div>/u);
    assert.match(source, /const showEmptyState = Boolean\(viewModel\.context && hasPreparedPlan\s+&& \["idle", "dirty", "error"\]\.includes\(viewModel\.status\)\)/u);
    assert.match(source, /previewButton\.disabled = viewModel\.previewAction\.disabled/u);
    assert.match(source, /previewButton\.textContent = t\(viewModel\.previewAction\.labelKey\)/u);
    assert.match(source, /previewButton\.setAttribute\("aria-busy", "true"\)/u);
    assert.doesNotMatch(source, /data-sswb-action="new-seed"/u);
    assert.equal(createI18n("zh-CN")("preview.empty.title"), "尚未生成预览数据");
    assert.equal(createI18n("en-US")("preview.empty.title"), "Preview not generated yet");
    assert.match(createI18n("zh-CN")("preview.empty.helper"), /点击上方主按钮/u);
    assert.match(createI18n("en-US")("preview.empty.helper"), /primary button above/u);
  });

  it("keeps narrow-screen context and parameters compact without removing controls", async () => {
    const source = await readFile(UI_SOURCE, "utf8");
    const markup = markupOf(source);
    const contextPanel = /<section class="sswb-panel" aria-labelledby="sswb-context-title">([\s\S]*?)<\/section>/u.exec(markup)?.[1] ?? "";
    assert.ok(contextPanel.length > 0, "the current table context panel is present");
    for (const id of ["sswb-database", "sswb-schema", "sswb-table", "sswb-rows", "sswb-seed", "sswb-locale"]) {
      assert.match(contextPanel, new RegExp(`id="${id}"`), `${id} remains available in the context/control panel`);
    }
    assert.match(contextPanel, /class="sswb-button sswb-primary"[^>]*data-sswb-action="preview"/u, "one state-driven preview action remains primary");
    assert.match(contextPanel, /id="sswb-seed"[^>]*type="text"/u, "the editable random Seed remains available");
    assert.equal((contextPanel.match(/<button[^>]*data-sswb-action=/gu) ?? []).length, 1, "the preview action area contains exactly one button");
    assert.doesNotMatch(contextPanel, /sswb-data-access|dataAccess\.|了解详情|Learn more/u);
    assert.doesNotMatch(markup, /sswb-safe-notice|safety\.notice/u, "the full-row data-access and green safety callouts are removed");

    const stylesheet = await readFile(path.join(root, "ui/generation-workbench.css"), "utf8");
    assert.match(stylesheet, /@media \(max-width: 640px\)[\s\S]*?\.sswb-context-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u, "the three context facts stay in a compact row on narrow screens");
    assert.match(stylesheet, /\.sswb-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.7fr\)\s+minmax\(0,\s*1\.4fr\)\s+minmax\(0,\s*\.8fr\)/u, "row count, seed and data locale share a compact parameter row");
    assert.match(stylesheet, /\.sswb-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u, "the single preview action uses the full narrow-screen row");
    assert.match(stylesheet, /\.sswb-preview-scroll\s*\{[^}]*max-height:\s*min\(55vh,\s*620px\)/u, "the preview table has a bounded viewport for long datasets");
  });

  it("keeps disclosure state in the page session only", async () => {
    const source = await readFile(UI_SOURCE, "utf8");
    assert.match(source, /renderSectionSummaries/);
    assert.match(source, /shouldAutoExpandDiagnostics/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, "no additional persistence mechanism is introduced");
  });
});
