import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { getCompatibleGenerationRules } from "../src/generation/generation-rules.mjs";
import { describeDiagnostic } from "../src/i18n/diagnostics.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import { DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { interpretColumnType, interpretStringCapacity } from "../src/schema/schema-interpreter.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";

const zh = createI18n("zh-CN");
const en = createI18n("en-US");
const BASE_CONTEXT = Object.freeze({ connectionId: "connection-A", database: "test", schema: "dwp", table: "audit_results" });

const KNOWN_NULLABLE = Object.freeze({ state: "known", value: true });
const UNAVAILABLE_LENGTH = Object.freeze({
  state: "unavailable",
  reason: "DBX supports length metadata but omitted it for this column.",
});

/** @param {string} dataType @param {Record<string, unknown>} [length] */
function column(name, dataType, length = { state: "unsupported" }, extra = {}) {
  return {
    name,
    dataType: { state: "known", value: dataType },
    nullable: KNOWN_NULLABLE,
    length,
    precision: { state: "unsupported" },
    scale: { state: "unsupported" },
    default: { state: "known", value: null },
    identity: { state: "unknown" },
    ...extra,
  };
}

function planFor(columns, options = {}) {
  return buildGenerationPlan({ tableIdentity: "string-capacity:test", columns }, { rowCount: 8, seed: "capacity", ...options });
}

function generatedValues(plan, columnName) {
  const result = generateRows(plan);
  assert.notEqual(result.status, "blocked", JSON.stringify(result.diagnostics));
  return result.rows.map((row) => row[columnName]);
}

function hostFor(columns, fieldCapabilities = null) {
  const response = {
    columns,
    fieldCapabilities: fieldCapabilities ?? { length: "supported", precision: "supported", scale: "supported", default: "supported" },
  };
  return new DbxHostSchemaMetadataProvider({
    capabilities: { schemaMetadataApi: true },
    async getTableMetadata() {
      return response;
    },
  });
}

function previewCore() {
  return async (schema, options) => {
    const plan = buildGenerationPlan(schema, options);
    const generated = generateRows(plan);
    return JSON.parse(JSON.stringify({ plan, generated }));
  };
}

describe("string capacity classification", () => {
  it("classifies bounded, unbounded, unknown, and invalid capacity without database-name branches", () => {
    assert.deepEqual(interpretStringCapacity(column("varchar(32)", "varchar(32)", { state: "known", value: 32 })), {
      model: "bounded",
      maxLength: 32,
      source: "structured-length",
    });
    assert.deepEqual(interpretStringCapacity(column("varchar(32)", "varchar(32)", UNAVAILABLE_LENGTH)), {
      model: "bounded",
      maxLength: 32,
      source: "declared-type",
    });
    assert.deepEqual(interpretStringCapacity(column("text", "text", UNAVAILABLE_LENGTH)), {
      model: "unbounded",
      source: "native-text-type",
    });
    assert.deepEqual(interpretStringCapacity(column("text", "text", { state: "unsupported" })), {
      model: "unbounded",
      source: "native-text-type",
    });
    assert.deepEqual(interpretStringCapacity(column("varchar", "varchar", { state: "absent" })), {
      model: "unbounded",
      source: "explicit-no-length",
    });

    const unknown = interpretStringCapacity(column("varchar", "varchar", UNAVAILABLE_LENGTH));
    assert.equal(unknown.model, "unknown");
    assert.equal(unknown.factState, "unavailable");
    assert.match(unknown.reason, /capacity is unknown/);
    assert.doesNotMatch(unknown.reason, /varchar maximum length is unavailable; a maximum cannot be verified$/);

    const unsupported = interpretStringCapacity(column("varchar", "varchar", { state: "unsupported" }));
    assert.equal(unsupported.model, "unknown");
    assert.match(unsupported.reason, /length metadata is unsupported$/);

    assert.equal(interpretStringCapacity(column("integer", "integer"))?.model, undefined);
    assert.equal(interpretStringCapacity(column("integer", "integer")), null);

    const invalid = interpretStringCapacity(column("varchar", "varchar", { state: "known", value: 0 }));
    assert.equal(invalid.model, "invalid");

    assert.equal(interpretColumnType(column("text", "text", UNAVAILABLE_LENGTH)).capacity.model, "unbounded");
    assert.equal(interpretColumnType(column("integer", "integer")).capacity, undefined);
  });
});

