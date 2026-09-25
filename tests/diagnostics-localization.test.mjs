import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { describeDiagnostic, describeDiagnostics, diagnosticTechnicalRows } from "../src/i18n/diagnostics.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import {
  constraintEditorStateMessage,
  diagnosticsEmptyMessage,
  exportDisabledHint,
  exportErrorMessage,
  exportResultMessage,
  exportStatusMessage,
  stateMessage,
  statusLabel,
  ruleEditorStateMessage,
} from "../src/i18n/workbench-messages.mjs";
import { DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";

const zh = createI18n("zh-CN");
const en = createI18n("en-US");
const BASE_CONTEXT = Object.freeze({ connectionId: "connection-A", database: "app", schema: "public", table: "customer" });

const VARCHAR_UNKNOWN = Object.freeze({
  severity: "unsupported",
  code: "varchar_length_unknown",
  table: "dbx:[\"uuid\",\"test\",\"dwp\",\"audit_results\"]",
  column: "category",
  rule: "explicit-user-rule",
  reason: "varchar maximum length is unavailable; a maximum cannot be verified: DBX supports length metadata but omitted it for this column.",
  blocking: true,
});

const SEMANTIC_CONFIRMATION = Object.freeze({
  severity: "warning",
  code: "semantic_confirmation_required",
  table: "dbx:[\"uuid\",\"test\"]",
  column: "file_name",
  rule: "semantic:name:v1",
  reason: "Candidate name is inspectable but requires an explicit semantic override or confirmed mapping before Person generation",
  blocking: false,
});

function hostFor(response, calls = []) {
  return new DbxHostSchemaMetadataProvider({
    capabilities: { schemaMetadataApi: true },
    async getTableMetadata(context) {
      calls.push(context);
      return response;
    },
  });
}

function metadataResponse(columns, fieldCapabilities = {
  length: "supported",
  precision: "supported",
  scale: "supported",
  default: "supported",
}) {
  return { columns, fieldCapabilities };
}

function previewCore() {
  return async (schema, options) => {
    const plan = buildGenerationPlan(schema, options);
    const generated = generateRows(plan);
    return JSON.parse(JSON.stringify({ plan, generated }));
  };
}

/** DBX metadata without length facts: the blocking unknown-capacity path. A bare
 * `varchar` proves neither a maximum nor native unbounded semantics. */
function unknownTextLengthProvider() {
  return hostFor(metadataResponse(
    [{ name: "label", dataType: "varchar", nullable: true }],
    { length: "unsupported", precision: "unsupported", scale: "unsupported", default: "supported" },
  ));
}

/** A confirmable Person candidate: the non-blocking `semantic_confirmation_required` path. */
function semanticCandidateProvider() {
  return hostFor(metadataResponse([{ name: "customer_name", dataType: "varchar", nullable: false, length: 24 }]));
}

describe("diagnostics localization: machine contract is preserved", () => {
  it("keeps code, severity and blocking untouched for varchar_length_unknown", () => {
    const described = describeDiagnostic(VARCHAR_UNKNOWN, zh);
    assert.equal(described.code, "varchar_length_unknown");
    assert.equal(described.severity, "unsupported");
    assert.equal(described.blocking, true);
    assert.equal(described.level, "blocking", "a blocking unsupported diagnostic is presented as 阻塞");
    assert.equal(described.technical.reason, VARCHAR_UNKNOWN.reason, "the raw Core reason stays available");
    assert.equal(described.technical.column, "category");
    assert.equal(described.technical.rule, "explicit-user-rule");
    assert.equal(described.technical.table, VARCHAR_UNKNOWN.table);
  });

  it("keeps code, severity and blocking untouched for semantic_confirmation_required", () => {
    const described = describeDiagnostic(SEMANTIC_CONFIRMATION, zh);
    assert.equal(described.code, "semantic_confirmation_required");
    assert.equal(described.severity, "warning");
    assert.equal(described.blocking, false, "the confirmation request stays non-blocking");
    assert.equal(described.level, "needs_confirmation");
    assert.equal(described.technical.reason, SEMANTIC_CONFIRMATION.reason);
  });

  it("keeps the severity machine value even when the headline word is overridden", () => {
    const described = describeDiagnostic(SEMANTIC_CONFIRMATION, zh);
    assert.equal(described.levelLabel, "需要确认");
    assert.equal(described.technical.severity, "warning");
    assert.deepEqual(diagnosticTechnicalRows(described, zh), [
      ["诊断代码", "semantic_confirmation_required"],
      ["严重级别", "warning"],
      ["是否阻塞", "否"],
      ["表", SEMANTIC_CONFIRMATION.table],
      ["字段", "file_name"],
      ["规则", "semantic:name:v1"],
      ["Core 原始消息", SEMANTIC_CONFIRMATION.reason],
    ]);
  });
});

describe("diagnostics localization: human copy", () => {
  it("explains varchar_length_unknown in zh-CN without technical jargon", () => {
    const described = describeDiagnostic(VARCHAR_UNKNOWN, zh);
    assert.equal(described.headline, "阻塞：无法确认文本字段的最大长度");
    assert.equal(described.title, "无法确认文本字段的最大长度");
    assert.match(described.description, /category/, "the raw column name is quoted verbatim");
    assert.match(described.description, /DBX 没有返回/);
    assert.match(described.action, /手动指定允许的最大长度|重新读取/);
    assert.doesNotMatch(described.description, /varchar maximum length is unavailable/, "the raw provider message is not the primary copy");
    assert.doesNotMatch(described.headline, /unsupported|blocking/i);
  });

  it("explains varchar_length_unknown in en-US", () => {
    const described = describeDiagnostic(VARCHAR_UNKNOWN, en);
    assert.equal(described.headline, "Blocking: The text column maximum length is unknown");
    assert.match(described.description, /category/);
    assert.match(described.description, /DBX did not return length information/);
    assert.match(described.action, /Specify the allowed maximum length/);
  });

  it("explains semantic_confirmation_required in zh-CN with the detected semantic and next step", () => {
    const described = describeDiagnostic(SEMANTIC_CONFIRMATION, zh);
    assert.equal(described.headline, "需要确认：字段语义存在歧义");
    assert.match(described.description, /file_name/);
    assert.match(described.description, /姓名/, "the semantic type comes from the Core rule identity");
    assert.match(described.description, /仍使用普通文本生成策略/);
    assert.match(described.action, /手动确认/);
    assert.doesNotMatch(described.description, /Person generation/);
  });

  it("explains semantic_confirmation_required in en-US", () => {
    const described = describeDiagnostic(SEMANTIC_CONFIRMATION, en);
    assert.equal(described.headline, "Needs confirmation: This column semantic is ambiguous");
    assert.match(described.description, /file_name looks like it holds Name/);
    assert.match(described.action, /confirm the semantic manually/);
  });

  it("falls back safely for an unknown diagnostic code", () => {
    const future = { severity: "error", code: "brand_new_future_code", table: "t", column: null, rule: null, reason: "boom", blocking: true };
    for (const t of [zh, en]) {
      const described = describeDiagnostic(future, t);
      assert.equal(described.code, "brand_new_future_code", "the unknown code is preserved, not replaced");
      assert.equal(described.blocking, true);
      assert.match(described.description, /boom/, "the raw reason is shown instead of an invented meaning");
      assert.ok(described.title.length > 0);
    }
    assert.match(describeDiagnostic(future, zh).title, /未分类诊断/);
    assert.match(describeDiagnostic({ reason: "no code" }, zh).title, /未分类诊断/);
    assert.equal(describeDiagnostic({}, zh).code, "unknown");
    assert.deepEqual(describeDiagnostics(null, zh), []);
    assert.equal(describeDiagnostics([future], zh).length, 1);
  });

  it("does not require the semantic type to be present in the rule identity", () => {
    const described = describeDiagnostic({ ...SEMANTIC_CONFIRMATION, rule: "semantic-inference" }, zh);
    assert.match(described.description, /该语义/);
    assert.doesNotMatch(described.description, /\{semantic\}/);
  });
});

describe("diagnostics localization: Workbench state copy", () => {
  const statuses = ["loading", "dirty", "ready", "warning", "blocked", "error"];
  const states = ["ready", "dirty", "validating", "generating", "blocked", "warning", "error", "loading"];

  it("localizes every Workbench status and state line in both languages", () => {
    for (const status of statuses) {
      const viewModel = { status, stage: "generation", diagnostics: [], plan: null, export: { enabled: false } };
      assert.notEqual(statusLabel(viewModel, zh), statusLabel(viewModel, en), `status ${status} is localized`);
      assert.ok(statusLabel(viewModel, zh).length > 0);
      assert.ok(stateMessage(viewModel, zh).length > 0);
      assert.ok(diagnosticsEmptyMessage(viewModel, zh).length > 0);
    }
    for (const state of states) {
      const viewModel = { status: "dirty", stage: "generation", diagnostics: [], ruleEditor: { state }, constraintEditor: { state } };
      for (const t of [zh, en]) {
        for (const message of [ruleEditorStateMessage(viewModel, t), constraintEditorStateMessage(viewModel, t)]) {
          assert.doesNotMatch(message, /^[a-z]+\.[a-zA-Z.]+$/, "state keys resolve to copy, not to raw keys");
          assert.ok(message.length > 0);
        }
      }
      assert.notEqual(ruleEditorStateMessage(viewModel, zh), ruleEditorStateMessage(viewModel, en));
      assert.notEqual(constraintEditorStateMessage(viewModel, zh), constraintEditorStateMessage(viewModel, en));
    }
  });

  it("localizes the blocked preview, export hint and constraint conflict messages", () => {
    const blocked = { status: "blocked", stage: "ready", diagnostics: [{ code: "varchar_length_unknown" }], plan: {}, export: { enabled: false } };
    assert.equal(stateMessage(blocked, zh), "当前存在阻塞问题，暂时无法生成或导出测试数据。请先处理上方“问题诊断”中的阻塞项。");
    assert.match(stateMessage(blocked, en), /GenerationPlan is blocked/);
    assert.match(exportStatusMessage(blocked, zh), /GenerationPlan 被阻塞/);
    assert.match(exportDisabledHint(blocked, zh), /无法导出/);
    assert.match(constraintEditorStateMessage({ constraintEditor: { state: "blocked" } }, zh), /生成约束或规则存在冲突/);
    assert.match(constraintEditorStateMessage({ constraintEditor: { state: "blocked" } }, zh), /问题诊断/);

    const capability = { status: "blocked", stage: "ready", diagnostics: [{ code: "metadata_capability_unavailable" }], plan: null, export: { enabled: false } };
    assert.match(stateMessage(capability, zh), /未提供 Schema Metadata/);

    assert.match(exportStatusMessage({ status: "ready", export: { enabled: true } }, zh), /与当前预览完全相同/);
    assert.match(exportResultMessage({ summary: { rowCount: 20, format: "CSV" } }, zh), /20 行 · CSV · UTF-8/);
    assert.match(exportStatusMessage({ status: "loading", export: { enabled: false } }, zh), /生成预览成功后才可导出/);
    assert.match(exportErrorMessage({ code: "export_blocked_plan", message: "Blocked plans cannot be exported" }, zh), /export_blocked_plan/);
    assert.match(exportErrorMessage({ code: "export_blocked_plan" }, en), /blocked and cannot be exported/);
    assert.match(exportErrorMessage(new Error("boom"), zh), /export_error/);
  });
});

describe("diagnostics localization: blocking safety semantics are unchanged", () => {
  it("blocks generation and export for varchar_length_unknown in both UI languages", async () => {
    const machineResults = [];
    for (const translator of [zh, en]) {
      const controller = new DbxGenerationWorkbenchController({
        provider: unknownTextLengthProvider(),
        preview: previewCore(),
        translator,
      });
      const view = await controller.setContext(BASE_CONTEXT);
      assert.equal(view.status, "blocked");
      assert.equal(view.plan.status, "blocked");
      assert.deepEqual(view.preview.rows, []);
      assert.equal(view.export.enabled, false);
      const blocking = view.diagnostics.filter((entry) => entry.code === "varchar_length_unknown");
      assert.equal(blocking.length, 1);
      assert.equal(blocking[0].blocking, true);
      assert.equal(blocking[0].severity, "unsupported");
      assert.throws(() => controller.prepareExport("csv"), (error) => error.code === "export_blocked_plan");
      assert.throws(() => controller.prepareExport("json"), (error) => error.code === "export_blocked_plan");
      machineResults.push(JSON.stringify({
        status: view.status,
        planStatus: view.plan.status,
        export: view.export.enabled,
        diagnostics: view.diagnostics.map((entry) => ({ code: entry.code, severity: entry.severity, blocking: entry.blocking })),
      }));
    }
    assert.equal(machineResults[0], machineResults[1], "the UI language cannot change the machine-blocked outcome");

    const localized = describeDiagnostic(VARCHAR_UNKNOWN, zh);
    assert.equal(localized.blocking, true);
    assert.match(localized.headline, /^阻塞：/);
  });

  it("does not turn a confirmation request into an automatic Person mapping", async () => {
    const machineResults = [];
    for (const translator of [zh, en]) {
      const controller = new DbxGenerationWorkbenchController({
        provider: semanticCandidateProvider(),
        preview: previewCore(),
        translator,
      });
      const view = await controller.setContext(BASE_CONTEXT);
      assert.equal(view.status, "warning", "only the non-blocking confirmation warning applies");
      assert.equal(view.export.enabled, true, "a warning does not block export");
      const column = view.columns.find((entry) => entry.column === "customer_name");
      assert.equal(column.mappingStatusToken, "needsConfirmation");
      assert.equal(column.rule.kind, "varchar", "the schema-type fallback is retained; Person generation is not selected");
      assert.equal(column.rule.source, "schema_type_fallback");
      assert.equal(column.canConfirm, true);
      const diagnostic = view.diagnostics.find((entry) => entry.code === "semantic_confirmation_required");
      assert.equal(diagnostic.severity, "warning");
      assert.equal(diagnostic.blocking, false);
      machineResults.push(JSON.stringify({ status: view.status, ruleKind: column.rule.kind, ruleSource: column.rule.source, generationRuleKind: column.generationRule.kind }));
      assert.equal(column.mappingStatus, translator.locale === "zh-CN" ? "待确认 · 当前使用默认策略" : "Needs confirmation · fallback active");
    }
    assert.equal(machineResults[0], machineResults[1], "the UI language cannot change the mapping decision");
  });

  it("keeps the machine code out of the user-facing rule diagnostic line", async () => {
    const controller = new DbxGenerationWorkbenchController({
      provider: unknownTextLengthProvider(),
      preview: previewCore(),
      translator: zh,
    });
    const view = await controller.setContext(BASE_CONTEXT);
    const described = describeDiagnostic(view.diagnostics[0], zh);
    const line = zh("columns.ruleDiagnostic", { title: described.headline, code: described.code });
    assert.equal(line, "阻塞：无法确认文本字段的最大长度");
    assert.doesNotMatch(line, /varchar_length_unknown/, "the machine code stays out of the ordinary user view");
    assert.deepEqual(diagnosticTechnicalRows(described, zh)[0], ["诊断代码", "varchar_length_unknown"], "the code stays reachable behind the technical details");
  });
});
