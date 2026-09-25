import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createExportDataset } from "../src/export/export-dataset.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { manualConstraintIdentity, validateDatasetConstraints, validateManualConstraint } from "../src/generation/manual-constraints.mjs";

const col = (name, dataType, extra = {}) => ({ name, dataType, nullable: false, ...extra });
const schema = (columns) => ({ tableIdentity: "constraints:test", columns });
const build = (columns, constraints, options = {}) => buildGenerationPlan(schema(columns), {
  rowCount: 4, seed: "constraint-seed", constraints, ...options,
});
const values = (plan, key) => generateRows(plan).rows.map((row) => row[key]);
const hasDiagnostic = (plan, code) => plan.diagnostics.some((entry) => entry.code === code);

const A = [col("a", "INTEGER")];

describe("manual constraint model and strict parsing", () => {
  it("accepts unique, composite_unique, and required_unique as separate manual kinds", () => {
    const columns = [col("a", "INTEGER"), col("b", "VARCHAR", { length: 20 })];
    for (const constraint of [
      { id: "u", kind: "unique", column: "a" },
      { id: "cu", kind: "composite_unique", columns: ["a", "b"] },
      { id: "ru", kind: "required_unique", column: "a" },
    ]) {
      const parsed = validateManualConstraint(schema(columns), constraint);
      assert.equal(parsed.valid, true, JSON.stringify(parsed.diagnostics));
      assert.equal(parsed.constraint.kind, constraint.kind);
    }
    const first = { id: "stable", kind: "composite_unique", columns: ["a", "b"] };
    assert.equal(manualConstraintIdentity(first), manualConstraintIdentity({ columns: ["a", "b"], kind: "composite_unique", id: "stable" }));
    assert.notEqual(manualConstraintIdentity(first), manualConstraintIdentity({ ...first, columns: ["b", "a"] }));
  });

  it("rejects unknown kinds/fields, missing columns, unknown columns, repeated composite columns, and too-short composites", () => {
    const inputSchema = schema([col("a", "INTEGER"), col("b", "INTEGER")]);
    const cases = [
      [{ id: "x", kind: "check", column: "a" }, "invalid_constraint_kind"],
      [{ id: "x", kind: "unique", column: "a", ignored: true }, "invalid_constraint_config"],
      [{ id: "x", kind: "unique" }, "invalid_constraint_config"],
      [{ id: "x", kind: "unique", column: "missing" }, "unknown_constraint_column"],
      [{ id: "x", kind: "composite_unique", columns: ["a", "a"] }, "duplicate_constraint_column"],
      [{ id: "x", kind: "composite_unique", columns: ["a"] }, "invalid_constraint_config"],
    ];
    for (const [config, code] of cases) {
      const result = validateManualConstraint(inputSchema, config);
      assert.equal(result.valid, false);
      assert.ok(result.diagnostics.some((entry) => entry.code === code), JSON.stringify(result.diagnostics));
    }
  });

  it("blocks duplicate declarations instead of silently deduplicating", () => {
    const plan = build(A, [
      { id: "first", kind: "unique", column: "a" },
      { id: "second", kind: "unique", column: "a" },
    ]);
    assert.equal(plan.constraintPlan.blocking, true);
    assert.equal(hasDiagnostic(plan, "duplicate_constraint"), true);
    assert.equal(plan.constraintPlan.constraints.length, 2);
  });
});

