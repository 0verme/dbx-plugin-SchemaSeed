import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import {
  describeDiagnostic,
  describeDiagnosticGroups,
  describeDiagnostics,
  diagnosticColumnTechnicalRows,
  diagnosticTechnicalRows,
} from "../src/i18n/diagnostics.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import {
  constraintEditorStateMessage,
  diagnosticsEmptyMessage,
  actionErrorMessage,
  exportDisabledHint,
  exportErrorMessage,
  exportSaveMessage,
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
    const generated = options.validateOnly
      ? { rows: [], diagnostics: [...plan.diagnostics], status: plan.status }
      : generateRows(plan);
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
    assert.equal(described.headline, "需要确认：字段语义需要人工确认");
    assert.match(described.description, /file_name/);
    assert.match(described.description, /姓名/, "the semantic type comes from the Core rule identity");
    assert.match(described.description, /业务用途/u);
    assert.match(described.description, /依据猜测选择专用生成策略/u);
    assert.match(described.action, /依据业务定义/);
    assert.doesNotMatch(described.description, /Person generation/);
  });

  it("explains semantic_confirmation_required in en-US", () => {
    const described = describeDiagnostic(SEMANTIC_CONFIRMATION, en);
    assert.equal(described.headline, "Needs confirmation: This column meaning needs confirmation");
    assert.match(described.description, /name of file_name suggests Name/);
    assert.match(described.description, /business meaning/);
    assert.match(described.description, /based on a guess/);
    assert.match(described.action, /based on the business definition/);
  });

  it("falls back safely for an unknown diagnostic code without exposing the raw reason in primary copy", () => {
    const future = { severity: "error", code: "brand_new_future_code", table: "t", column: null, rule: null, reason: "boom", blocking: true };
    for (const t of [zh, en]) {
      const described = describeDiagnostic(future, t);
      assert.equal(described.code, "brand_new_future_code", "the unknown code is preserved, not replaced");
      assert.equal(described.blocking, true);
      assert.doesNotMatch(described.description, /boom/, "the raw Core reason stays behind technical details");
      assert.ok(described.title.length > 0);
      assert.equal(diagnosticTechnicalRows(described, t).at(-1)[1], "boom");
    }
    assert.match(describeDiagnostic(future, zh).title, /未分类诊断/);
    assert.match(describeDiagnostic({ reason: "no code" }, zh).title, /未分类诊断/);
    assert.equal(describeDiagnostic({}, zh).code, "unknown");
    assert.deepEqual(describeDiagnostics(null, zh), []);
    assert.equal(describeDiagnostics([future], zh).length, 1);
  });

  it("never lets a localized level override downgrade Core blocking or fabricate a blocking decision", () => {
    const blockingConfirmation = describeDiagnostic({ ...SEMANTIC_CONFIRMATION, blocking: true }, zh);
    assert.equal(blockingConfirmation.level, "blocking");
    assert.equal(blockingConfirmation.levelLabel, "阻塞");
    assert.equal(blockingConfirmation.technical.severity, "warning");
    assert.equal(blockingConfirmation.technical.blocking, true);

    const nonBlocking = describeDiagnostic({ ...SEMANTIC_CONFIRMATION, blocking: false }, zh);
    assert.equal(nonBlocking.level, "needs_confirmation");
    const error = describeDiagnostic({ ...SEMANTIC_CONFIRMATION, severity: "error", blocking: false }, zh);
    assert.equal(error.level, "error", "a catalog cannot visually downgrade Core error severity");
    const info = describeDiagnostic({ code: "future_info", severity: "info", blocking: false }, en);
    assert.equal(info.level, "info");
    assert.equal(info.levelLabel, "Info");
  });

  it("groups only same-table diagnostics with matching cause, action, severity and blocking", () => {
    const timestampDiagnostic = (overrides = {}) => ({
      severity: "warning",
      code: "timestamp_precision_unknown",
      table: 'dbx:["connection-secret","app","public","audit"]',
      column: "created_at",
      rule: "schema:created_at",
      reason: "no authoritative precision metadata",
      blocking: false,
      ...overrides,
    });
    const grouped = describeDiagnosticGroups([
      timestampDiagnostic(),
      timestampDiagnostic({ column: "updated_at", rule: "schema:updated_at" }),
      timestampDiagnostic({ table: 'dbx:["other-connection","app","public","audit"]', column: "archived_at" }),
      timestampDiagnostic({ column: "deleted_at", reason: "catalog query was denied" }),
      timestampDiagnostic({ column: "processed_at", severity: "error" }),
      timestampDiagnostic({ column: "blocked_at", blocking: true }),
    ], zh);

    assert.equal(grouped.length, 5);
    assert.equal(grouped[0].grouped, true);
    assert.equal(grouped[0].count, 2);
    assert.equal(grouped[0].entries.map((entry) => entry.description.location.column).join(","), "created_at,updated_at");
    assert.match(grouped[0].title, /2 个字段/u);
    assert.match(grouped[0].description, /数据库列声明精度/u);
    assert.equal(grouped.slice(1).every((entry) => entry.grouped === false && entry.count === 1), true);
    const many = describeDiagnosticGroups(Array.from({ length: 12 }, (_value, index) => timestampDiagnostic({ column: `timestamp_${index}` })), zh)[0];
    assert.equal(many.count, 12);
    assert.equal(many.entries.length, 12, "expanded details retain every Core field diagnostic");
    assert.equal(describeDiagnosticGroups([
      timestampDiagnostic({ table: "", column: "a" }),
      timestampDiagnostic({ table: "", column: "b" }),
    ], zh).length, 2, "diagnostics without a concrete table are not merged");
    const english = describeDiagnosticGroups([timestampDiagnostic(), timestampDiagnostic({ column: "updated_at" })], en)[0];
    assert.match(english.title, /2 fields/u);
    assert.match(english.description, /Generation can continue/u);
    assert.doesNotMatch(english.description, /这些字段/u);
  });

  it("shows schema precision availability and source while allowing a safe table override", () => {
    const column = {
      schemaFacts: {
        dataType: { state: "known", value: "timestamp", provenance: "DBX Host API 1.3" },
        precision: { state: "unavailable", reason: "fieldCapabilities.precision=unknown" },
      },
      temporalPrecision: {
        declaration: { state: "unknown", reason: "no metadata" },
        generation: { value: 3, source: "schema_seed_fallback" },
      },
      rule: { source: "schema_type" },
      sampleValue: "must-not-appear",
    };
    const metadataRows = diagnosticColumnTechnicalRows(column, en);
    assert.ok(metadataRows.some(([label, value]) => label === "Schema precision fact / availability" && /unavailable.*fieldCapabilities/u.test(value)));
    assert.ok(metadataRows.some(([label, value]) => label === "Generation precision / source" && value === "3 · schema_seed_fallback"));
    assert.ok(metadataRows.some(([label, value]) => label === "Rule source" && value === "schema_type"));
    assert.doesNotMatch(metadataRows.map((row) => row.join(" ")).join(" "), /must-not-appear|sampleValue/u);

    const described = describeDiagnostic(VARCHAR_UNKNOWN, en);
    const rows = diagnosticTechnicalRows(described, en, { table: "app.public.customer", metadataRows });
    assert.ok(rows.some(([label, value]) => label === "Table" && value === "app.public.customer"));
    assert.doesNotMatch(rows.map((row) => row.join(" ")).join(" "), /uuid|connection-A/u);
  });

  it("does not require the semantic type to be present in the rule identity", () => {
    const described = describeDiagnostic({ ...SEMANTIC_CONFIRMATION, rule: "semantic-inference" }, zh);
    assert.match(described.description, /该语义/);
    assert.doesNotMatch(described.description, /\{semantic\}/);
  });
});

