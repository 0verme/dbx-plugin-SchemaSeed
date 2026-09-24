import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import {
  GENERATION_RULE_KINDS,
  generationRuleIdentity,
  getCompatibleGenerationRules,
  validateGenerationRule,
} from "../src/generation/generation-rules.mjs";

const options = { rowCount: 8, seed: "rules-seed" };
const column = (name, dataType, extra = {}) => ({ name, dataType, nullable: false, ...extra });
const planFor = (columns, rules, extra = {}) => buildGenerationPlan(
  { tableIdentity: "rules:test", columns },
  { ...options, ...extra, rules },
);
const rowsFor = (plan) => {
  const result = generateRows(plan);
  assert.notEqual(result.status, "blocked", JSON.stringify(result.diagnostics));
  return result.rows;
};
const diagnostic = (plan, code) => plan.diagnostics.find((entry) => entry.code === code);

const schemas = {
  integer: [column("value", "INTEGER")],
  decimal: [column("value", "DECIMAL", { precision: 5, scale: 2 })],
  varchar: [column("value", "VARCHAR", { length: 20 })],
  boolean: [column("value", "BOOLEAN")],
  date: [column("value", "DATE")],
  timestamp: [column("value", "TIMESTAMP", { precision: 6 })],
};

describe("GenerationRule v0.1 domain model and validation", () => {
  it("declares exactly the frozen 13 tagged selections and compatible availability", () => {
    assert.deepEqual(GENERATION_RULE_KINDS, [
      "auto", "constant", "sequence", "random_integer", "random_decimal", "random_string", "enum",
      "boolean_ratio", "date_range", "timestamp_range", "uuid", "null_ratio", "semantic",
    ]);
    const notNullableInteger = {
      dataType: { state: "known", value: "INTEGER" },
      length: { state: "absent" },
      nullable: { state: "known", value: false },
    };
    assert.ok(getCompatibleGenerationRules(notNullableInteger).includes("sequence"));
    assert.ok(getCompatibleGenerationRules(notNullableInteger).includes("null_ratio"), "ratio 0 is safe even for NOT NULL columns");
    assert.ok(!getCompatibleGenerationRules({
      dataType: { state: "known", value: "TIMESTAMP" }, precision: { state: "known", value: 10 },
    }).includes("timestamp_range"));
    const tinyDecimal = planFor([column("small", "DECIMAL", { precision: 1, scale: 1 })], {});
    assert.equal(tinyDecimal.columns[0].ruleChoices.find((choice) => choice.kind === "random_decimal").draft.max, "0.9");
    assert.equal(planFor([column("i", "INTEGER")], { i: { kind: "null_ratio", ratio: 0 } }).status, "ready");
    assert.equal(planFor([column("i", "INTEGER")], { i: { kind: "null_ratio", ratio: 0.1 } }).status, "blocked");
  });

  it("validates every tagged rule and rejects unknown fields/configs without coercion", () => {
    const cases = [
      [column("i", "INTEGER"), { kind: "auto" }],
      [column("i", "INTEGER"), { kind: "constant", value: 3 }],
      [column("i", "INTEGER"), { kind: "sequence", start: 1, step: 1 }],
      [column("i", "INTEGER"), { kind: "random_integer", min: 1, max: 4 }],
      [column("d", "DECIMAL", { precision: 5, scale: 2 }), { kind: "random_decimal", min: "-1.00", max: "1.00" }],
      [column("s", "VARCHAR", { length: 20 }), { kind: "random_string", length: 4 }],
      [column("s", "VARCHAR", { length: 20 }), { kind: "enum", values: ["a", "b"] }],
      [column("b", "BOOLEAN"), { kind: "boolean_ratio", trueRatio: 0.5 }],
      [column("d", "DATE"), { kind: "date_range", start: "2024-01-01", end: "2024-01-02" }],
      [column("t", "TIMESTAMP", { precision: 3 }), { kind: "timestamp_range", start: "2024-01-01T00:00:00Z", end: "2024-01-02T00:00:00Z" }],
      [column("u", "UUID"), { kind: "uuid" }],
      [column("i", "INTEGER", { nullable: true }), { kind: "null_ratio", ratio: 0.5 }],
      [column("name", "VARCHAR", { length: 64 }), { kind: "semantic", semanticType: "name" }],
    ];
    for (const [schema, rule] of cases) {
      const normalized = buildGenerationPlan({ tableIdentity: "validation", columns: [schema] }, { ...options, rules: { [schema.name]: rule } });
      assert.notEqual(normalized.status, "blocked", `${rule.kind}: ${JSON.stringify(normalized.diagnostics)}`);
      assert.equal(normalized.columns[0].generationRule.kind, rule.kind);
    }
    const invalid = validateGenerationRule(
      { ...column("i", "INTEGER"), dataType: { state: "known", value: "INTEGER" } },
      { kind: "random_integer", min: "1", max: 4, hidden: true },
      { tableIdentity: "t" },
    );
    assert.equal(invalid.valid, false);
    assert.equal(invalid.status, "blocked");
    assert.equal(invalid.rule, null);
    assert.equal(invalid.diagnostics[0].column, "i");
    const explicitNull = planFor(schemas.integer, { value: null });
    assert.equal(explicitNull.status, "blocked");
    assert.equal(explicitNull.columns[0].generationRule.kind, "invalid");
    assert.ok(diagnostic(explicitNull, "generation_rule_invalid"));
  });

  it("uses canonical deterministic identity independent of property insertion order", () => {
    const first = { kind: "random_integer", min: 1, max: 100 };
    const reordered = { max: 100, min: 1, kind: "random_integer" };
    assert.equal(generationRuleIdentity(first), generationRuleIdentity(reordered));
    assert.notEqual(generationRuleIdentity(first), generationRuleIdentity({ ...first, max: 200 }));
  });
});

