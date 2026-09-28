import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import { describeEvidence, evidenceTechnicalRows } from "../src/i18n/evidence.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";

const zh = createI18n("zh-CN");
const en = createI18n("en-US");

function planFor(column, sampleEvidence) {
  const { schema } = normalizeTableSchema({
    tableIdentity: `sample-evidence:${column.name}`,
    columns: [{ dataType: "varchar", nullable: false, length: 128, ...column }],
  });
  return buildGenerationPlan(schema, { rowCount: 2, seed: "sample-evidence", sampleEvidence });
}

describe("value-free semantic sample evidence", () => {
  it("uses 4/4 valid Chinese name samples as positive evidence", () => {
    const plan = planFor({ name: "display_name" }, [
      { column: "display_name", kind: "chinese_name_pattern", sampleCount: 4, matchedCount: 4 },
    ]);
    const column = plan.columns[0];

    assert.equal(column.inference.semanticType, "name");
    assert.equal(column.inference.confidence, "high");
    assert.equal(column.inference.sampleVerified, true);
    assert.equal(column.semanticMapping.selected, true);
    assert.equal(column.semanticMapping.status, "sample_verified");
    assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required"), false);
  });

  it("rejects weak name aliases after a strongly negative sample but retains human-readable evidence", () => {
    const plan = planFor({ name: "file_name" }, [
      { column: "file_name", kind: "chinese_name_pattern_rejected", sampleCount: 8, matchedCount: 0 },
    ]);
    const column = plan.columns[0];
    const rejection = column.inference.evidence.find((entry) => entry.kind === "sample_name_pattern_rejected");
    assert.ok(rejection);
    assert.equal(column.inference.status, "unknown");
    assert.equal(column.inference.confidence, "unknown");
    assert.deepEqual(column.inference.candidates, []);
    assert.equal(column.semanticMapping.status, "unknown");
    assert.equal(column.rule.kind, "varchar");
    assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required"), false);

    const localized = describeEvidence(rejection, zh);
    assert.equal(localized.observation, "file_name：0/8 个非空样本符合中文姓名模式");
    assert.match(localized.explanation, /少量样本与「姓名」模式明显不一致/);
    assert.doesNotMatch(localized.explanation, /pattern_rejected|matchedRatio/);
    assert.ok(evidenceTechnicalRows(localized, zh).some(([label, value]) => label === "证据来源" && value === "sample_pattern"));
    assert.equal(describeEvidence(rejection, en).fallback, false);
  });

  it("applies negative patterns to email and mobile without broadening semantic types", () => {
    for (const [columnName, kind] of [
      ["billing_email", "email_pattern_rejected"],
      ["primary_phone", "mobile_pattern_rejected"],
    ]) {
      const plan = planFor({ name: columnName }, [
        { column: columnName, kind, sampleCount: 5, matchedCount: 1 },
      ]);
      assert.equal(plan.columns[0].inference.status, "unknown", columnName);
      assert.equal(plan.columns[0].inference.evidence.some((entry) => entry.kind.endsWith("_rejected")), true);
    }
  });

  it("preserves exact aliases and lowers their confidence instead of silently deleting them", () => {
    const plan = planFor({ name: "name" }, [
      { column: "name", kind: "chinese_name_pattern_rejected", sampleCount: 8, matchedCount: 0 },
    ]);
    const column = plan.columns[0];

    assert.equal(column.inference.status, "candidate");
    assert.equal(column.inference.semanticType, "name");
    assert.deepEqual(column.inference.candidates, ["name"]);
    assert.equal(column.inference.confidence, "low");
    assert.equal(column.inference.evidence.some((entry) => entry.kind === "column_name_exact_alias"), true);
    assert.equal(column.inference.evidence.some((entry) => entry.kind === "sample_name_pattern_rejected"), true);
    assert.equal(column.semanticMapping.status, "needs_confirmation");
    assert.equal(column.semanticMapping.selected, false);
  });
});