describe("unbounded text no longer blocks the core generation flow", () => {
  const auditResultsColumns = [
    { name: "id", dataType: "bigint", nullable: false },
    { name: "task_id", dataType: "bigint", nullable: false },
    ...["category", "file_name", "rule_name", "level", "message"].map((name) => ({ name, dataType: "text", nullable: true })),
    { name: "line_no", dataType: "integer", nullable: true },
  ];

  it("keeps the DBX contract reproduction (audit_results) generatable end to end", async () => {
    const schema = await hostFor(auditResultsColumns).getTableMetadata({ tableContext: BASE_CONTEXT });
    const category = schema.columns.find((entry) => entry.name === "category");
    assert.equal(category.length.state, "unavailable", "reproduces the DBX fieldCapabilities.length=supported + omitted length shape");
    assert.match(category.length.reason, /omitted it for this column/);

    const plan = buildGenerationPlan(schema, { rowCount: 3, seed: "audit-results" });
    assert.equal(plan.diagnostics.some((diagnostic) => diagnostic.code === "varchar_length_unknown"), false);
    assert.notEqual(plan.status, "blocked");

    const generated = generateRows(plan);
    assert.notEqual(generated.status, "blocked");
    assert.equal(generated.rows.length, 3);
    for (const name of ["category", "file_name", "rule_name", "level", "message"]) {
      const values = generated.rows.map((row) => row[name]).filter((value) => value !== null);
      assert.ok(values.length >= 1);
      for (const value of values) {
        assert.equal(typeof value, "string");
        assert.ok(value.length >= 1 && value.length <= 16, `${name} stays inside the generation budget`);
      }
    }
    assert.equal(generated.rows.some((row) => typeof row.message === "string"), true);

    const textPlanColumn = plan.columns.find((entry) => entry.schema.name === "message");
    assert.equal(textPlanColumn.rule.parameters.schemaMaxLength, null, "the generation budget is not written back as a schema maximum");
  });

  it("does not invent a 255-style maximum for unbounded text", () => {
    const plan = planFor([column("message", "text", UNAVAILABLE_LENGTH)]);
    assert.equal(plan.status, "ready");
    assert.equal(plan.columns[0].rule.parameters.schemaMaxLength, null);
    const values = generatedValues(plan, "message");
    assert.ok(values.every((value) => value.length <= 16));
    assert.equal(plan.diagnostics.length, 0);
  });

  it("allows explicit values longer than the generation budget when the schema has no bound", () => {
    const long = "x".repeat(200);
    const plan = planFor([column("message", "text", UNAVAILABLE_LENGTH)], {
      rules: { message: { kind: "constant", value: long } },
    });
    assert.equal(plan.status, "ready");
    assert.ok(generatedValues(plan, "message").every((value) => value === long));
  });

  it("treats an explicit no-length fact as unbounded without a diagnostic", () => {
    const plan = planFor([column("label", "varchar", { state: "absent", reason: "DBX explicitly returned null for length." })]);
    assert.equal(plan.status, "ready");
    assert.equal(plan.diagnostics.some((diagnostic) => diagnostic.code === "varchar_length_unknown"), false);
    assert.equal(plan.columns[0].rule.parameters.schemaMaxLength, null);
  });
});

describe("bounded string protection is preserved", () => {
  it("honors varchar(32) and keeps generated output within the bound", () => {
    const plan = planFor([column("label", "varchar(32)", { state: "known", value: 32 })]);
    assert.equal(plan.status, "ready");
    assert.equal(plan.columns[0].rule.parameters.schemaMaxLength, 32);
    const values = generatedValues(plan, "label");
    assert.ok(values.every((value) => value.length >= 1 && value.length <= 32));
  });

  it("enforces varchar(8) for generated values, constants, and random strings", () => {
    const schema = [column("code", "varchar(8)", { state: "known", value: 8 })];
    const plan = planFor(schema);
    assert.ok(generatedValues(plan, "code").every((value) => value.length <= 8));

    const constantOverflow = planFor(schema, { rules: { code: { kind: "constant", value: "123456789" } } });
    assert.equal(constantOverflow.status, "blocked");
    assert.equal(constantOverflow.diagnostics.some((diagnostic) => diagnostic.code === "generation_rule_incompatible"), true);

    const randomOverflow = planFor(schema, { rules: { code: { kind: "random_string", length: 9 } } });
    assert.equal(randomOverflow.status, "blocked");
    assert.match(randomOverflow.diagnostics.find((diagnostic) => diagnostic.code === "generation_rule_incompatible").reason, /exceeds schema maximum length 8/);
  });

  it("uses a declared typmod when structured length is missing but still caps generation", () => {
    const plan = planFor([column("label", "varchar(64)", UNAVAILABLE_LENGTH)]);
    assert.equal(plan.status, "ready");
    assert.equal(plan.columns[0].rule.parameters.schemaMaxLength, 64);
    assert.ok(generatedValues(plan, "label").every((value) => value.length <= 16));
    const overflow = planFor([column("label", "varchar(64)", UNAVAILABLE_LENGTH)], {
      rules: { label: { kind: "constant", value: "x".repeat(65) } },
    });
    assert.equal(overflow.status, "blocked");
  });
});

