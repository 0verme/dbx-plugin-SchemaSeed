import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createExportDataset } from "../src/export/export-dataset.mjs";
import { exportCsv } from "../src/export/csv-exporter.mjs";
import { exportJson } from "../src/export/json-exporter.mjs";
import { exportInsertSql } from "../src/export/sql-exporter.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { getGenerationRuleEditorFields, validateGenerationRule } from "../src/generation/generation-rules.mjs";
import { GENERATION_PREVIEW_METHOD } from "../src/generation/generation-runtime-contract.mjs";
import { handleGenerationRuntimeRequest } from "../src/generation/generation-runtime-protocol.mjs";
import {
  isSqlBigIntValue,
  parseSqlIntegerText,
  sqlBigIntMaximum,
  sqlBigIntMinimum,
  sqlIntegerFromBigInt,
  sqlIntegerJsonValue,
  sqlIntegerText,
  sqlIntegerToBigInt,
} from "../src/integer-value.mjs";
import { interpretColumnType } from "../src/schema/schema-interpreter.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import {
  canEditEnumCandidatesAsTags,
  parseCandidateJson,
  parseCandidateText,
} from "../ui/generation-workbench/candidate-input.mjs";

const BIGINT_MIN = -(1n << 63n);
const BIGINT_MAX = (1n << 63n) - 1n;
const FIRST_UNSAFE = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
const asScalar = sqlIntegerFromBigInt;
const textOf = (value) => sqlIntegerText(value);
const schemaFor = (columns, tableIdentity = "exact-bigint:test") => normalizeTableSchema({ tableIdentity, columns }).schema;
const integerColumn = (name = "value", dataType = "bigint", extra = {}) => ({ name, dataType, nullable: false, ...extra });

function rpcRequest(schema, options, id = "bigint") {
  return {
    jsonrpc: "2.0",
    id,
    method: GENERATION_PREVIEW_METHOD,
    params: { schema, options },
  };
}

