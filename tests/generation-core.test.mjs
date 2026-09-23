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
  "person_basic",
  "person_partial",
  "person_aliases",
  "person_ambiguous",
  "person_two_groups",
  "person_override",
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
    assert.equal(customer.status, "ready_with_warnings");
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

  it("infers aliases with confidence/evidence and leaves generic names unknown", async () => {
    const schema = await getFixture("person_aliases");
    const plan = buildGenerationPlan(schema, { rowCount: 2, seed: "alias-evidence" });
    const expected = {
      cust_name: "name",
      sex: "gender",
      dob: "birthday",
      phone_no: "mobile",
      email_address: "email",
      home_address: "address",
    };
    for (const [columnName, semanticType] of Object.entries(expected)) {
      const column = plan.columns.find((entry) => entry.schema.name === columnName);
      assert.equal(column.semanticMapping.semanticType, semanticType);
      assert.equal(column.semanticMapping.confidence, "high");
      assert.equal(column.semanticMapping.status, "needs_confirmation");
      assert.ok(column.semanticMapping.evidence.some((entry) => entry.source === "column_name"));
      assert.ok(column.semanticMapping.evidence.some((entry) => entry.source === "schema_type"));
      if (semanticType !== "birthday") assert.ok(column.semanticMapping.evidence.some((entry) => entry.source === "length"));
      assert.equal(column.rule.source, "schema_type_fallback");
    }

    const ambiguous = await getFixture("person_ambiguous");
    const unknownPlan = buildGenerationPlan(ambiguous, { rowCount: 1, seed: "unknown-names" });
    for (const columnName of ["remark", "info", "value", "data"]) {
      const column = unknownPlan.columns.find((entry) => entry.schema.name === columnName);
      assert.equal(column.inference.semanticType, "unknown", columnName);
      assert.equal(column.rule.source, "schema_type_fallback", columnName);
    }
    assert.equal(diagnostic(unknownPlan, "semantic_ambiguous")?.column, "name_gender");
    assert.equal(unknownPlan.columns.find((entry) => entry.schema.name === "name_gender").rule.kind, "varchar");

    const requiredAliases = [
      ["customer_name", "VARCHAR", 64, "name"],
      ["full_name", "VARCHAR", 64, "name"],
      ["birth_date", "DATE", undefined, "birthday"],
      ["date_of_birth", "DATE", undefined, "birthday"],
      ["mobile_no", "VARCHAR", 32, "mobile"],
      ["telephone", "VARCHAR", 32, "mobile"],
      ["email_address", "VARCHAR", 128, "email"],
    ];
    const aliasPlan = buildGenerationPlan({
      tableIdentity: "required-aliases",
      columns: requiredAliases.map(([name, dataType, length]) => ({
        name,
        dataType,
        nullable: false,
        ...(length === undefined ? {} : { length }),
      })),
    }, { rowCount: 1, seed: "required-aliases" });
    for (const [columnName, , , semanticType] of requiredAliases) {
      assert.equal(aliasPlan.columns.find((entry) => entry.schema.name === columnName).inference.semanticType, semanticType, columnName);
    }
  });

  it("reports low-confidence, incompatible, and invalid semantic choices without silent inference", () => {
    const low = buildGenerationPlan({
      tableIdentity: "low-confidence",
      columns: [{ name: "extra_name_field", dataType: "VARCHAR", nullable: false, length: 64 }],
    }, { rowCount: 1, seed: "low" });
    assert.equal(low.columns[0].semanticMapping.confidence, "low");
    assert.equal(diagnostic(low, "semantic_low_confidence")?.column, "extra_name_field");
    assert.equal(low.columns[0].rule.source, "schema_type_fallback");

    const incompatible = buildGenerationPlan({
      tableIdentity: "bad-birthday-type",
      columns: [{ name: "birthday", dataType: "INTEGER", nullable: false }],
    }, { rowCount: 1, seed: "incompatible" });
    const incompatibility = diagnostic(incompatible, "semantic_schema_incompatible");
    assert.equal(incompatibility.column, "birthday");
    assert.equal(incompatibility.blocking, false);
    assert.equal(incompatible.columns[0].rule.kind, "integer");
    assert.equal(incompatible.columns[0].semanticMapping.status, "incompatible");

    const shortName = buildGenerationPlan({
      tableIdentity: "short-name-length",
      columns: [{ name: "name", dataType: "VARCHAR", nullable: false, length: 5 }],
    }, { rowCount: 1, seed: "short-name" });
    assert.match(diagnostic(shortName, "semantic_schema_incompatible")?.reason, /length is 5/);
    assert.equal(shortName.columns[0].rule.kind, "varchar");

    const confirmedIncompatible = buildGenerationPlan({
      tableIdentity: "confirmed-bad-birthday-type",
      columns: [{ name: "birthday", dataType: "INTEGER", nullable: false }],
    }, { rowCount: 1, seed: "confirmed-incompatible", semanticMappings: { birthday: "birthday" } });
    assert.equal(diagnostic(confirmedIncompatible, "semantic_schema_incompatible")?.blocking, true);
    assert.equal(confirmedIncompatible.status, "blocked");

    const invalidOverride = buildGenerationPlan({
      tableIdentity: "invalid-semantic-override",
      columns: [{ name: "remark", dataType: "VARCHAR", nullable: false, length: 64 }],
    }, { rowCount: 1, seed: "bad-override", semanticOverrides: { remark: 42 } });
    assert.equal(diagnostic(invalidOverride, "semantic_override_invalid")?.column, "remark");
    assert.equal(invalidOverride.status, "blocked");

    const unsupported = buildGenerationPlan({
      tableIdentity: "unsupported-semantic",
      columns: [{ name: "remark", dataType: "VARCHAR", nullable: false, length: 64 }],
    }, { rowCount: 1, seed: "bad-type", semanticOverrides: { remark: "organization" } });
    assert.equal(diagnostic(unsupported, "unsupported_semantic_type")?.blocking, true);
  });

  it("resolves explicit semantic override above confirmed mapping and inference", async () => {
    const schema = await getFixture("person_override");
    const explicit = buildGenerationPlan(schema, {
      rowCount: 3,
      seed: "mapping-priority",
      semanticMappings: { customer_name: "gender" },
      semanticOverrides: { customer_name: "name" },
    });
    const explicitColumn = explicit.columns.find((entry) => entry.schema.name === "customer_name");
    assert.equal(explicitColumn.semanticMapping.semanticType, "name");
    assert.equal(explicitColumn.semanticMapping.source, "explicit_user_semantic_override");
    assert.equal(explicitColumn.rule.identity, "semantic:name:v1");

    const confirmed = buildGenerationPlan(schema, {
      rowCount: 3,
      seed: "mapping-priority",
      semanticMappings: { customer_name: "gender" },
    });
    const confirmedColumn = confirmed.columns.find((entry) => entry.schema.name === "customer_name");
    assert.equal(confirmedColumn.semanticMapping.semanticType, "gender");
    assert.equal(confirmedColumn.semanticMapping.source, "confirmed_semantic_mapping");
    assert.equal(confirmedColumn.rule.identity, "semantic:gender:v1");

    const auto = confirmed.columns.find((entry) => entry.schema.name === "phone_no");
    assert.equal(auto.semanticMapping.semanticType, "mobile");
    assert.equal(auto.semanticMapping.status, "needs_confirmation");
    assert.equal(auto.rule.kind, "varchar");
  });

  it("generates a coherent Safe Synthetic Person through fixture preview", async () => {
    const semanticMappings = {
      customer_name: "name",
      gender: "gender",
      birthday: "birthday",
      mobile: "mobile",
      email: "email",
      address: "address",
    };
    const input = { fixtureName: "person_basic", rowCount: 12, seed: "coherent-person", semanticMappings };
    const preview = await previewFixture(input);
    const repeated = await previewFixture(input);
    const exportLike = generateRows(preview.plan);
    assert.equal(preview.status, "ready");
    assert.deepEqual(repeated.rows, preview.rows);
    assert.deepEqual(exportLike.rows, preview.rows);
    assert.equal(preview.plan.semanticGroups.length, 1);
    assert.equal(preview.plan.semanticGroups[0].groupIdentity, "person:default");
    assert.equal(preview.plan.semanticGroups[0].status, "ready");

    for (const row of preview.rows) {
      assert.match(row.customer_name, /^测试用户[A-F0-9]{6}$/);
      assert.match(row.gender, /^测试-[男女]$/);
      assert.match(row.birthday, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(row.mobile, /^测试号\d{8}$/);
      assert.match(row.email, /^p[A-F0-9]{8}@example\.com$/);
      assert.match(row.address, /^测试地址[A-F0-9]{6}$/);
    }
    for (const column of preview.plan.columns.filter((entry) => entry.semanticMapping.selected)) {
      assert.equal(column.personGroupIdentity, "person:default");
      assert.match(column.rule.identity, /^semantic:(name|gender|birthday|mobile|email|address):v1$/);
    }
  });

  it("supports partial Person groups without generating hidden fields", async () => {
    const preview = await previewFixture({
      fixtureName: "person_partial",
      rowCount: 5,
      seed: "partial-person",
      semanticMappings: { person_name: "name", person_email: "email" },
    });
    assert.equal(preview.status, "ready_with_warnings");
    assert.equal(diagnostic(preview, "person_group_partial")?.blocking, false);
    assert.deepEqual(Object.keys(preview.rows[0]), ["person_id", "person_name", "person_email", "notes"]);
    assert.match(preview.rows[0].person_name, /^测试用户[A-F0-9]{6}$/);
    assert.match(preview.rows[0].person_email, /@example\.com$/);
    assert.equal(Object.hasOwn(preview.rows[0], "gender"), false);
    assert.equal(Object.hasOwn(preview.rows[0], "mobile"), false);
  });

  it("uses explicit groups for multiple Persons and diagnoses implicit conflicts", async () => {
    const semanticMappings = {
      customer_name: "name",
      customer_mobile: "mobile",
      contact_name: "name",
      contact_mobile: "mobile",
    };
    const grouped = await previewFixture({
      fixtureName: "person_two_groups",
      rowCount: 4,
      seed: "two-person-groups",
      semanticMappings,
      personGroups: [
        { id: "customer", columns: ["customer_name", "customer_mobile"] },
        { id: "contact", columns: ["contact_name", "contact_mobile"] },
      ],
    });
    assert.equal(grouped.plan.semanticGroups.length, 2);
    assert.equal(grouped.rows[0].customer_name === grouped.rows[0].contact_name, false);
    assert.equal(grouped.rows[0].customer_mobile === grouped.rows[0].contact_mobile, false);
    assert.deepEqual(grouped.rows, (await previewFixture({
      fixtureName: "person_two_groups",
      rowCount: 4,
      seed: "two-person-groups",
      semanticMappings,
      personGroups: [
        { id: "customer", columns: ["customer_name", "customer_mobile"] },
        { id: "contact", columns: ["contact_name", "contact_mobile"] },
      ],
    })).rows);

    const conflicted = buildGenerationPlan(await getFixture("person_two_groups"), {
      rowCount: 2,
      seed: "implicit-groups",
      semanticMappings,
    });
    assert.equal(diagnostic(conflicted, "person_group_conflict")?.blocking, true);
    assert.equal(conflicted.status, "blocked");
    assert.deepEqual(generateRows(conflicted).rows, []);
  });

  it("keeps Person values stable across non-Person changes and independent rule changes", async () => {
    const schema = await getFixture("person_basic");
    const options = {
      rowCount: 8,
      seed: "person-column-stability",
      semanticMappings: {
        customer_name: "name",
        gender: "gender",
        birthday: "birthday",
        mobile: "mobile",
        email: "email",
        address: "address",
      },
    };
    const base = generateRows(buildGenerationPlan(schema, options)).rows;
    const withOtherColumn = generateRows(buildGenerationPlan({
      ...schema,
      columns: [...schema.columns, { name: "non_person_note", dataType: "VARCHAR", nullable: false, length: 40 }],
    }, options)).rows;
    for (const field of ["customer_name", "gender", "birthday", "mobile", "email", "address"]) {
      assert.deepEqual(withOtherColumn.map((row) => row[field]), base.map((row) => row[field]), field);
    }

    const withChangedMobileRule = generateRows(buildGenerationPlan(schema, {
      ...options,
      overrides: { mobile: { id: "mobile-rule-change", type: "varchar", maxLength: 10, nullProbability: 0 } },
    })).rows;
    for (const field of ["customer_name", "gender", "birthday", "email", "address"]) {
      assert.deepEqual(withChangedMobileRule.map((row) => row[field]), base.map((row) => row[field]), field);
    }
    assert.notDeepEqual(withChangedMobileRule.map((row) => row.mobile), base.map((row) => row.mobile));
  });

  it("changes deterministic Person values with seed or locale and defaults to Safe Synthetic", async () => {
    const semanticMappings = {
      customer_name: "name",
      gender: "gender",
      birthday: "birthday",
      mobile: "mobile",
      email: "email",
      address: "address",
    };
    const first = await previewFixture({ fixtureName: "person_basic", rowCount: 2, seed: "person-seed-a", semanticMappings });
    const otherSeed = await previewFixture({ fixtureName: "person_basic", rowCount: 2, seed: "person-seed-b", semanticMappings });
    const english = await previewFixture({ fixtureName: "person_basic", rowCount: 2, seed: "person-seed-a", locale: "en", semanticMappings });
    assert.equal(first.plan.mode, "safe_synthetic");
    assert.equal(first.plan.locale, "zh-CN");
    assert.notEqual(first.rows[0].customer_name, otherSeed.rows[0].customer_name);
    assert.notEqual(first.rows[0].customer_name, english.rows[0].customer_name);
    assert.match(english.rows[0].customer_name, /^TestUser[A-F0-9]{6}$/);
    assert.match(english.rows[0].mobile, /^TEST\d{7}$/);
    assert.match(english.rows[0].email, /@example\.com$/);
    assert.match(english.rows[0].address, /^TestAddr[A-F0-9]{6}$/);

    const unsupportedMode = await previewFixture({
      fixtureName: "person_basic",
      rowCount: 1,
      seed: "validator-mode",
      mode: "validator_compatible",
      semanticMappings,
    });
    assert.equal(diagnostic(unsupportedMode, "validator_mode_unsupported")?.blocking, true);
    assert.equal(unsupportedMode.status, "blocked");
  });
});