describe("unknown capacity stays conservative and accurate", () => {
  it("does not silently treat a bare varchar with missing metadata as unbounded", () => {
    for (const length of [UNAVAILABLE_LENGTH, { state: "unknown" }, { state: "unsupported" }]) {
      const plan = planFor([column("label", "varchar", length)]);
      assert.equal(plan.status, "blocked");
      const diagnostic = plan.diagnostics.find((entry) => entry.code === "varchar_length_unknown");
      assert.equal(diagnostic?.blocking, true);
      assert.equal(diagnostic?.severity, "unsupported");
      assert.match(diagnostic.reason, /capacity is unknown/);
      assert.equal(plan.columns[0].rule.parameters.schemaMaxLength, undefined, "unknown capacity must not fall back to a fabricated bound");
    }
  });

  it("keeps malformed bounded metadata an error instead of downgrading it", () => {
    const plan = planFor([column("label", "varchar", { state: "known", value: 0 })]);
    assert.equal(plan.status, "blocked");
    const diagnostic = plan.diagnostics.find((entry) => entry.code === "invalid_length");
    assert.equal(diagnostic?.severity, "error");
    assert.equal(diagnostic?.blocking, true);
  });

  it("exposes rule availability from capacity, not from a literal length state", () => {
    const textRules = getCompatibleGenerationRules(column("message", "text", UNAVAILABLE_LENGTH));
    assert.ok(textRules.includes("random_string"));
    assert.ok(textRules.includes("uuid"));
    const unknownRules = getCompatibleGenerationRules(column("label", "varchar", UNAVAILABLE_LENGTH));
    assert.deepEqual(unknownRules, ["auto"]);
  });

  it("keeps the unknown-capacity diagnostic localizable and stable", () => {
    const plan = planFor([column("label", "varchar", { state: "unsupported" })]);
    const diagnostic = plan.diagnostics.find((entry) => entry.code === "varchar_length_unknown");
    for (const translator of [zh, en]) {
      const described = describeDiagnostic(diagnostic, translator);
      assert.equal(described.code, "varchar_length_unknown");
      assert.equal(described.blocking, true);
      assert.ok(described.title.length > 0);
      assert.equal(described.technical.reason, diagnostic.reason);
    }
    assert.match(describeDiagnostic(diagnostic, zh).title, /无法确认文本字段的最大长度/);
  });
});

describe("Workbench state follows the capacity fix", () => {
  it("enables Generate, Preview, and Export for a table whose only text columns are unbounded", async () => {
    const provider = hostFor([
      { name: "id", dataType: "bigint", nullable: false },
      { name: "category", dataType: "text", nullable: true },
      { name: "message", dataType: "text", nullable: true },
    ]);
    for (const translator of [zh, en]) {
      const controller = new DbxGenerationWorkbenchController({ provider, preview: previewCore(), translator });
      const view = await controller.setContext(BASE_CONTEXT);
      assert.notEqual(view.status, "blocked");
      assert.notEqual(view.plan.status, "blocked");
      assert.equal(view.preview.rows.length, 20);
      assert.equal(view.export.enabled, true);
      assert.equal(view.diagnostics.some((entry) => entry.code === "varchar_length_unknown"), false);
      assert.doesNotThrow(() => controller.prepareExport("csv"));
      assert.doesNotThrow(() => controller.prepareExport("json"));
    }
  });

  it("still blocks the Workbench for a genuinely unknown capacity", async () => {
    const provider = hostFor(
      [{ name: "label", dataType: "varchar", nullable: true }],
      { length: "unsupported", precision: "unsupported", scale: "unsupported", default: "supported" },
    );
    const controller = new DbxGenerationWorkbenchController({ provider, preview: previewCore(), translator: zh });
    const view = await controller.setContext(BASE_CONTEXT);
    assert.equal(view.status, "blocked");
    assert.equal(view.export.enabled, false);
    assert.equal(view.diagnostics.find((entry) => entry.code === "varchar_length_unknown")?.blocking, true);
  });
});