describe("ConstraintPlan capacity and deterministic allocation", () => {
  it("plans Constant and Enum capacity before generation", () => {
    const constantOne = build([col("a", "INTEGER")], [{ id: "u", kind: "unique", column: "a" }], {
      rowCount: 1, rules: { a: { kind: "constant", value: 7 } },
    });
    assert.equal(constantOne.status === "blocked", false, JSON.stringify(constantOne.diagnostics));
    assert.deepEqual(values(constantOne, "a"), [7]);
    const constantTwo = build([col("a", "INTEGER")], [{ id: "u", kind: "unique", column: "a" }], {
      rowCount: 2, rules: { a: { kind: "constant", value: 7 } },
    });
    assert.equal(constantTwo.status, "blocked");
    assert.equal(hasDiagnostic(constantTwo, "constraint_capacity_insufficient"), true);

    const enumTwo = build([col("a", "INTEGER")], [{ id: "u", kind: "unique", column: "a" }], {
      rowCount: 2, rules: { a: { kind: "enum", values: [1, 2] } },
    });
    assert.deepEqual(new Set(values(enumTwo, "a")), new Set([1, 2]));
    const enumThree = build([col("a", "INTEGER")], [{ id: "u", kind: "unique", column: "a" }], {
      rowCount: 3, rules: { a: { kind: "enum", values: [1, 2] } },
    });
    assert.equal(enumThree.status, "blocked");
    assert.equal(enumThree.constraintPlan.constraints[0].capacity.value, "2");
  });

  it("proves Boolean boundaries and uses tuple-product capacity for Composite Unique", () => {
    const boolean = [col("flag", "BOOLEAN")];
    const booleanTwo = build(boolean, [{ id: "u", kind: "unique", column: "flag" }], {
      rowCount: 2, rules: { flag: { kind: "boolean_ratio", trueRatio: 0.5 } },
    });
    assert.deepEqual(new Set(values(booleanTwo, "flag")), new Set([true, false]));
    const booleanThree = build(boolean, [{ id: "u", kind: "unique", column: "flag" }], {
      rowCount: 3, rules: { flag: { kind: "boolean_ratio", trueRatio: 0.5 } },
    });
    assert.equal(booleanThree.status, "blocked");
    const booleanConstant = build(boolean, [{ id: "u", kind: "unique", column: "flag" }], {
      rowCount: 2, rules: { flag: { kind: "boolean_ratio", trueRatio: 0 } },
    });
    assert.equal(booleanConstant.constraintPlan.constraints[0].capacity.value, "1");
    assert.equal(booleanConstant.status, "blocked");

    const columns = [col("a", "INTEGER"), col("b", "VARCHAR", { length: 4 })];
    const constraint = [{ id: "ab", kind: "composite_unique", columns: ["a", "b"] }];
    const rules = {
      a: { kind: "enum", values: Array.from({ length: 10 }, (_value, index) => index) },
      b: { kind: "enum", values: ["w", "x", "y", "z", "q"] },
    };
    const exactlyFull = build(columns, constraint, { rowCount: 50, rules });
    assert.equal(exactlyFull.constraintPlan.constraints[0].capacity.value, "50");
    assert.equal(exactlyFull.status, "ready");
    assert.equal(new Set(generateRows(exactlyFull).rows.map((row) => JSON.stringify([row.a, row.b]))).size, 50);
    const overfull = build(columns, constraint, { rowCount: 51, rules });
    assert.equal(overfull.status, "blocked");
    assert.equal(overfull.constraintPlan.constraints[0].capacity.value, "50");
  });

  it("indexes Sequence, exact Random Decimal, and finite Random String domains without retries", () => {
    const sequence = build([col("n", "INTEGER")], [{ id: "u", kind: "unique", column: "n" }], {
      rowCount: 6, rules: { n: { kind: "sequence", start: 5, step: 3 } },
    });
    assert.deepEqual(values(sequence, "n"), [5, 8, 11, 14, 17, 20]);
    const constantSequence = build([col("n", "INTEGER")], [{ id: "u", kind: "unique", column: "n" }], {
      rowCount: 2, rules: { n: { kind: "sequence", start: 5, step: 0 } },
    });
    assert.equal(constantSequence.status, "blocked");

    const decimal = build([col("amount", "DECIMAL", { precision: 3, scale: 2 })], [
      { id: "u", kind: "unique", column: "amount" },
    ], { rowCount: 3, rules: { amount: { kind: "random_decimal", min: "0.00", max: "0.02" } } });
    assert.equal(decimal.constraintPlan.constraints[0].capacity.value, "3");
    assert.deepEqual(new Set(values(decimal, "amount")), new Set(["0.00", "0.01", "0.02"]));

    const strings = build([col("code", "VARCHAR", { length: 1 })], [{ id: "u", kind: "unique", column: "code" }], {
      rowCount: 62, rules: { code: { kind: "random_string", length: 1 } },
    });
    assert.equal(strings.constraintPlan.constraints[0].capacity.value, "62");
    assert.equal(new Set(values(strings, "code")).size, 62);
    assert.equal(build([col("code", "VARCHAR", { length: 1 })], [{ id: "u", kind: "unique", column: "code" }], {
      rowCount: 63, rules: { code: { kind: "random_string", length: 1 } },
    }).status, "blocked");
  });

  it("blocks unknown strategies and deterministically allocates UUID and finite numeric domains", () => {
    const unknown = build([col("email", "VARCHAR", { length: 64 })], [
      { id: "u", kind: "unique", column: "email" },
    ], { rowCount: 3, rules: { email: { kind: "semantic", semanticType: "email" } } });
    assert.equal(unknown.status, "blocked");
    assert.ok(hasDiagnostic(unknown, "constraint_strategy_unsupported"));

    const uuidSchema = [col("token", "UUID")];
    const uuidConstraint = [{ id: "uuid-unique", kind: "unique", column: "token" }];
    const uuidPlan = build(uuidSchema, uuidConstraint, { rowCount: 12, rules: { token: { kind: "uuid" } } });
    assert.equal(uuidPlan.constraintPlan.constraints[0].capacity.value, (1n << 122n).toString());
    const uuidValues = values(uuidPlan, "token");
    assert.equal(new Set(uuidValues).size, uuidValues.length);
    assert.ok(uuidValues.every((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)));

    const numeric = build([col("n", "INTEGER")], [{ id: "u", kind: "unique", column: "n" }], {
      rowCount: 20, rules: { n: { kind: "random_integer", min: 10, max: 29 } },
    });
    assert.equal(new Set(values(numeric, "n")).size, 20);
    const tooMany = build([col("n", "INTEGER")], [{ id: "u", kind: "unique", column: "n" }], {
      rowCount: 21, rules: { n: { kind: "random_integer", min: 10, max: 29 } },
    });
    assert.equal(tooMany.status, "blocked");
  });

  it("replays constrained values by seed, isolates unrelated columns, and ignores constraint iteration order", () => {
    const columns = [col("a", "INTEGER"), col("b", "INTEGER"), col("c", "BOOLEAN")];
    const rules = { a: { kind: "random_integer", min: 0, max: 999 }, b: { kind: "random_integer", min: 0, max: 999 } };
    const first = build(columns, [
      { id: "a-unique", kind: "unique", column: "a" },
      { id: "a-required", kind: "required_unique", column: "a" },
      { id: "ab", kind: "composite_unique", columns: ["a", "b"] },
    ], { rowCount: 12, rules, seed: "stable" });
    const reordered = build(columns, [
      { id: "ab", kind: "composite_unique", columns: ["a", "b"] },
      { id: "a-required", kind: "required_unique", column: "a" },
      { id: "a-unique", kind: "unique", column: "a" },
    ], { rowCount: 12, rules, seed: "stable" });
    const changed = build(columns, [
      { id: "a-unique-edited", kind: "unique", column: "a" },
      { id: "a-required", kind: "required_unique", column: "a" },
      { id: "ab", kind: "composite_unique", columns: ["a", "b"] },
    ], { rowCount: 12, rules, seed: "stable" });
    const firstRows = generateRows(first).rows;
    assert.deepEqual(generateRows(reordered).rows, firstRows);
    assert.deepEqual(generateRows(build(columns, first.constraintPlan.constraints.map((entry) => entry.normalizedConfiguration), {
      rowCount: 12, rules, seed: "stable",
    })).rows, firstRows);
    assert.deepEqual(generateRows(changed).rows.map((row) => row.c), firstRows.map((row) => row.c));
    assert.notDeepEqual(generateRows(build(columns, [
      { id: "a-unique", kind: "unique", column: "a" },
      { id: "a-required", kind: "required_unique", column: "a" },
      { id: "ab", kind: "composite_unique", columns: ["a", "b"] },
    ], { rowCount: 12, rules, seed: "different" })).rows.map((row) => row.a), firstRows.map((row) => row.a));
  });

  it("blocks overlapping incomparable constraints instead of depending on execution order", () => {
    const plan = build([col("a", "INTEGER"), col("b", "INTEGER"), col("c", "INTEGER")], [
      { id: "ab", kind: "composite_unique", columns: ["a", "b"] },
      { id: "bc", kind: "composite_unique", columns: ["b", "c"] },
    ]);
    assert.equal(plan.status, "blocked");
    assert.ok(hasDiagnostic(plan, "constraint_conflict"));
  });
});