describe("GenerationRule scalar strategies", () => {
  it("validates Constant types and hard bounds without conversion, truncation, or rounding", () => {
    const compatible = planFor([
      column("integer_value", "INTEGER"),
      column("text_value", "VARCHAR", { length: 3 }),
      column("money", "DECIMAL", { precision: 5, scale: 2 }),
      column("flag", "BOOLEAN"),
      column("day", "DATE"),
      column("instant", "TIMESTAMP", { precision: 3 }),
    ], {
      integer_value: { kind: "constant", value: 42 },
      text_value: { kind: "constant", value: "猫a" },
      money: { kind: "constant", value: "-999.99" },
      flag: { kind: "constant", value: true },
      day: { kind: "constant", value: "2024-02-29" },
      instant: { kind: "constant", value: "2024-02-29T12:30:00.123Z" },
    });
    assert.equal(compatible.status, "ready");
    assert.deepEqual(rowsFor(compatible)[0], {
      integer_value: 42,
      text_value: "猫a",
      money: "-999.99",
      flag: true,
      day: "2024-02-29",
      instant: "2024-02-29T12:30:00.123Z",
    });

    const invalid = planFor([column("age", "INTEGER")], { age: { kind: "constant", value: "42" } });
    assert.equal(invalid.status, "blocked");
    assert.equal(diagnostic(invalid, "generation_rule_incompatible")?.column, "age");
    assert.deepEqual(generateRows(invalid).rows, []);

    const stringOverflow = planFor(schemas.varchar, { value: { kind: "constant", value: "x".repeat(21) } });
    assert.equal(stringOverflow.status, "blocked");
    assert.match(diagnostic(stringOverflow, "generation_rule_incompatible").reason, /truncation is not allowed/);

    const decimalOverflow = planFor([column("money", "DECIMAL", { precision: 5, scale: 2 })], {
      money: { kind: "constant", value: "1000.00" },
    });
    assert.equal(decimalOverflow.status, "blocked");
    assert.match(diagnostic(decimalOverflow, "generation_rule_incompatible").reason, /precision/);
  });

  it("generates Sequence by stable row identity, including negative steps and planning-time overflow", () => {
    const schema = [column("n", "INTEGER")];
    const sequence = planFor(schema, { n: { kind: "sequence", start: 10, step: -3 } }, { rowCount: 4 });
    assert.deepEqual(rowsFor(sequence).map((row) => row.n), [10, 7, 4, 1]);
    assert.deepEqual(rowsFor(sequence), rowsFor(sequence));

    const overflow = planFor([column("n", "TINYINT")], { n: { kind: "sequence", start: 127, step: 1 } }, { rowCount: 2 });
    assert.equal(overflow.status, "blocked");
    assert.equal(diagnostic(overflow, "generation_sequence_overflow")?.column, "n");
    assert.deepEqual(generateRows(overflow).rows, []);

    const decimal = planFor([column("amount", "DECIMAL", { precision: 5, scale: 2 })], {
      amount: { kind: "sequence", start: "1.25", step: "-0.50" },
    }, { rowCount: 4 });
    assert.deepEqual(rowsFor(decimal).map((row) => row.amount), ["1.25", "0.75", "0.25", "-0.25"]);
    const badScale = planFor([column("amount", "DECIMAL", { precision: 5, scale: 2 })], {
      amount: { kind: "sequence", start: "0.001", step: "1.00" },
    });
    assert.equal(badScale.status, "blocked");
  });

  it("bounds Random Integer and is seed-addressed", () => {
    const rule = { value: { kind: "random_integer", min: -20, max: 20 } };
    const first = planFor(schemas.integer, rule);
    const replay = planFor(schemas.integer, rule);
    const different = planFor(schemas.integer, rule, { seed: "different" });
    const values = rowsFor(first).map((row) => row.value);
    assert.deepEqual(values, rowsFor(replay).map((row) => row.value));
    assert.notDeepEqual(values, rowsFor(different).map((row) => row.value));
    assert.ok(values.every((value) => value >= -20 && value <= 20));
    const bad = planFor(schemas.integer, { value: { kind: "random_integer", min: 0, max: Number.MAX_SAFE_INTEGER } });
    assert.equal(bad.status, "blocked", "range must not exceed the declared INTEGER schema domain");
    const reversed = planFor(schemas.integer, { value: { kind: "random_integer", min: 9, max: 2 } });
    assert.equal(reversed.status, "blocked");
  });

  it("respects exact decimal precision and scale at decimal(5,2) and decimal(18,4)", () => {
    const small = planFor([column("amount", "DECIMAL", { precision: 5, scale: 2 })], {
      amount: { kind: "random_decimal", min: "-999.99", max: "999.99" },
    }, { rowCount: 100 });
    const smallValues = rowsFor(small).map((row) => row.amount);
    assert.ok(smallValues.every((value) => /^-?\d{1,3}\.\d{2}$/.test(value)));
    const smallMin = planFor([column("amount", "DECIMAL", { precision: 5, scale: 2 })], {
      amount: { kind: "random_decimal", min: "-999.99", max: "-999.99" },
    });
    const smallMax = planFor([column("amount", "DECIMAL", { precision: 5, scale: 2 })], {
      amount: { kind: "random_decimal", min: "999.99", max: "999.99" },
    });
    assert.ok(rowsFor(smallMin).every((row) => row.amount === "-999.99"));
    assert.ok(rowsFor(smallMax).every((row) => row.amount === "999.99"));

    const wide = planFor([column("amount", "DECIMAL", { precision: 18, scale: 4 })], {
      amount: { kind: "random_decimal", min: "-99999999999999.9999", max: "-99999999999999.9999" },
    }, { rowCount: 2 });
    assert.deepEqual(rowsFor(wide).map((row) => row.amount), ["-99999999999999.9999", "-99999999999999.9999"]);
    const wideMax = planFor([column("amount", "DECIMAL", { precision: 18, scale: 4 })], {
      amount: { kind: "random_decimal", min: "99999999999999.9999", max: "99999999999999.9999" },
    });
    assert.ok(rowsFor(wideMax).every((row) => row.amount === "99999999999999.9999"));

    const overflow = planFor([column("amount", "DECIMAL", { precision: 5, scale: 2 })], {
      amount: { kind: "random_decimal", min: "0.00", max: "1000.00" },
    });
    assert.equal(overflow.status, "blocked");
    const scaleMismatch = planFor([column("amount", "DECIMAL", { precision: 5, scale: 2 })], {
      amount: { kind: "random_decimal", min: "0.001", max: "1.000" },
    });
    assert.equal(scaleMismatch.status, "blocked");
    const unknownShape = planFor([column("amount", "DECIMAL", {
      precision: { state: "unknown" }, scale: { state: "unknown" },
    })], { amount: { kind: "random_decimal", min: "0.00", max: "1.00" } });
    assert.equal(unknownShape.status, "blocked");
    assert.equal(unknownShape.diagnostics.filter((entry) => entry.code === "decimal_precision_scale_unknown").length, 1);
  });

  it("checks Random String against known max and preserves unknown length provenance", () => {
    const valid = planFor([column("s", "VARCHAR", { length: 8 })], { s: { kind: "random_string", length: 8 } });
    assert.ok(rowsFor(valid).every((row) => row.s.length === 8));
    const overflow = planFor([column("s", "VARCHAR", { length: 8 })], { s: { kind: "random_string", length: 9 } });
    assert.equal(overflow.status, "blocked");

    const unknown = planFor([column("s", "VARCHAR", { length: { state: "unavailable", provenance: "host-api" } })], {
      s: { kind: "random_string", length: 4 },
    });
    assert.equal(unknown.status, "blocked");
    assert.equal(diagnostic(unknown, "varchar_length_unknown")?.blocking, true);
    assert.equal(unknown.diagnostics.filter((entry) => entry.code === "varchar_length_unknown").length, 1);
    assert.ok(!getCompatibleGenerationRules(unknown.columns[0].schema).includes("random_string"));
  });

  it("rejects empty/incompatible Enum lists as a whole and selects deterministically", () => {
    const valid = planFor(schemas.varchar, { value: { kind: "enum", values: ["active", "inactive"] } }, { rowCount: 40 });
    const result = rowsFor(valid).map((row) => row.value);
    assert.ok(result.every((value) => ["active", "inactive"].includes(value)));
    assert.deepEqual(result, rowsFor(valid).map((row) => row.value));
    assert.equal(planFor(schemas.varchar, { value: { kind: "enum", values: [] } }).status, "blocked");
    const duplicate = planFor(schemas.varchar, { value: { kind: "enum", values: ["x", "x"] } });
    assert.equal(duplicate.status, "blocked");
    assert.match(diagnostic(duplicate, "generation_rule_invalid").reason, /implicit weights/);
    const invalidCandidate = planFor(schemas.integer, { value: { kind: "enum", values: [1, "2"] } });
    assert.equal(invalidCandidate.status, "blocked");
    assert.deepEqual(generateRows(invalidCandidate).rows, []);
  });

  it("implements deterministic Boolean Ratio endpoints and validates the interval", () => {
    const schema = [column("flag", "BOOLEAN")];
    assert.ok(rowsFor(planFor(schema, { flag: { kind: "boolean_ratio", trueRatio: 0 } })).every((row) => row.flag === false));
    assert.ok(rowsFor(planFor(schema, { flag: { kind: "boolean_ratio", trueRatio: 1 } })).every((row) => row.flag === true));
    const half = planFor(schema, { flag: { kind: "boolean_ratio", trueRatio: 0.5 } });
    assert.deepEqual(rowsFor(half), rowsFor(planFor(schema, { flag: { kind: "boolean_ratio", trueRatio: 0.5 } })));
    assert.equal(planFor(schema, { flag: { kind: "boolean_ratio", trueRatio: 1.01 } }).status, "blocked");
  });

  it("uses inclusive UTC Date/Timestamp ranges independent of the machine timezone", () => {
    const datePlan = planFor(schemas.date, { value: { kind: "date_range", start: "2024-02-29", end: "2024-03-01" } }, { rowCount: 30 });
    const timestampPlan = planFor(schemas.timestamp, { value: {
      kind: "timestamp_range",
      start: "2024-01-01T00:00:00.123456Z",
      end: "2024-01-01T00:00:00.123458Z",
    } }, { rowCount: 30 });
    const originalTZ = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu";
    const honolulu = { dates: rowsFor(datePlan), timestamps: rowsFor(timestampPlan) };
    process.env.TZ = "Asia/Tokyo";
    const tokyo = { dates: rowsFor(datePlan), timestamps: rowsFor(timestampPlan) };
    process.env.TZ = originalTZ;
    assert.deepEqual(tokyo, honolulu);
    assert.ok(honolulu.dates.every((row) => ["2024-02-29", "2024-03-01"].includes(row.value)));
    assert.ok(honolulu.timestamps.every((row) => /^2024-01-01T00:00:00\.12345[678]Z$/.test(row.value)));
    const preEpoch = planFor(schemas.timestamp, { value: {
      kind: "timestamp_range",
      start: "1969-12-31T23:59:59.000001Z",
      end: "1969-12-31T23:59:59.000001Z",
    } }, { rowCount: 1 });
    assert.equal(rowsFor(preEpoch)[0].value, "1969-12-31T23:59:59.000001Z");
    assert.equal(planFor(schemas.date, { value: { kind: "date_range", start: "2024-02-30", end: "2024-03-01" } }).status, "blocked");
    assert.equal(planFor(schemas.date, { value: { kind: "date_range", start: "2024-03-02", end: "2024-03-01" } }).status, "blocked");
    assert.equal(planFor([column("ts", "TIMESTAMP", { precision: 3 })], { ts: {
      kind: "timestamp_range", start: "2024-01-01T00:00:00.0001Z", end: "2024-01-01T00:00:00.0002Z",
    } }).status, "blocked");
  });

  it("generates RFC-shaped deterministic UUIDs from row identity", () => {
    const schema = [column("id", "UUID")];
    const plan = planFor(schema, { id: { kind: "uuid" } }, { rowCount: 10 });
    const values = rowsFor(plan).map((row) => row.id);
    assert.ok(values.every((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)));
    assert.equal(new Set(values).size, values.length);
    assert.deepEqual(values, rowsFor(plan).map((row) => row.id));
    assert.notDeepEqual(values, rowsFor(planFor(schema, { id: { kind: "uuid" } }, { seed: "other" })).map((row) => row.id));
  });

  it("never lets Null Ratio violate NOT NULL or unknown nullable facts", () => {
    const nullable = [column("value", "INTEGER", { nullable: true })];
    assert.ok(rowsFor(planFor(nullable, { value: { kind: "null_ratio", ratio: 0 } })).every((row) => row.value !== null));
    assert.ok(rowsFor(planFor(nullable, { value: { kind: "null_ratio", ratio: 1 } })).every((row) => row.value === null));
    const intermediate = planFor(nullable, { value: { kind: "null_ratio", ratio: 0.5 } }, { rowCount: 100 });
    assert.ok(rowsFor(intermediate).some((row) => row.value === null));
    assert.ok(rowsFor(intermediate).some((row) => row.value !== null));
    const notNull = planFor(schemas.integer, { value: { kind: "null_ratio", ratio: 0.1 } });
    assert.equal(notNull.status, "blocked");
    assert.equal(diagnostic(notNull, "nullability_rule_conflict")?.blocking, true);
    const unknown = planFor([column("value", "INTEGER", { nullable: { state: "unknown" } })], {
      value: { kind: "null_ratio", ratio: 0.5 },
    });
    assert.equal(unknown.status, "blocked");
    const zeroUnknown = planFor([column("value", "INTEGER", { nullable: { state: "unknown" } })], {
      value: { kind: "null_ratio", ratio: 0 },
    });
    assert.notEqual(zeroUnknown.status, "blocked");
    assert.ok(rowsFor(zeroUnknown).every((row) => row.value !== null));

    const nullableUuid = planFor([column("token", "UUID", { nullable: true })], {
      token: { kind: "null_ratio", ratio: 0.5 },
    });
    assert.equal(nullableUuid.status, "ready");
    assert.equal(nullableUuid.columns[0].rule.kind, "uuid");
    assert.equal(nullableUuid.columns[0].nullProbability, 0.5);
  });

  it("reuses existing Semantic Mapping and Safe Synthetic Person only after explicit selection", () => {
    const schema = [column("extra_name_field", "VARCHAR", { length: 64 })];
    const auto = planFor(schema, { extra_name_field: { kind: "auto" } });
    assert.equal(auto.columns[0].semanticMapping.status, "needs_confirmation");
    assert.equal(auto.columns[0].rule.kind, "varchar");
    const semantic = planFor(schema, { extra_name_field: { kind: "semantic", semanticType: "name" } });
    assert.equal(semantic.columns[0].semanticMapping.selected, true);
    assert.equal(semantic.columns[0].rule.kind, "semantic:name");
    assert.match(rowsFor(semantic)[0].extra_name_field, /^测试用户/);
    const conflict = buildGenerationPlan({ tableIdentity: "semantic-conflict", columns: schema }, {
      ...options,
      rules: { extra_name_field: { kind: "semantic", semanticType: "name" } },
      semanticOverrides: { extra_name_field: "email" },
    });
    assert.equal(conflict.status, "blocked");
    assert.ok(diagnostic(conflict, "generation_rule_conflict"));
  });

  it("isolates rule edits, additions and column order while preserving replay", () => {
    const base = [
      column("a", "INTEGER"),
      column("b", "VARCHAR", { length: 16 }),
      column("c", "BOOLEAN"),
    ];
    const seedOptions = { rowCount: 40, seed: "independent-cells" };
    const first = generateRows(buildGenerationPlan({ tableIdentity: "isolated", columns: base }, {
      ...seedOptions,
      rules: { a: { kind: "random_integer", min: 1, max: 100 } },
    })).rows;
    const changed = generateRows(buildGenerationPlan({ tableIdentity: "isolated", columns: base }, {
      ...seedOptions,
      rules: { a: { kind: "random_integer", min: 101, max: 200 } },
    })).rows;
    assert.notDeepEqual(changed.map((row) => row.a), first.map((row) => row.a));
    for (const key of ["b", "c"]) assert.deepEqual(changed.map((row) => row[key]), first.map((row) => row[key]));

    const withColumn = [base[0], column("added", "INTEGER"), base[1], base[2]];
    const after = generateRows(buildGenerationPlan({ tableIdentity: "isolated", columns: withColumn }, seedOptions)).rows;
    const reordered = generateRows(buildGenerationPlan({ tableIdentity: "isolated", columns: [...base].reverse() }, seedOptions)).rows;
    const original = generateRows(buildGenerationPlan({ tableIdentity: "isolated", columns: base }, seedOptions)).rows;
    for (const key of ["a", "b", "c"]) {
      assert.deepEqual(after.map((row) => row[key]), original.map((row) => row[key]));
      assert.deepEqual(reordered.map((row) => row[key]), original.map((row) => row[key]));
    }
  });
});
