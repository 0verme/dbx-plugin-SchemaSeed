import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { describeDiagnostic, diagnosticTechnicalRows } from "../src/i18n/diagnostics.mjs";
import { describeEvidence, evidenceSourceLabel, evidenceTechnicalRows } from "../src/i18n/evidence.mjs";
import { createI18n, missingMessageKeys } from "../src/i18n/index.mjs";
import { semanticLabel } from "../src/i18n/labels.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { EVIDENCE_KINDS } from "../src/semantic/evidence.mjs";
import { toColumnViewModel } from "../src/workbench/workbench-view-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zh = createI18n("zh-CN");
const en = createI18n("en-US");

/** The Runtime reproduction: a column whose name contains the `name` alias as a
 * separate token, so the semantic candidate needs explicit confirmation. */
function runtimePlan(options = {}) {
  const { schema } = normalizeTableSchema({
    tableIdentity: "evidence-i18n",
    columns: [{ name: "file_name", dataType: "varchar", nullable: false, length: 24 }],
  });
  return buildGenerationPlan(schema, { rowCount: 2, seed: "evidence-i18n", ...options });
}

function columnOf(plan, name = "file_name") {
  return plan.columns.find((entry) => entry.schema.name === name);
}

function evidenceOf(plan, source, name = "file_name") {
  const entry = columnOf(plan, name).semanticMapping.evidence.find((item) => item.source === source);
  assert.ok(entry, `expected ${source} evidence on ${name}`);
  return entry;
}

describe("semantic evidence i18n: zh-CN user view", () => {
  it("localizes the semantic_confirmation_required headline and keeps the machine code out", () => {
    const plan = runtimePlan();
    const diagnostic = plan.diagnostics.find((entry) => entry.code === "semantic_confirmation_required");
    const described = describeDiagnostic(diagnostic, zh);
    assert.equal(described.headline, "需要确认：字段语义存在歧义");
    assert.doesNotMatch(described.headline, /semantic_confirmation_required/);
    const line = zh("columns.ruleDiagnostic", { title: described.headline, code: described.code });
    assert.equal(line, "需要确认：字段语义存在歧义");
    assert.doesNotMatch(line, /semantic_confirmation_required/);
  });

  it("keeps semantic_confirmation_required reachable in the technical details", () => {
    const plan = runtimePlan();
    const diagnostic = plan.diagnostics.find((entry) => entry.code === "semantic_confirmation_required");
    const rows = diagnosticTechnicalRows(describeDiagnostic(diagnostic, zh), zh);
    assert.deepEqual(rows[0], ["诊断代码", "semantic_confirmation_required"]);
    assert.deepEqual(rows[1], ["严重级别", "warning"]);
    assert.deepEqual(rows[2], ["是否阻塞", "否"]);
  });

  it("localizes column_name evidence while preserving the raw column name", () => {
    const plan = runtimePlan();
    const described = describeEvidence(evidenceOf(plan, "column_name"), zh);
    assert.equal(described.kind, "column_name_alias_token");
    assert.equal(described.explanation, "字段名中包含独立的「姓名」语义别名");
    assert.equal(described.observation, "file_name → 姓名");
    assert.match(described.observation, /file_name/, "the raw column name is never translated");
    assert.equal(described.technical.observation, "file_name → name", "the raw Core observation is preserved");
    assert.equal(described.technical.explanation, "Column name contains a name alias as a separate token");
    assert.deepEqual(evidenceTechnicalRows(described, zh), [
      ["证据类型", "column_name_alias_token"],
      ["证据来源", "column_name"],
      ["原始观察值", "file_name → name"],
      ["Core 原始解释", "Column name contains a name alias as a separate token"],
    ]);
  });

  it("localizes schema_type evidence while preserving the raw datatype", () => {
    const plan = runtimePlan();
    const described = describeEvidence(evidenceOf(plan, "schema_type"), zh);
    assert.equal(described.kind, "schema_type_compatible");
    assert.equal(described.explanation, "varchar 类型与「姓名」语义兼容");
    assert.equal(described.observation, "varchar", "the raw datatype stays verbatim");
    assert.equal(described.technical.observation, "varchar");

    const { schema } = normalizeTableSchema({
      tableIdentity: "evidence-i18n-text",
      columns: [{ name: "file_name", dataType: "text", nullable: false }],
    });
    const textPlan = buildGenerationPlan(schema, { rowCount: 2, seed: "evidence-i18n-text" });
    const textEvidence = describeEvidence(evidenceOf(textPlan, "schema_type"), zh);
    assert.equal(textEvidence.observation, "text", "native text datatypes are not rewritten");
    assert.equal(textEvidence.explanation, "varchar 类型与「姓名」语义兼容");
  });

  it("localizes rule_name evidence with the same presentation contract", () => {
    const { schema } = normalizeTableSchema({
      tableIdentity: "evidence-i18n-rule",
      columns: [{ name: "rule_name", dataType: "varchar", nullable: false, length: 24 }],
    });
    const plan = buildGenerationPlan(schema, { rowCount: 2, seed: "evidence-i18n-rule" });
    const described = describeEvidence(evidenceOf(plan, "column_name", "rule_name"), zh);
    assert.equal(described.observation, "rule_name → 姓名");
    assert.equal(described.explanation, "字段名中包含独立的「姓名」语义别名");
    assert.equal(described.technical.observation, "rule_name → name");
  });

  it("localizes the confirmed / overridden / left-unknown evidence kinds", () => {
    const confirmed = runtimePlan({ semanticMappings: { file_name: "name" } });
    const confirmedEvidence = describeEvidence(evidenceOf(confirmed, "user_confirmed"), zh);
    assert.equal(confirmedEvidence.kind, "semantic_override_confirmed");
    assert.equal(confirmedEvidence.explanation, "语义映射已由用户显式确认");
    assert.equal(confirmedEvidence.observation, "姓名");

    const overridden = runtimePlan({ semanticOverrides: { file_name: "name" } });
    const overriddenEvidence = describeEvidence(evidenceOf(overridden, "user_override"), zh);
    assert.equal(overriddenEvidence.kind, "semantic_override_applied");
    assert.equal(overriddenEvidence.explanation, "语义类型已由用户显式覆盖");

    const unknown = runtimePlan({ semanticOverrides: { file_name: "unknown" } });
    const unknownEvidence = describeEvidence(evidenceOf(unknown, "user_override"), zh);
    assert.equal(unknownEvidence.kind, "semantic_left_unknown");
    assert.equal(unknownEvidence.explanation, "已显式选择不启用语义生成");
  });
});

