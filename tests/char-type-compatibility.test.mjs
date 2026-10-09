import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exportCsv } from "../src/export/csv-exporter.mjs";
import { createExportDataset } from "../src/export/export-dataset.mjs";
import { exportJson } from "../src/export/json-exporter.mjs";
import { exportInsertSql } from "../src/export/sql-exporter.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { executeGenerationPreview } from "../src/generation/generation-runtime.mjs";
import { DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { interpretColumnType, interpretStringCapacity } from "../src/schema/schema-interpreter.mjs";
import { checkSemanticCompatibility } from "../src/semantic/semantic-inference.mjs";

const TABLE_CONTEXT = Object.freeze({ connectionId: "char-compat-connection", database: "bilibili", table: "char_compat" });

function testColumn(name, dataType, length = { state: "unavailable" }) {
  return {
    name,
    dataType: { state: "known", value: dataType },
    nullable: { state: "known", value: false },
    length,
    precision: { state: "unsupported" },
    scale: { state: "unsupported" },
  };
}

function categoricalEvidence(column) {
  return {
    column,
    kind: "enum_like",
    sampleCount: 4,
    distinctCount: 2,
    candidates: [
      { value: "open", frequency: 3 },
      { value: "closed", frequency: 1 },
    ],
  };
}

describe("CHAR(n) schema type compatibility", () => {
  it("normalizes the complete character family without matching unrelated type names", () => {
    const cases = [
      ["CHAR", { state: "known", value: 1 }, 1],
      ["CHAR(7)", undefined, 7],
      ["char(32)", undefined, 32],
      ["CHAR(36)", undefined, 36],
      ["CHAR(64)", undefined, 64],
      ["Char(36)", undefined, 36],
      ["CHAR ( 32 )", undefined, 32],
      ["CHARACTER(20)", undefined, 20],
      ["varchar(255)", undefined, 255],
      ["TEXT", { state: "unsupported" }, null],
      ["NCHAR(20)", undefined, 20],
      ["NVARCHAR(100)", undefined, 100],
    ];

    for (const [dataType, length, expectedLength] of cases) {
      const column = testColumn("value", dataType, length ?? { state: "unsupported" });
      const interpreted = interpretColumnType(column);
      assert.equal(interpreted?.kind, "varchar", `${dataType} is a recognized character type`);
      const capacity = interpretStringCapacity(column);
      if (expectedLength === null) {
        assert.equal(capacity?.model, "unbounded", `${dataType} retains its unbounded semantics`);
      } else {
        assert.equal(capacity?.model, "bounded", `${dataType} has a proven maximum`);
        assert.equal(capacity.maxLength, expectedLength, `${dataType} preserves the right length`);
      }
    }

    const nationalPlan = buildGenerationPlan({
      tableIdentity: "national-character-family",
      columns: [
        { name: "fixed_label", dataType: "NCHAR(20)", nullable: false },
        { name: "varying_label", dataType: "NVARCHAR(100)", nullable: false },
      ],
    }, { rowCount: 4, seed: "national-character-family" });
    assert.equal(nationalPlan.status, "ready");
    assert.deepEqual(nationalPlan.columns.map(({ rule }) => rule.parameters.schemaMaxLength), [20, 100]);
    assert.equal(generateRows(nationalPlan).rows.length, 4);

    assert.equal(interpretColumnType(testColumn("amount", "DECIMAL(10,2)"))?.kind, "decimal");
    assert.equal(interpretColumnType(testColumn("bytes", "BINARY(16)")), null);
    assert.equal(interpretColumnType(testColumn("bytes", "VARBINARY(16)")), null);
    assert.equal(interpretColumnType(testColumn("opaque", "UNKNOWN_TYPE(32)")), null);
  });

  it("generates 20 deterministic rows from raw DBX CHAR(n) metadata and supports every export", async () => {
    const rawTypes = ["char(7)", "char(32)", "char(36)", "char(64)"];
    const provider = new DbxHostSchemaMetadataProvider({
      capabilities: { schemaMetadataApi: true },
      async getTableMetadata() {
        return {
          columns: rawTypes.map((dataType, index) => ({ name: `code_${index}`, dataType, nullable: false })),
          fieldCapabilities: { length: "unsupported", precision: "unsupported", scale: "unsupported", default: "unsupported" },
        };
      },
    });
    const schema = await provider.getTableMetadata({ tableContext: TABLE_CONTEXT });
    assert.deepEqual(schema.columns.map(({ dataType }) => dataType.value), rawTypes,
      "the provider preserves the host's declared type text");

    const options = { rowCount: 20, seed: "char-family-seed", locale: "en" };
    const first = executeGenerationPreview(schema, options);
    const replay = executeGenerationPreview(schema, options);
    assert.equal(first.plan.status, "ready");
    assert.equal(first.generated.status, "ready");
    assert.equal(first.generated.rows.length, 20);
    assert.deepEqual(first.generated.rows, replay.generated.rows, "the same seed yields identical values");
    assert.equal(first.plan.diagnostics.some(({ code }) => code === "unsupported_type" || code === "varchar_length_unknown"), false);

    for (const [index, maximum] of [7, 32, 36, 64].entries()) {
      const columnPlan = first.plan.columns[index];
      assert.equal(columnPlan.rule.kind, "varchar", "CHAR(n) uses the existing string fallback");
      assert.equal(columnPlan.rule.source, "schema_type_fallback");
      assert.equal(columnPlan.rule.parameters.schemaMaxLength, maximum);
      for (const row of first.generated.rows) {
        assert.ok(Array.from(row[`code_${index}`]).length <= maximum,
          `${rawTypes[index]} value must remain within its declared character limit`);
      }
    }
    assert.equal(first.plan.columns[2].rule.kind, "varchar", "CHAR(36) is not inferred as UUID");

    const dataset = createExportDataset(first.plan, first.generated, { table: TABLE_CONTEXT });
    const csv = exportCsv(dataset);
    const json = exportJson(dataset);
    const sql = exportInsertSql(dataset);
    assert.equal(csv.split("\r\n").length, 21);
    assert.equal(JSON.parse(json).length, 20);
    assert.equal((sql.match(/INSERT INTO/g) ?? []).length, 20);
  });

  it("keeps the declared maximum authoritative for explicit and Unicode string values", () => {
    const schema = { tableIdentity: "char-unicode", columns: [{ name: "label", dataType: "CHAR(2)", nullable: false }] };
    const valid = buildGenerationPlan(schema, {
      rowCount: 2,
      seed: "unicode-char",
      rules: { label: { kind: "constant", value: "汉🙂" } },
    });
    assert.equal(valid.status, "ready");
    assert.ok(generateRows(valid).rows.every(({ label }) => Array.from(label).length === 2));

    const overflow = buildGenerationPlan(schema, {
      rowCount: 1,
      seed: "unicode-char-overflow",
      rules: { label: { kind: "constant", value: "汉🙂a" } },
    });
    assert.equal(overflow.status, "blocked");
    assert.equal(overflow.diagnostics.some(({ code }) => code === "generation_rule_incompatible"), true);
  });

  it("preserves explicit-rule and sample precedence, sensitive-field protection, and semantic length checks", () => {
    const schema = {
      tableIdentity: "char-rule-priority",
      columns: [
        { name: "explicit_label", dataType: "CHAR(7)", nullable: false },
        { name: "safe_label", dataType: "CHAR(7)", nullable: false },
        { name: "password", dataType: "CHAR(32)", nullable: false },
        { name: "uuid_value", dataType: "CHAR(36)", nullable: false },
      ],
    };
    const plan = buildGenerationPlan(schema, {
      rowCount: 20,
      seed: "char-priority",
      rules: { explicit_label: { kind: "constant", value: "manual" } },
      sampleEvidence: [
        categoricalEvidence("explicit_label"),
        categoricalEvidence("safe_label"),
        categoricalEvidence("password"),
      ],
    });
    assert.equal(plan.status, "ready");
    const byName = (name) => plan.columns.find(({ schema: column }) => column.name === name);
    assert.equal(byName("explicit_label").rule.source, "explicit_user_rule");
    assert.equal(byName("explicit_label").rule.kind, "constant");
    assert.equal(byName("safe_label").rule.source, "sample_inference");
    assert.equal(byName("safe_label").rule.kind, "sample_enum");
    assert.equal(byName("password").rule.source, "schema_type_fallback");
    assert.notEqual(byName("password").rule.kind, "sample_enum");
    assert.equal(byName("uuid_value").rule.kind, "varchar", "length 36 alone never selects UUID generation");
    const generated = generateRows(plan);
    assert.equal(generated.status, "ready");
    assert.ok(generated.rows.every(({ explicit_label }) => explicit_label === "manual"));
    assert.ok(generated.rows.every(({ password }) => password !== "open" && password !== "closed"));

    const email = testColumn("email", "CHAR(32)");
    const compatible = checkSemanticCompatibility(email, "email", "en");
    assert.equal(compatible.compatible, true);
    assert.equal(compatible.lengthKnown, true, "declared CHAR length participates in semantic validation");
    const tooShort = checkSemanticCompatibility(testColumn("email", "CHAR(20)"), "email", "en");
    assert.equal(tooShort.compatible, false, "semantic markers that exceed CHAR(n) remain incompatible");

    const semanticPlan = buildGenerationPlan({
      tableIdentity: "char-semantic-length",
      columns: [{ name: "email", dataType: "CHAR(32)", nullable: false }],
    }, { rowCount: 20, seed: "char-semantic", semanticMappings: { email: "email" } });
    assert.equal(semanticPlan.status, "ready_with_warnings");
    assert.equal(semanticPlan.columns[0].rule.kind, "semantic:email");
    assert.ok(generateRows(semanticPlan).rows.every(({ email: value }) => Array.from(value).length <= 32));
  });

  it("diagnoses malformed or unrepresentable CHAR lengths instead of hiding the error", () => {
    for (const dataType of ["CHAR(0)", "CHAR(9007199254740992)"]) {
      const plan = buildGenerationPlan({
        tableIdentity: "invalid-char-length",
        columns: [{ name: "label", dataType, nullable: false }],
      }, { rowCount: 1, seed: "invalid-char-length" });
      assert.equal(plan.status, "blocked", dataType);
      assert.equal(plan.diagnostics.some(({ code }) => code === "unsupported_type"), false, dataType);
      const diagnostic = plan.diagnostics.find(({ code }) => code === "invalid_length");
      assert.equal(diagnostic.severity, "error", dataType);
      assert.equal(diagnostic.blocking, true, dataType);
      assert.match(diagnostic.reason, /positive (safe )?integer/, dataType);
    }
  });

  it("continues to block unsupported types with the original located diagnostic", () => {
    const plan = buildGenerationPlan({
      tableIdentity: "unsupported-character-family",
      columns: [{ name: "opaque", dataType: "UNKNOWN_TYPE(32)", nullable: false }],
    }, { rowCount: 20, seed: "unknown-type" });
    const diagnostic = plan.diagnostics.find(({ code }) => code === "unsupported_type");
    assert.equal(plan.status, "blocked");
    assert.equal(diagnostic.severity, "unsupported");
    assert.equal(diagnostic.blocking, true);
    assert.equal(diagnostic.table, "unsupported-character-family");
    assert.equal(diagnostic.column, "opaque");
    assert.equal(diagnostic.rule, "schema:opaque");
    assert.match(diagnostic.reason, /UNKNOWN_TYPE\(32\)/);
    assert.deepEqual(generateRows(plan).rows, []);

    for (const dataType of ["BINARY(16)", "VARBINARY(16)", "UNKNOWN_TYPE(32)"]) {
      const binaryPlan = buildGenerationPlan({
        tableIdentity: "unrelated-type",
        columns: [{ name: "opaque", dataType, nullable: false }],
      }, { rowCount: 1, seed: "unrelated-type" });
      assert.equal(binaryPlan.diagnostics.some(({ code }) => code === "unsupported_type"), true, dataType);
    }
  });
});
