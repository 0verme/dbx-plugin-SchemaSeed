import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import { describeEvidence, evidenceTechnicalRows } from "../src/i18n/evidence.mjs";
import { isSensitiveSampleColumn, normalizeSampleEvidence, sampleEvidenceToCoreEvidence, sanitizeSampleEvidence } from "../src/semantic/sample-evidence.mjs";
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

describe("semantic and value-minimized sample profiles", () => {
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

  it("normalizes bounded categorical, numeric, and filename profiles for their safe column kinds", () => {
    const knownColumns = new Set(["severity", "line_no", "file_name", "file_id", "身份证号码", "amount", "latitude", "金额"]);
    const profiles = normalizeSampleEvidence([
      {
        column: "severity", kind: "enum_like", sampleCount: 4, distinctCount: 2,
        candidates: [{ value: "err", frequency: 3 }, { value: "warn", frequency: 1 }],
      },
      { column: "line_no", kind: "numeric_range", sampleCount: 4, min: 0, max: 88, zeroCount: 1 },
      { column: "amount", kind: "numeric_range", sampleCount: 4, min: 1, max: 9, zeroCount: 0 },
      { column: "latitude", kind: "numeric_range", sampleCount: 4, min: 1, max: 9, zeroCount: 0 },
      { column: "金额", kind: "numeric_range", sampleCount: 4, min: 1, max: 9, zeroCount: 0 },
      {
        column: "file_name", kind: "filename_pattern", sampleCount: 4, matchedCount: 4,
        suffixes: [{ suffix: ".sql", frequency: 3 }, { suffix: ".hql", frequency: 1 }],
      },
      {
        column: "file_id", kind: "filename_pattern", sampleCount: 4, matchedCount: 4,
        suffixes: [{ suffix: ".csv", frequency: 4 }],
      },
      {
        column: "身份证号码", kind: "enum_like", sampleCount: 4, distinctCount: 2,
        candidates: [{ value: "alice", frequency: 2 }, { value: "bob", frequency: 2 }],
      },
    ], knownColumns);

    assert.deepEqual(profiles.get("severity").candidates, [
      { value: "err", frequency: 3 }, { value: "warn", frequency: 1 },
    ]);
    assert.deepEqual({
      min: profiles.get("line_no").min,
      max: profiles.get("line_no").max,
      zeroCount: profiles.get("line_no").zeroCount,
    }, { min: 0, max: 88, zeroCount: 1 });
    for (const column of ["amount", "latitude", "金额"]) {
      assert.equal(profiles.has(column), false, `${column} is a sensitive financial or location column`);
    }
    assert.deepEqual(profiles.get("file_name").suffixes, [
      { suffix: ".sql", frequency: 3 }, { suffix: ".hql", frequency: 1 },
    ]);
    assert.equal(profiles.has("file_id"), false, "identifier-like filename columns stay excluded");
    assert.equal(profiles.has("身份证号码"), false, "Chinese identifier columns are sensitive too");
    const inconsistentZero = normalizeSampleEvidence([
      { column: "line_no", kind: "numeric_range", sampleCount: 4, min: 0, max: 8, zeroCount: 0 },
    ], knownColumns);
    assert.equal(inconsistentZero.has("line_no"), false, "a zero-valued endpoint requires a positive zero frequency");
  });

  it("accepts only restricted value-free temporal shapes for sensitive temporal columns", () => {
    assert.equal(isSensitiveSampleColumn("last_login_at"), true);
    const profiles = normalizeSampleEvidence([
      {
        column: "last_login_at", kind: "temporal_shape", temporalKind: "timestamp",
        sampleCount: 4, nullCount: 1, nullRate: 0.25, observedCount: 3,
        precision: 0, timezoneAware: false,
        observedMin: "2026-07-18 09:30:00", observedMax: "2026-07-20 09:30:00",
      },
      {
        column: "started_at", kind: "temporal_shape", temporalKind: "timestamp",
        sampleCount: 4, nullCount: 0, nullRate: 0, observedCount: 4,
        precision: 0, timezoneAware: false,
      },
      {
        column: "last_login_at", kind: "temporal_range", temporalKind: "timestamp",
        sampleCount: 4, nullCount: 0, nullRate: 0, observedCount: 4,
        observedMin: "2026-07-18 09:30:00", observedMax: "2026-07-20 09:30:00",
        precision: 0, timezoneAware: false,
      },
    ], new Set(["last_login_at", "started_at"]));

    assert.deepEqual(profiles.get("last_login_at"), {
      kind: "temporal_shape", temporalKind: "timestamp", sampleCount: 4,
      nullCount: 1, nullRate: 0.25, observedCount: 3, precision: 0, timezoneAware: false,
    });
    assert.equal(profiles.has("started_at"), false, "restricted shapes are reserved for sensitive names");
    assert.doesNotMatch(JSON.stringify(profiles), /observedMin|observedMax|2026-07-1[08]|2026-07-20/u);
    const evidence = sampleEvidenceToCoreEvidence(profiles.get("last_login_at"), "last_login_at");
    assert.equal(describeEvidence(evidence, zh).fallback, false);
    assert.match(describeEvidence(evidence, zh).observation, /精度为 0/u);
    assert.match(describeEvidence(evidence, en).explanation, /original time values and observed bounds are not retained/u);
  });

  it("does not recommend categorical generation when labels or columns fail privacy guards", () => {
    const blocked = sanitizeSampleEvidence([
      {
        column: "password", kind: "enum_like", sampleCount: 4, distinctCount: 2,
        candidates: [{ value: "alice", frequency: 2 }, { value: "bob", frequency: 2 }],
      },
      {
        column: "safe_label", kind: "enum_like", sampleCount: 4, distinctCount: 2,
        candidates: [{ value: "admin", frequency: 3 }, { value: "guest", frequency: 1 }],
      },
    ], new Set(["password", "safe_label"]));
    assert.ok(blocked.every((entry) => !("candidates" in entry)));
    assert.doesNotMatch(JSON.stringify(blocked), /alice|bob|admin|guest/);

    const plan = planFor({ name: "password" }, blocked);
    assert.equal(plan.columns[0].inference.recommendation, null);
    assert.equal(plan.columns[0].rule.kind, "varchar");
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