describe("semantic evidence i18n: en-US stays a complete English experience", () => {
  it("renders every evidence kind in English without Chinese fallback", () => {
    const plan = runtimePlan();
    for (const source of ["column_name", "schema_type", "length"]) {
      const described = describeEvidence(evidenceOf(plan, source), en);
      assert.equal(described.fallback, false);
      assert.match(described.explanation, /^[\x00-\x7F]+$/, `${source} explanation stays English`);
      assert.doesNotMatch(described.explanation, /[\u4e00-\u9fff]/);
    }
    assert.equal(describeEvidence(evidenceOf(plan, "column_name"), en).explanation, "The column name contains Name as a separate alias token");
    assert.equal(describeEvidence(evidenceOf(plan, "schema_type"), en).observation, "varchar");
  });

  it("keeps the raw Core explanation identical in both languages", () => {
    const plan = runtimePlan();
    for (const source of ["column_name", "schema_type", "length"]) {
      const entry = evidenceOf(plan, source);
      assert.deepEqual(describeEvidence(entry, zh).technical, describeEvidence(entry, en).technical);
    }
  });
});

describe("semantic evidence i18n: unknown evidence fallback", () => {
  it("never crashes and never guesses for an unknown future kind", () => {
    const future = Object.freeze({
      kind: "future_evidence_kind",
      source: "future_source",
      observation: "future observation",
      explanation: "Core will keep its machine text stable",
      params: Object.freeze({ future: true }),
    });
    for (const t of [zh, en]) {
      const described = describeEvidence(future, t);
      assert.equal(described.kind, "future_evidence_kind");
      assert.equal(described.fallback, true);
      assert.equal(described.observation, t("evidence.fallback.observation"));
      assert.equal(described.explanation, t("evidence.fallback.explanation"));
      assert.doesNotMatch(described.explanation, /future_evidence_kind/);
      assert.deepEqual(described.technical, {
        kind: "future_evidence_kind",
        source: "future_source",
        observation: "future observation",
        explanation: "Core will keep its machine text stable",
      });
      assert.deepEqual(evidenceTechnicalRows(described, t).map(([label]) => label), [t("evidence.technical.kind"), t("evidence.technical.source"), t("evidence.technical.observation"), t("evidence.technical.explanation")]);
    }
  });

  it("tolerates legacy evidence without kind, params or raw fields", () => {
    for (const payload of [null, undefined, {}, { source: "column_name" }, { kind: "" }]) {
      for (const t of [zh, en]) {
        const described = describeEvidence(payload, t);
        assert.equal(described.fallback, true);
        assert.ok(described.explanation.length > 0);
        assert.ok(described.sourceLabel.length > 0);
      }
    }
    assert.equal(evidenceSourceLabel("schema_type", zh), "字段类型");
    assert.equal(evidenceSourceLabel("future_source", zh), "识别证据", "an unknown source falls back to a neutral label");
    assert.equal(evidenceSourceLabel(null, en), "Evidence");
  });
});