describe("exact signed SQL BIGINT support", () => {
  it("defines a JSON-safe exact scalar and retains the full signed 64-bit schema domain", () => {
    assert.equal(sqlBigIntMinimum(), BIGINT_MIN);
    assert.equal(sqlBigIntMaximum(), BIGINT_MAX);
    assert.equal(sqlIntegerToBigInt(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER));
    assert.equal(sqlIntegerToBigInt(Number.MAX_SAFE_INTEGER + 1), null);
    assert.equal(sqlIntegerToBigInt(asScalar(FIRST_UNSAFE)), FIRST_UNSAFE);
    assert.equal(isSqlBigIntValue(asScalar(FIRST_UNSAFE)), true);
    assert.equal(Object.isFrozen(asScalar(FIRST_UNSAFE)), true);
    assert.deepEqual(JSON.parse(JSON.stringify(asScalar(BIGINT_MIN))), {
      $schemaSeedType: "sql-bigint", value: "-9223372036854775808",
    });
    assert.equal(sqlIntegerJsonValue(asScalar(BIGINT_MAX)), "9223372036854775807");
    assert.equal(sqlIntegerText(asScalar(BIGINT_MIN)), "-9223372036854775808");
    assert.throws(() => asScalar(BIGINT_MAX + 1n), RangeError);
    assert.equal(isSqlBigIntValue({ $schemaSeedType: "sql-bigint", value: "9007199254740991" }), false,
      "a tagged safe number is non-canonical; safe values remain numbers");
    assert.equal(isSqlBigIntValue({ $schemaSeedType: "sql-bigint", value: "01" }), false);
    assert.equal(isSqlBigIntValue({ $schemaSeedType: "sql-bigint", value: "9223372036854775808" }), false);
    assert.equal(isSqlBigIntValue({ $schemaSeedType: "sql-bigint", value: "9".repeat(10000) }), false);

    const interpreted = interpretColumnType(schemaFor([integerColumn("id", "BIGINT")]).columns[0]);
    assert.equal(interpreted.kind, "integer");
    assert.equal(sqlIntegerToBigInt(interpreted.parameters.schemaMin), BIGINT_MIN);
    assert.equal(sqlIntegerToBigInt(interpreted.parameters.schemaMax), BIGINT_MAX);
    assert.deepEqual(JSON.parse(JSON.stringify(interpreted.parameters)), {
      schemaMin: { $schemaSeedType: "sql-bigint", value: "-9223372036854775808" },
      schemaMax: { $schemaSeedType: "sql-bigint", value: "9223372036854775807" },
    });
    const narrower = interpretColumnType(schemaFor([integerColumn("id", "INTEGER")]).columns[0]);
    assert.equal(narrower.parameters.schemaMin, -2147483648);
    assert.equal(narrower.parameters.schemaMax, 2147483647);
  });

  it("parses type-aware UI integers exactly and rejects unsafe JSON numbers", () => {
    assert.deepEqual(parseSqlIntegerText("+0009007199254740992"), { ok: true, value: asScalar(FIRST_UNSAFE) });
    assert.deepEqual(parseSqlIntegerText("-9223372036854775808"), { ok: true, value: asScalar(BIGINT_MIN) });
    assert.deepEqual(parseSqlIntegerText("9223372036854775808"), { ok: false, reason: "integer-range" });
    assert.deepEqual(parseSqlIntegerText("9".repeat(10000)), { ok: false, reason: "integer-range" });
    assert.deepEqual(parseSqlIntegerText("1.25"), { ok: false, reason: "invalid-integer" });
    assert.deepEqual(parseCandidateText("integer", "9223372036854775807"), {
      ok: true, value: asScalar(BIGINT_MAX),
    });
    assert.equal(canEditEnumCandidatesAsTags("integer", [asScalar(BIGINT_MIN), asScalar(BIGINT_MAX)]), true);
    assert.deepEqual(parseCandidateJson('[9223372036854775807]', "integer"), {
      ok: false, reason: "integer-range",
    }, "raw JSON numeric tokens are rejected rather than rounded by JSON.parse");
    assert.deepEqual(parseCandidateJson('[{"$schemaSeedType":"sql-bigint","value":"9223372036854775807"}]', "integer"), {
      ok: true, values: [asScalar(BIGINT_MAX)],
    });
  });

  it("validates rules exactly, while preserving numeric-looking VARCHAR strings", () => {
    const bigint = schemaFor([integerColumn()]).columns[0];
    const varchar = schemaFor([{ name: "value", dataType: "varchar", length: 32, nullable: false }]).columns[0];
    for (const value of [asScalar(BIGINT_MIN), asScalar(BIGINT_MAX), asScalar(FIRST_UNSAFE), Number.MAX_SAFE_INTEGER]) {
      assert.equal(validateGenerationRule(bigint, { kind: "constant", value }).valid, true, textOf(value));
    }
    assert.deepEqual(getGenerationRuleEditorFields(bigint, { kind: "constant", value: asScalar(BIGINT_MAX) }), [
      { key: "value", label: "Integer value", editor: "integer", value: asScalar(BIGINT_MAX) },
    ], "the Workbench edits exact integer constants as decimal text rather than JSON number fields");
    assert.equal(validateGenerationRule(bigint, { kind: "constant", value: Number.MAX_SAFE_INTEGER + 1 }).valid, false);
    assert.equal(validateGenerationRule(bigint, { kind: "constant", value: 1.25 }).valid, false);
    assert.equal(validateGenerationRule(bigint, { kind: "constant", value: null }).valid, false);
    assert.equal(validateGenerationRule(bigint, { kind: "constant", value: "9223372036854775807" }).valid, false);
    assert.equal(validateGenerationRule(bigint, {
      kind: "constant", value: { $schemaSeedType: "sql-bigint", value: "9223372036854775808" },
    }).valid, false);
    assert.equal(validateGenerationRule(bigint, { kind: "enum", values: [asScalar(FIRST_UNSAFE), asScalar(FIRST_UNSAFE)] }).valid, false);
    assert.equal(validateGenerationRule(bigint, {
      kind: "random_integer", min: asScalar(FIRST_UNSAFE), max: asScalar(FIRST_UNSAFE + 10n),
    }).valid, true);
    assert.equal(validateGenerationRule(varchar, { kind: "constant", value: "9223372036854775807" }).valid, true);
    assert.equal(validateGenerationRule(varchar, { kind: "constant", value: asScalar(BIGINT_MAX) }).valid, false);
  });

  it("generates deterministic exact Sequence and Random Integer values through both schema bounds", () => {
    const schema = schemaFor([integerColumn()]);
    const atMaximum = buildGenerationPlan(schema, {
      rowCount: 4,
      seed: "int64-max-sequence",
      rules: { value: { kind: "sequence", start: asScalar(BIGINT_MAX - 3n), step: 1 } },
      constraints: [{ id: "exact-sequence-unique", kind: "unique", column: "value" }],
    });
    assert.equal(atMaximum.status, "ready", JSON.stringify(atMaximum.diagnostics));
    const maximumRows = generateRows(atMaximum);
    assert.equal(maximumRows.status, "ready");
    assert.deepEqual(maximumRows.rows.map((row) => sqlIntegerToBigInt(row.value)), [BIGINT_MAX - 3n, BIGINT_MAX - 2n, BIGINT_MAX - 1n, BIGINT_MAX]);
    const roundTrippedPlan = JSON.parse(JSON.stringify(atMaximum));
    assert.deepEqual(generateRows(roundTrippedPlan), maximumRows, "GenerationPlan JSON round-trip preserves exact deterministic values");

    const atMinimum = buildGenerationPlan(schema, {
      rowCount: 3,
      seed: "int64-min-sequence",
      rules: { value: { kind: "sequence", start: asScalar(BIGINT_MIN), step: 1 } },
    });
    assert.deepEqual(generateRows(atMinimum).rows.map((row) => sqlIntegerToBigInt(row.value)), [BIGINT_MIN, BIGINT_MIN + 1n, BIGINT_MIN + 2n]);
    const overflow = buildGenerationPlan(schema, {
      rowCount: 5,
      rules: { value: { kind: "sequence", start: asScalar(BIGINT_MAX - 3n), step: 1 } },
    });
    assert.equal(overflow.status, "blocked");
    assert.ok(overflow.diagnostics.some((entry) => entry.code === "generation_sequence_overflow"));

    const random = buildGenerationPlan(schema, {
      rowCount: 64,
      seed: "int64-random-range",
      rules: { value: { kind: "random_integer", min: asScalar(FIRST_UNSAFE), max: asScalar(FIRST_UNSAFE + 127n) } },
    });
    const first = generateRows(random);
    assert.equal(first.status, "ready");
    assert.deepEqual(generateRows(random), first);
    assert.ok(first.rows.every(({ value }) => {
      const exact = sqlIntegerToBigInt(value);
      return exact !== null && exact >= FIRST_UNSAFE && exact <= FIRST_UNSAFE + 127n;
    }));
    assert.deepEqual(generateRows(JSON.parse(JSON.stringify(random))), first);
  });

  it("allocates composite uniqueness with exact BIGINT identity values", () => {
    const schema = schemaFor([
      integerColumn("id"),
      { name: "tag", dataType: "varchar", length: 8, nullable: false },
    ], "exact-bigint:composite");
    const plan = buildGenerationPlan(schema, {
      rowCount: 3,
      seed: "int64-composite-unique",
      rules: {
        id: { kind: "constant", value: asScalar(BIGINT_MAX) },
        tag: { kind: "enum", values: ["a", "b", "c"] },
      },
      constraints: [{ id: "bigint-tag-unique", kind: "composite_unique", columns: ["id", "tag"] }],
    });
    const generated = generateRows(plan);
    assert.equal(generated.status, "ready", JSON.stringify(generated.diagnostics));
    assert.equal(new Set(generated.rows.map((row) => JSON.stringify([textOf(row.id), row.tag]))).size, 3);
    assert.ok(generated.rows.every((row) => textOf(row.id) === "9223372036854775807"));
  });

  it("does not reinterpret a tagged-looking object inside a JSON document as a BIGINT scalar", () => {
    const schema = schemaFor([{ name: "payload", dataType: "json", nullable: false }], "exact-bigint:json-document");
    const document = { $schemaSeedType: "sql-bigint", value: "9223372036854775807" };
    const plan = buildGenerationPlan(schema, {
      rowCount: 1,
      seed: "int64-json-document",
      rules: { payload: { kind: "constant", value: document } },
    });
    const generated = generateRows(plan);
    assert.equal(generated.status, "ready");
    const dataset = createExportDataset(plan, generated);
    const rows = JSON.parse(exportJson(dataset));
    assert.deepEqual(rows[0].payload, document);
    assert.equal(typeof rows[0].payload, "object");
  });

  it("preserves BIGINT, VARCHAR, NULL, and numeric SQL types across ExportDataset and all serializers", () => {
    const schema = schemaFor([
      integerColumn("id"),
      { name: "numeric_text", dataType: "varchar", length: 32, nullable: false },
      integerColumn("optional_id", "bigint", { nullable: true }),
    ], "exact-bigint:export");
    const plan = buildGenerationPlan(schema, {
      rowCount: 3,
      seed: "int64-export",
      rules: {
        id: { kind: "enum", values: [asScalar(BIGINT_MIN), asScalar(BIGINT_MAX), asScalar(FIRST_UNSAFE)] },
        numeric_text: { kind: "constant", value: "-9223372036854775808" },
        optional_id: { kind: "null_ratio", ratio: 1 },
      },
      constraints: [{ id: "bigint-unique", kind: "unique", column: "id" }],
    });
    assert.equal(plan.status, "ready", JSON.stringify(plan.diagnostics));
    const wirePlan = JSON.parse(JSON.stringify(plan));
    assert.deepEqual(generateRows(wirePlan), generateRows(plan));
    const generated = generateRows(plan);
    assert.equal(generated.status, "ready");
    assert.deepEqual(new Set(generated.rows.map((row) => textOf(row.id))), new Set([
      "-9223372036854775808", "9223372036854775807", "9007199254740992",
    ]));
    assert.ok(generated.rows.every((row) => row.numeric_text === "-9223372036854775808" && row.optional_id === null));

    const dataset = createExportDataset(plan, generated, { table: { database: "db", table: "records" } });
    assert.equal(Object.isFrozen(dataset.rows[0].id), true);
    const jsonRows = JSON.parse(exportJson(dataset));
    assert.ok(jsonRows.every((row) => typeof row.id === "string"));
    assert.deepEqual(new Set(jsonRows.map((row) => row.id)), new Set([
      "-9223372036854775808", "9223372036854775807", "9007199254740992",
    ]));
    assert.ok(jsonRows.every((row) => row.numeric_text === "-9223372036854775808" && row.optional_id === null));

    const csv = exportCsv(dataset, { header: false, nullToken: "\\N" });
    for (const exact of ["-9223372036854775808", "9223372036854775807", "9007199254740992"]) assert.ok(csv.includes(exact));
    assert.ok(csv.includes("\\N"));
    const spreadsheetCsv = exportCsv(dataset, { header: false, mode: "spreadsheet_safe" });
    assert.match(spreadsheetCsv, /^-9223372036854775808,'-9223372036854775808,/mu,
      "the exact BIGINT remains numeric while the same-looking VARCHAR text receives the string safety prefix");
    const sql = exportInsertSql(dataset, { header: false });
    assert.match(sql, /VALUES\s+\(\s+-9223372036854775808,\s+'-9223372036854775808',\s+NULL\s+\)/u);
    assert.match(sql, /VALUES\s+\(\s+9223372036854775807,\s+'-9223372036854775808',\s+NULL\s+\)/u);
    assert.match(sql, /VALUES\s+\(\s+9007199254740992,\s+'-9223372036854775808',\s+NULL\s+\)/u);
  });

  it("round-trips exact rule values through the generation JSON protocol without a Number conversion", () => {
    const schema = {
      tableIdentity: "exact-bigint:rpc",
      columns: [integerColumn("id")],
    };
    const options = {
      rowCount: 3,
      seed: "int64-rpc",
      locale: "en",
      rules: { id: { kind: "sequence", start: asScalar(BIGINT_MAX - 2n), step: 1 } },
    };
    const request = JSON.parse(JSON.stringify(rpcRequest(schema, options)));
    const response = handleGenerationRuntimeRequest(request);
    assert.equal(response.error, undefined);
    const wireResponse = JSON.parse(JSON.stringify(response));
    assert.deepEqual(wireResponse.result.generated.rows.map((row) => sqlIntegerToBigInt(row.id)), [BIGINT_MAX - 2n, BIGINT_MAX - 1n, BIGINT_MAX]);
    assert.deepEqual(wireResponse.result.generated.rows.map((row) => sqlIntegerText(row.id)), [
      "9223372036854775805", "9223372036854775806", "9223372036854775807",
    ]);
  });
});