describe("Required + Unique provenance and final validator", () => {
  it("keeps schema nullable provenance separate while enforcing manual requiredness", () => {
    for (const nullable of [false, true, { state: "unknown", provenance: "host" }]) {
      const plan = build([col("id", "INTEGER", { nullable })], [{ id: "required-id", kind: "required_unique", column: "id" }], {
        rowCount: 5,
      });
      const rowValues = values(plan, "id");
      assert.equal(new Set(rowValues).size, 5);
      assert.ok(rowValues.every((value) => value !== null && value !== undefined));
      if (typeof nullable === "boolean") assert.equal(plan.table.columns[0].nullable.value, nullable);
      else assert.equal(plan.table.columns[0].nullable.provenance, "host");
      const provenance = plan.constraintPlan.constraints[0].requirednessProvenance.map((entry) => entry.source);
      assert.ok(provenance.includes("manual_generation_required"));
      assert.equal(provenance.includes("schema_required"), nullable === false);
      assert.equal(plan.table.columns[0].nullable.state, nullable && typeof nullable === "object" ? "unknown" : "known");
    }
  });

  it("blocks Required + Unique when an explicit positive Null Ratio conflicts", () => {
    const plan = build([col("id", "INTEGER", { nullable: true })], [
      { id: "required-id", kind: "required_unique", column: "id" },
    ], { rules: { id: { kind: "null_ratio", ratio: 0.2 } } });
    assert.equal(plan.status, "blocked");
    assert.ok(hasDiagnostic(plan, "required_rule_conflict"));
    assert.equal(plan.table.columns[0].nullable.value, true);
  });

  it("validates typed single/composite identities, NULL exemptions, and required missing values", () => {
    const singlePlan = build([col("value", "INTEGER")], [{ id: "u", kind: "unique", column: "value" }]);
    const typedRows = [{ value: 1 }, { value: "1" }, { value: null }, { value: null }];
    assert.equal(validateDatasetConstraints(typedRows, singlePlan.constraintPlan).valid, true);
    const duplicate = validateDatasetConstraints([{ value: 1 }, { value: 1 }], singlePlan.constraintPlan);
    assert.equal(duplicate.valid, false);
    assert.ok(duplicate.diagnostics.some((entry) => entry.code === "constraint_unique_violation"));

    const compositePlan = build([col("a", "INTEGER"), col("b", "VARCHAR", { length: 4 })], [
      { id: "ab", kind: "composite_unique", columns: ["a", "b"] },
    ]);
    const compositeDuplicate = validateDatasetConstraints([
      { a: 1, b: "x" }, { a: 1, b: "x" }, { a: null, b: "x" }, { a: null, b: "x" },
    ], compositePlan.constraintPlan);
    assert.equal(compositeDuplicate.valid, false);
    assert.equal(compositeDuplicate.diagnostics.filter((entry) => entry.code === "constraint_composite_unique_violation").length, 1);
    assert.ok(validateDatasetConstraints([{ a: null, b: "x" }, { a: null, b: "x" }], compositePlan.constraintPlan).valid);

    const requiredPlan = build([col("id", "INTEGER")], [{ id: "required", kind: "required_unique", column: "id" }]);
    const requiredInvalid = validateDatasetConstraints([{ id: null }, {}, { id: 1 }, { id: 1 }], requiredPlan.constraintPlan);
    assert.equal(requiredInvalid.valid, false);
    assert.ok(requiredInvalid.diagnostics.filter((entry) => entry.code === "constraint_required_violation").length >= 2);
    assert.ok(requiredInvalid.diagnostics.some((entry) => entry.code === "constraint_unique_violation"));
  });

  it("rejects invalid results at the ExportDataset boundary instead of exposing partial data", () => {
    const plan = build([col("value", "INTEGER")], [{ id: "u", kind: "unique", column: "value" }], { rowCount: 2 });
    assert.throws(() => createExportDataset(plan, {
      rows: [{ value: 4 }, { value: 4 }], status: "ready",
    }), (error) => error.code === "export_constraint_violation");
  });
});