describe("semantic evidence i18n: machine semantics are unchanged", () => {
  it("keeps inference result, generator selection, severity and blocking untouched", () => {
    const plan = runtimePlan();
    const column = columnOf(plan);
    assert.equal(column.inference.semanticType, "name");
    assert.equal(column.inference.confidence, "medium", "a suffix alias token stays a medium-confidence candidate");
    assert.equal(column.inference.status, "candidate");
    assert.equal(column.semanticMapping.semanticType, "name");
    assert.equal(column.semanticMapping.confidence, "medium");
    assert.equal(column.semanticMapping.status, "needs_confirmation");
    assert.equal(column.semanticMapping.selected, false);
    assert.equal(column.rule.kind, "varchar", "the schema-type fallback is retained");
    assert.equal(column.rule.source, "schema_type_fallback");

    const confirmation = plan.diagnostics.find((entry) => entry.code === "semantic_confirmation_required");
    assert.equal(confirmation.severity, "warning");
    assert.equal(confirmation.blocking, false);
    assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_low_confidence"), false, "a medium-confidence candidate is not reported as low confidence");

    const columnNameEvidence = evidenceOf(plan, "column_name");
    assert.equal(columnNameEvidence.explanation, "Column name contains a name alias as a separate token");
    assert.equal(columnNameEvidence.observation, "file_name → name");
    assert.deepEqual(columnNameEvidence.params, { column: "file_name", alias: "name", semantic: "name" });
  });

  it("keeps the plan machine data identical across UI languages", () => {
    const claim = runtimePlan();
    const column = columnOf(claim);
    const zhColumn = toColumnViewModel(column, claim.diagnostics, { translator: zh });
    const enColumn = toColumnViewModel(column, claim.diagnostics, { translator: en });
    assert.deepEqual(zhColumn.evidence, enColumn.evidence, "evidence machine data cannot depend on the UI locale");
    assert.deepEqual({ kind: zhColumn.rule.kind, source: zhColumn.rule.source }, { kind: enColumn.rule.kind, source: enColumn.rule.source }, "the generator decision is locale-independent");
    assert.equal(zhColumn.mappingStatusToken, enColumn.mappingStatusToken);
    assert.equal(zhColumn.confidenceKey, enColumn.confidenceKey);
    assert.notEqual(zhColumn.mappingStatus, enColumn.mappingStatus, "only the presentation copy is localized");
    assert.notDeepEqual(zhColumn.evidence.map((entry) => describeEvidence(entry, zh).explanation), enColumn.evidence.map((entry) => describeEvidence(entry, en).explanation));
  });

  it("localizes every Core evidence kind in both catalogs", async () => {
    const kinds = Object.values(EVIDENCE_KINDS);
    assert.ok(kinds.length >= 9);
    for (const kind of kinds) {
      for (const t of [zh, en]) {
        assert.equal(t.has(`evidence.${kind}.explanation`), true, `${t.locale} explains evidence kind ${kind}`);
        const sample = t(`evidence.${kind}.explanation`, { semantic: semanticLabel("name", t), schemaFamily: "varchar", minimum: 10, length: "24" });
        assert.doesNotMatch(sample, /\{[a-zA-Z]+\}/, `${t.locale} leaves no unresolved placeholder for ${kind}`);
      }
      assert.notEqual(zh(`evidence.${kind}.explanation`), en(`evidence.${kind}.explanation`), `${kind} is localized`);
    }
    assert.deepEqual(missingMessageKeys("zh-CN"), []);
    assert.deepEqual(missingMessageKeys("en-US"), []);

    const source = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
    assert.match(source, /describeEvidence/, "the Workbench renders evidence through the presentation layer");
    assert.match(source, /evidenceTechnicalRows/, "the Workbench keeps raw evidence reachable");
    assert.doesNotMatch(source, /entry\.explanation/, "Core explanation strings are not copy-pasted into the user view");
    assert.doesNotMatch(source, /description\.code/, "the machine code is not rendered in the ordinary user view");
  });
});