describe("diagnostics localization: Workbench state copy", () => {
  const statuses = ["idle", "loading", "dirty", "ready", "warning", "blocked", "error"];
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
    assert.equal(stateMessage(blocked, zh), "当前方案存在阻塞问题，预览和导出不可用。可使用上方主按钮重新校验（适用时先使用已授权样本）；若仍阻塞则不会生成数据。请先处理下方诊断项。");
    assert.match(stateMessage(blocked, en), /plan has blocking issues/u);
    assert.match(stateMessage({ ...blocked, canGenerate: true }, zh), /可使用上方主按钮重新校验/u);
    assert.match(stateMessage({ ...blocked, canGenerate: true }, en), /revalidate/u);
    assert.match(exportStatusMessage(blocked, zh), /当前生成设置存在阻塞问题/u);
    assert.match(exportDisabledHint(blocked, zh), /无法导出/);
    assert.match(constraintEditorStateMessage({ constraintEditor: { state: "blocked" } }, zh), /生成约束或规则存在冲突/);
    assert.match(constraintEditorStateMessage({ constraintEditor: { state: "blocked" } }, zh), /问题诊断/);

    const capability = { status: "blocked", stage: "ready", diagnostics: [{ code: "metadata_capability_unavailable" }], plan: null, export: { enabled: false } };
    assert.match(stateMessage(capability, zh), /未提供 Schema Metadata/);

    assert.equal(exportStatusMessage({ status: "ready", export: { enabled: true } }, zh), "");
    const descriptor = { filename: "schemaseed-audit_results-20rows.csv", summary: { rowCount: 20, format: "CSV" } };
    assert.match(exportSaveMessage({ status: "saved", descriptor }, zh), /^已保存 schemaseed-audit_results-20rows\.csv（20 行 · CSV · UTF-8）$/);
    assert.match(exportSaveMessage({ status: "saved", path: "C:/out/a.csv", descriptor }, en), /^Saved to: C:\/out\/a\.csv$/);
    assert.match(exportSaveMessage({ status: "cancelled" }, zh), /^已取消保存。$/);
    assert.match(exportSaveMessage({ status: "failed", code: "export_host_save_failed" }, en), /^Save failed: export_host_save_failed · /);
    assert.match(exportStatusMessage({ status: "loading", export: { enabled: false } }, zh), /生成预览成功后才可导出/);
    assert.match(actionErrorMessage("Rows must be an integer from 1 to 1000", zh), /生成行数必须是 1 到 1000 之间的整数/u);
    assert.match(exportErrorMessage({ code: "export_blocked_plan", message: "Blocked plans cannot be exported" }, zh), /export_blocked_plan/);
    assert.match(exportErrorMessage({ code: "export_blocked_plan" }, en), /generation settings have blocking issues/u);
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
      assert.equal(view.status, "idle", "the initial plan may contain a warning without generating data");
      assert.equal(view.plan.status, "ready_with_warnings", "only the non-blocking confirmation warning applies");
      assert.equal(view.export.enabled, false, "a warning does not make an ungenerated dataset exportable");
      assert.deepEqual(view.preview.rows, []);
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
