import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { previewFixture } from "../src/preview/fixture-preview.mjs";
import { FixtureSchemaMetadataProvider } from "../src/providers/fixture-schema-metadata-provider.mjs";

const fixtureNames = [
  "simple_customer",
  "financial_transaction",
  "mixed_nullable",
  "precision_boundary",
  "long_varchar",
];
const fixtures = new FixtureSchemaMetadataProvider();

async function getFixture(name) {
  return fixtures.getTableMetadata({ tableIdentity: name });
}

function diagnostic(result, code) {
  return result.diagnostics.find((entry) => entry.code === code);
}

describe("Generation Core and fixture preview", () => {
  it("generates each shared schema fixture without connecting to a database", async () => {
    for (const fixtureName of fixtureNames) {
      const result = await previewFixture({ fixtureName, rowCount: 7, seed: "fixture-suite" });
      assert.equal(result.plan.table.tableIdentity, fixtureName);
      assert.equal(result.rows.length, 7, fixtureName);
      assert.notEqual(result.status, "blocked", fixtureName);
      assert.equal(result.plan.rowCount, 7);
      assert.equal(result.plan.seed, "fixture-suite");
    }
  });

  it("supports all six schema type families with bounded values", async () => {
    const customer = await previewFixture({ fixtureName: "simple_customer", rowCount: 80, seed: "types" });
    assert.equal(customer.status, "ready");
    for (const row of customer.rows) {
      assert.ok(Number.isSafeInteger(row.customer_id));
      assert.ok(Number.isSafeInteger(row.age));
      assert.ok(row.balance === null || /^\d+\.\d{2}$/.test(row.balance));
      assert.ok(row.name === null || (typeof row.name === "string" && row.name.length <= 64));
      assert.ok(typeof row.active === "boolean");
      assert.ok(row.birthday === null || /^\d{4}-\d{2}-\d{2}$/.test(row.birthday));
      assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.created_at));
    }
  });

  it("preserves exact decimal precision and scale, including boundaries", async () => {
    const result = await previewFixture({ fixtureName: "precision_boundary", rowCount: 100, seed: "decimal-bounds" });
    assert.equal(result.status, "ready");
    for (const row of result.rows) {
      const [whole, fraction] = row.small_money.split(".");
      assert.ok(whole.length <= 2);
      assert.equal(fraction.length, 2);
      assert.ok(Number(row.small_money) <= 99.99);
      assert.ok(/^\d{1,5}$/.test(row.whole_units));
    }
  });

  it("never emits a varchar string longer than the schema or explicit rule cap", async () => {
    const long = await previewFixture({
      fixtureName: "long_varchar",
      rowCount: 24,
      seed: "length-boundary",
      overrides: { long_value: { type: "string", maxLength: 4096 } },
    });
    assert.equal(long.status, "ready");
    for (const row of long.rows) assert.ok(row.long_value.length <= 4096);

    const customer = await previewFixture({
      fixtureName: "simple_customer",
      rowCount: 32,
      seed: "short-rule",
      overrides: { name: { type: "varchar", maxLength: 7, nullProbability: 0 } },
    });
    for (const row of customer.rows) assert.ok(row.name.length <= 7);
  });

  it("supports exact date/timestamp bounds and the one-character varchar boundary", async () => {
    const schema = {
      tableIdentity: "temporal_boundary",
      columns: [
        { name: "single_char", dataType: "VARCHAR", nullable: false, length: 1 },
        { name: "day", dataType: "DATE", nullable: false },
        { name: "instant", dataType: "TIMESTAMP", nullable: false, precision: 0 },
      ],
    };
    const plan = buildGenerationPlan(schema, {
      rowCount: 12,
      seed: "temporal-bounds",
      overrides: {
        day: { type: "date", min: "2024-02-29", max: "2024-02-29" },
        instant: { type: "timestamp", min: "2024-02-29T12:34:56.000Z", max: "2024-02-29T12:34:56.000Z" },
      },
    });
    const generated = generateRows(plan);
    assert.equal(generated.status, "ready");
    for (const row of generated.rows) {
      assert.equal(row.single_char.length, 1);
      assert.equal(row.day, "2024-02-29");
      assert.equal(row.instant, "2024-02-29T12:34:56Z");
    }
  });

  it("uses deterministic nullable behavior and preserves unknown nullability", async () => {
    const first = await previewFixture({ fixtureName: "mixed_nullable", rowCount: 100, seed: "nullable-seed" });
    const second = await previewFixture({ fixtureName: "mixed_nullable", rowCount: 100, seed: "nullable-seed" });
    assert.deepEqual(first.rows, second.rows);
    assert.ok(first.rows.some((row) => row.optional_text === null));
    assert.ok(first.rows.some((row) => row.optional_text !== null));
    assert.ok(first.rows.every((row) => row.required_integer !== null));
    assert.ok(first.rows.every((row) => typeof row.maybe_flag === "boolean"));
    assert.equal(first.plan.table.columns.find((column) => column.name === "maybe_flag").nullable.state, "unknown");
    assert.equal(diagnostic(first, "nullability_unknown")?.severity, "warning");
    assert.equal(first.status, "ready_with_warnings");
  });

  it("repeats the same plan for preview, regenerate, and export-like generation", async () => {
    const preview = await previewFixture({ fixtureName: "simple_customer", rowCount: 20, seed: "stable-seed" });
    const regenerated = await previewFixture({ fixtureName: "simple_customer", rowCount: 20, seed: "stable-seed" });
    const exportLike = generateRows(preview.plan);
    assert.deepEqual(regenerated.rows, preview.rows);
    assert.deepEqual(exportLike.rows, preview.rows);
  });

  it("changes values for a different seed", async () => {
    const left = await previewFixture({ fixtureName: "simple_customer", rowCount: 20, seed: "seed-a" });
    const right = await previewFixture({ fixtureName: "simple_customer", rowCount: 20, seed: "seed-b" });
    assert.notDeepEqual(left.rows.map((row) => row.age), right.rows.map((row) => row.age));
  });

  it("keeps unrelated columns stable when a column rule changes", async () => {
    const schema = await getFixture("simple_customer");
    const baselinePlan = buildGenerationPlan(schema, { rowCount: 40, seed: "column-stability" });
    const changedPlan = buildGenerationPlan(schema, {
      rowCount: 40,
      seed: "column-stability",
      overrides: { age: { type: "integer", min: 18, max: 65 } },
    });
    assert.equal(changedPlan.columns.find((column) => column.schema.name === "age").rule.source, "explicit_user_rule");

    const baseline = generateRows(baselinePlan).rows;
    const changed = generateRows(changedPlan).rows;
    assert.deepEqual(changed.map((row) => row.name), baseline.map((row) => row.name));
    assert.deepEqual(changed.map((row) => row.balance), baseline.map((row) => row.balance));
    assert.deepEqual(changed.map((row) => row.active), baseline.map((row) => row.active));
    assert.deepEqual(changed.map((row) => row.created_at), baseline.map((row) => row.created_at));
    assert.ok(changed.every((row) => row.age >= 18 && row.age <= 65));
  });

  it("keeps existing columns stable when another column is added", async () => {
    const schema = await getFixture("simple_customer");
    const extended = {
      ...schema,
      columns: [...schema.columns, { name: "new_flag", dataType: "BOOLEAN", nullable: false }],
    };
    const before = generateRows(buildGenerationPlan(schema, { rowCount: 16, seed: "add-column" })).rows;
    const after = generateRows(buildGenerationPlan(extended, { rowCount: 16, seed: "add-column" })).rows;
    for (const column of ["customer_id", "name", "age", "balance", "active", "birthday", "created_at"]) {
      assert.deepEqual(after.map((row) => row[column]), before.map((row) => row[column]), column);
    }
  });

  it("reports impossible generation with a located diagnostic instead of partial rows", async () => {
    const valid = buildGenerationPlan({
      tableIdentity: "impossible_fixture",
      columns: [{ name: "flag", dataType: "BOOLEAN", nullable: false }],
    }, { rowCount: 2, seed: "impossible" });
    const invalidated = {
      ...valid,
      columns: [{
        ...valid.columns[0],
        rule: { ...valid.columns[0].rule, kind: "unimplemented-rule" },
      }],
      status: "ready",
    };
    const result = generateRows(invalidated);
    const issue = diagnostic(result, "generation_impossible");
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.rows, []);
    assert.equal(issue.table, "impossible_fixture");
    assert.equal(issue.column, "flag");
    assert.equal(issue.rule, valid.columns[0].rule.identity);
    assert.ok(issue.reason);
  });

  it("preserves explicit absent, unknown, and unsupported schema facts", () => {
    const plan = buildGenerationPlan({
      tableIdentity: "metadata-facts",
      columns: [{
        name: "value",
        dataType: "VARCHAR",
        nullable: { state: "unknown", reason: "not supplied" },
        length: { state: "unavailable" },
        default: { state: "absent" },
        identity: { state: "unsupported" },
      }],
    }, { rowCount: 1, seed: "facts" });
    const [column] = plan.table.columns;
    assert.equal(column.nullable.state, "unknown");
    assert.equal(column.length.state, "unavailable");
    assert.equal(column.default.state, "absent");
    assert.equal(column.identity.state, "unsupported");
    assert.equal(plan.status, "blocked");
  });

  it("uses 20 rows only as the preview layer default", async () => {
    const preview = await previewFixture({ fixtureName: "simple_customer", seed: "preview-default" });
    assert.equal(preview.plan.rowCount, 20);
    assert.equal(preview.rows.length, 20);
    const missingCoreCount = buildGenerationPlan(await getFixture("simple_customer"), { seed: "required-count" });
    assert.equal(missingCoreCount.status, "blocked");
    assert.equal(diagnostic({ diagnostics: missingCoreCount.diagnostics }, "invalid_row_count").table, "simple_customer");
  });

  it("reports unsupported types with table, column, rule, and reason instead of fake values", () => {
    const plan = buildGenerationPlan({
      tableIdentity: "unsupported_fixture",
      columns: [{ name: "opaque", dataType: "GEOGRAPHY", nullable: false }],
    }, { rowCount: 3, seed: "unsupported" });
    const generated = generateRows(plan);
    const issue = diagnostic(generated, "unsupported_type");
    assert.equal(generated.status, "blocked");
    assert.deepEqual(generated.rows, []);
    assert.equal(issue.table, "unsupported_fixture");
    assert.equal(issue.column, "opaque");
    assert.ok(issue.rule);
    assert.ok(issue.reason);
  });

  it("diagnoses invalid length, precision/scale, and override rules", async () => {
    const badLength = buildGenerationPlan({
      tableIdentity: "bad_length",
      columns: [{ name: "label", dataType: "VARCHAR", nullable: false, length: 0 }],
    }, { rowCount: 1, seed: "invalid" });
    assert.equal(diagnostic({ diagnostics: badLength.diagnostics }, "invalid_length").column, "label");
    assert.equal(badLength.status, "blocked");

    const badDecimal = buildGenerationPlan({
      tableIdentity: "bad_decimal",
      columns: [{ name: "amount", dataType: "DECIMAL", nullable: false, precision: 2, scale: 3 }],
    }, { rowCount: 1, seed: "invalid" });
    assert.equal(diagnostic({ diagnostics: badDecimal.diagnostics }, "invalid_precision_scale").column, "amount");
    assert.equal(badDecimal.status, "blocked");

    const schema = await getFixture("simple_customer");
    const badOverride = buildGenerationPlan(schema, {
      rowCount: 1,
      seed: "invalid",
      overrides: { name: { id: "too-long", type: "varchar", maxLength: 65 } },
    });
    const issue = diagnostic({ diagnostics: badOverride.diagnostics }, "invalid_override");
    assert.equal(issue.column, "name");
    assert.equal(issue.rule, "too-long");
    assert.match(issue.reason, /exceeds schema length/);
    assert.equal(badOverride.status, "blocked");
  });

  it("rejects random nulls on NOT NULL and explicit rules with impossible ranges", async () => {
    const schema = await getFixture("simple_customer");
    const notNull = buildGenerationPlan(schema, {
      rowCount: 2,
      seed: "invalid-null",
      overrides: { customer_id: { type: "integer", nullProbability: 0.2 } },
    });
    assert.equal(diagnostic({ diagnostics: notNull.diagnostics }, "invalid_override").column, "customer_id");
    assert.equal(notNull.status, "blocked");

    const impossible = buildGenerationPlan(schema, {
      rowCount: 2,
      seed: "impossible-range",
      overrides: { age: { type: "integer", min: 9, max: 2 } },
    });
    assert.match(diagnostic({ diagnostics: impossible.diagnostics }, "invalid_override").reason, /min <= max/);
  });
});
