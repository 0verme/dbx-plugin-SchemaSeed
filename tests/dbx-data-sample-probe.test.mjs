import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { probeDbxDataSamples, buildSampleSelectQuery, DATA_SAMPLE_FIELD_MAX_LENGTH, DATA_SAMPLE_ROW_LIMIT, DATA_SAMPLE_TIMEOUT_MS, getSampleProbeCandidates } from "../src/host/dbx-data-sample-probe.mjs";
import { describeConstraintDomain } from "../src/generation/constraint-domain.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { interpretColumnType } from "../src/schema/schema-interpreter.mjs";
import { isSensitiveSampleColumn } from "../src/semantic/sample-evidence.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { parseTimestamp } from "../src/schema/temporal-values.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";
import { toColumnViewModel } from "../src/workbench/workbench-view-model.mjs";
import { createI18n } from "../src/i18n/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = { connectionId: "connection-A", database: "app", schema: "public", table: "p_admin_user" };
const privateNames = ["张三", "李四", "王小红", "赵六", "钱七"];
const privateStates = ["ACTIVE", "DISABLED", "ACTIVE", "LOCKED", "DISABLED"];
const privateRoles = ["ADMIN", "EDITOR", "ADMIN", "VIEWER", "ADMIN"];

function schemaOf(columns, tableIdentity = "dbx:p_admin_user") {
  return normalizeTableSchema({ tableIdentity, columns }).schema;
}

function sampleTableSchema() {
  return schemaOf([
    { name: "display_name", dataType: "varchar", nullable: false, length: 128 },
    { name: "status", dataType: "varchar", nullable: false, length: 32 },
    { name: "role", dataType: "varchar", nullable: false, length: 32 },
    { name: "email", dataType: "varchar", nullable: true, length: 254 },
    { name: "payload", dataType: "text", nullable: true },
    { name: "picture", dataType: "blob", nullable: true },
    { name: "last_login_at", dataType: "timestamp", nullable: true, precision: 6 },
    { name: "id", dataType: "integer", nullable: false },
  ]);
}

function resultFor(rows) {
  return {
    dbType: "postgres",
    columns: [{ name: "display_name" }, { name: "status" }, { name: "role" }],
    rows,
    truncated: false,
    elapsedMs: 1,
  };
}

function patternRows(names = privateNames, states = privateStates, roles = privateRoles) {
  return names.map((name, index) => [name, states[index], roles[index]]);
}

function decimalUnits(value, scale) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(String(value));
  assert.ok(match, `expected a plain decimal: ${String(value)}`);
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  assert.ok(fraction.length <= scale);
  return sign * (whole * (10n ** BigInt(scale)) + BigInt(fraction.padEnd(scale, "0") || "0"));
}

test("metadata-ready or unsupported columns produce no sampling candidates and no queryData call", async () => {
  let calls = 0;
  const host = { capabilities: { dataApi: true }, queryData: async () => { calls += 1; return resultFor([]); } };
  const metadataSufficient = schemaOf([
    { name: "id", dataType: "integer", nullable: false },
    { name: "name", dataType: "varchar", nullable: false, length: 128 },
    { name: "email", dataType: "varchar", nullable: true, length: 254 },
  ]);
  assert.deepEqual(getSampleProbeCandidates(metadataSufficient), []);
  assert.deepEqual(await probeDbxDataSamples(host, context, metadataSufficient), { sampleUsed: false, evidence: [] });
  assert.equal(calls, 0);

  const tableSchema = sampleTableSchema();
  const candidates = getSampleProbeCandidates(tableSchema);
  assert.deepEqual(candidates, [
    { name: "display_name", kind: "name", sampling: "direct" },
    { name: "status", kind: "text", sampling: "direct" },
    { name: "last_login_at", kind: "temporal", temporalKind: "timestamp", timezoneAware: false, privacy: "restricted", sampling: "direct" },
  ]);
  assert.equal(isSensitiveSampleColumn("last_login_at"), true);
  assert.equal(candidates.some(({ name }) => ["payload", "picture", "id", "email"].includes(name)), false);
});

test("safe date and timestamp columns become bounded temporal sample candidates", () => {
  const schema = schemaOf([
    { name: "started_at", dataType: "timestamp", nullable: true, precision: 6 },
    { name: "created_on", dataType: "date", nullable: false },
    { name: "captured_at", dataType: "timestamp with time zone", nullable: true, precision: 6 },
    { name: "last_login_at", dataType: "timestamp", nullable: true, precision: 6 },
    { name: "birthday", dataType: "date", nullable: true },
  ]);
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "started_at", kind: "temporal", temporalKind: "timestamp", timezoneAware: false, privacy: "standard", sampling: "direct" },
    { name: "created_on", kind: "temporal", temporalKind: "date", timezoneAware: false, privacy: "standard", sampling: "direct" },
    { name: "captured_at", kind: "temporal", temporalKind: "timestamp", timezoneAware: true, privacy: "standard", sampling: "direct" },
    { name: "last_login_at", kind: "temporal", temporalKind: "timestamp", timezoneAware: false, privacy: "restricted", sampling: "direct" },
    { name: "birthday", kind: "temporal", temporalKind: "date", timezoneAware: false, privacy: "restricted", sampling: "direct" },
  ]);
});

test("bounded category varchar remains a direct-projection candidate", () => {
  const schema = schemaOf([{ name: "category", dataType: "varchar", nullable: true, length: 64 }]);
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "category", kind: "text", sampling: "direct" },
  ]);
});

test("native unbounded text admits only existing strong semantic candidates", () => {
  const schema = schemaOf([
    { name: "category", dataType: "text", nullable: true, length: { state: "unavailable", reason: "DBX omitted length metadata" } },
    { name: "status", dataType: "text", nullable: true },
    { name: "role", dataType: "text", nullable: true },
    { name: "type", dataType: "text", nullable: true },
    { name: "display_name", dataType: "text", nullable: true },
    { name: "billing_email", dataType: "text", nullable: true },
    { name: "primary_phone", dataType: "text", nullable: true },
    { name: "description", dataType: "text", nullable: true },
    { name: "content", dataType: "text", nullable: true },
    { name: "remark", dataType: "text", nullable: true },
    { name: "notes", dataType: "text", nullable: true },
    { name: "generic_unknown", dataType: "text", nullable: true },
    { name: "payload", dataType: "text", nullable: true },
    { name: "category_unbounded_varchar", dataType: "varchar", nullable: true, length: { state: "absent" } },
  ]);
  const category = schema.columns.find(({ name }) => name === "category");
  assert.equal(category.length.state, "unavailable");
  assert.deepEqual(interpretColumnType(category), {
    kind: "varchar",
    parameters: {},
    capacity: { model: "unbounded", source: "native-text-type" },
  });
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "category", kind: "text", sampling: "truncate" },
    { name: "status", kind: "text", sampling: "truncate" },
    { name: "type", kind: "text", sampling: "truncate" },
    { name: "display_name", kind: "name", sampling: "truncate" },
    { name: "billing_email", kind: "email", sampling: "truncate" },
    { name: "primary_phone", kind: "mobile", sampling: "truncate" },
    { name: "generic_unknown", kind: "text", sampling: "truncate" },
  ]);
});

test("PostgreSQL category text triggers a bounded sample query and summary only", async () => {
  const schema = schemaOf([{
    name: "category",
    dataType: "text",
    nullable: true,
    length: { state: "unavailable", reason: "DBX omitted length metadata" },
  }]);
  const requests = [];
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    async queryData(request) {
      requests.push(request);
      return {
        columns: [{ name: "category" }],
        rows: [["active"], ["active"], ["active"], ["archived"], ["archived"]],
      };
    },
  }, { ...context, table: "audit_results" }, schema);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].maxRows, 8);
  assert.equal(requests[0].timeoutMs, DATA_SAMPLE_TIMEOUT_MS);
  assert.match(requests[0].sql, /^SELECT SUBSTR\(ss\.category, 1, 1024\) AS category FROM audit_results AS ss LIMIT 8$/);
  assert.deepEqual(evidence, {
    sampleUsed: true,
    evidence: [{
      column: "category", kind: "enum_like", sampleCount: 5, distinctCount: 2,
      candidates: [{ value: "active", frequency: 3 }, { value: "archived", frequency: 2 }],
    }],
  });
});

test("temporal samples retain bounded min/max, exact precision, timezone semantics, and NULL counts only", async () => {
  const schema = schemaOf([
    { name: "started_at", dataType: "timestamp", nullable: true, precision: 6 },
    { name: "created_on", dataType: "date", nullable: false },
    { name: "captured_at", dataType: "timestamptz", nullable: false, precision: 6 },
  ]);
  const columns = [{ name: "started_at" }, { name: "created_on" }, { name: "captured_at" }];
  const rows = [
    ["2026-06-01 08:00:00.123456", "2026-06-01", "2026-06-01T12:00:00.123456+08:00"],
    [null, "2026-06-07", "2026-06-07T12:00:00.456789Z"],
    ["2026-07-31 23:59:59.999999", "2026-07-31", "2026-07-31T00:30:00.000001-05:00"],
  ];
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns, rows }),
  }, context, schema);

  assert.deepEqual(result, {
    sampleUsed: true,
    evidence: [
      {
        column: "started_at", kind: "temporal_range", temporalKind: "timestamp",
        sampleCount: 3, nullCount: 1, nullRate: 1 / 3, observedCount: 2,
        observedMin: "2026-06-01 08:00:00.123456", observedMax: "2026-07-31 23:59:59.999999",
        precision: 6, timezoneAware: false,
      },
      {
        column: "created_on", kind: "temporal_range", temporalKind: "date",
        sampleCount: 3, nullCount: 0, nullRate: 0, observedCount: 3,
        observedMin: "2026-06-01", observedMax: "2026-07-31", precision: 0, timezoneAware: false,
      },
      {
        column: "captured_at", kind: "temporal_range", temporalKind: "timestamp",
        sampleCount: 3, nullCount: 0, nullRate: 0, observedCount: 3,
        observedMin: "2026-06-01T04:00:00.123456Z", observedMax: "2026-07-31T05:30:00.000001Z",
        precision: 6, timezoneAware: true,
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /\+08:00|-05:00|2026-06-07T12:00:00/);

  const insufficient = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns, rows: rows.slice(0, 2) }),
  }, context, schema);
  assert.deepEqual(insufficient, { sampleUsed: false, evidence: [] }, "fewer than three temporal rows cannot create a profile");
});

test("sensitive temporal fields keep a value-minimized precision/NULL profile without observed bounds", async () => {
  const schema = schemaOf([{ name: "last_login_at", dataType: "timestamp without time zone", nullable: true }]);
  assert.equal(isSensitiveSampleColumn("last_login_at"), true);
  assert.notEqual(schema.columns[0].precision.state, "known");
  const sourceTimes = [
    "2026-07-20 09:30:00",
    "2026-07-19 09:30:00",
    "2026-07-18 09:30:00",
  ];
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({
      columns: [{ name: "last_login_at" }],
      rows: [[sourceTimes[0]], [sourceTimes[1]], [sourceTimes[2]], [null]],
    }),
  }, context, schema);

  assert.deepEqual(evidence, {
    sampleUsed: true,
    evidence: [{
      column: "last_login_at", kind: "temporal_shape", temporalKind: "timestamp",
      sampleCount: 4, nullCount: 1, nullRate: 0.25, observedCount: 3,
      precision: 0, timezoneAware: false,
    }],
  });
  assert.doesNotMatch(JSON.stringify(evidence), /observedMin|observedMax|2026-07-2[018]/u);

  const plan = buildGenerationPlan(schema, { rowCount: 32, seed: "restricted-temporal", sampleEvidence: evidence.evidence });
  const column = plan.columns[0];
  assert.equal(column.rule.kind, "timestamp");
  assert.equal(column.rule.source, "sample_inference");
  assert.equal(column.rule.parameters.precision, 0);
  assert.equal(column.nullProbability, 0.25);
  assert.equal(column.inference.evidence[0].kind, "sample_temporal_shape");
  assert.equal(Object.hasOwn(column.inference.evidence[0].params, "observedMin"), false);
  assert.equal(Object.hasOwn(column.inference.evidence[0].params, "observedMax"), false);
  assert.doesNotMatch(JSON.stringify(plan), /observedMin|observedMax|2026-07-2[018]/u);

  const generated = generateRows(plan);
  assert.ok(generated.rows.some((row) => row.last_login_at !== null));
  for (const row of generated.rows) {
    if (row.last_login_at === null) continue;
    assert.match(row.last_login_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    assert.doesNotMatch(row.last_login_at, /\.\d{1,9}|Z|[+-]\d{2}:?\d{2}$/u);
  }
});

test("same-type timestamps keep observed seconds precision across standard and restricted profiles", async () => {
  const schema = schemaOf([
    { name: "created_at", dataType: "timestamp without time zone", nullable: false },
    { name: "updated_at", dataType: "timestamp without time zone", nullable: false },
    { name: "last_login_at", dataType: "timestamp without time zone", nullable: true },
  ]);
  const columns = [{ name: "created_at" }, { name: "updated_at" }, { name: "last_login_at" }];
  const rows = Array.from({ length: 8 }, (_value, index) => {
    const date = `2026-07-${String(20 - index).padStart(2, "0")} 09:30:00`;
    return [date, date, date];
  });
  const sampled = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns, rows }),
  }, context, schema);
  assert.deepEqual(sampled.evidence.map(({ column, kind, precision }) => [column, kind, precision]), [
    ["created_at", "temporal_range", 0],
    ["updated_at", "temporal_range", 0],
    ["last_login_at", "temporal_shape", 0],
  ]);
  assert.equal(Object.hasOwn(sampled.evidence[2], "observedMin"), false);
  assert.equal(Object.hasOwn(sampled.evidence[2], "observedMax"), false);

  const plan = buildGenerationPlan(schema, { rowCount: 24, seed: "timestamp-shape-consistency", sampleEvidence: sampled.evidence });
  const created = plan.columns[0];
  const updated = plan.columns[1];
  const login = plan.columns[2];
  assert.equal(created.rule.kind, "timestamp_range");
  assert.equal(updated.rule.kind, "timestamp_range");
  assert.equal(login.rule.kind, "timestamp");
  assert.equal(login.rule.source, "sample_inference");
  assert.deepEqual([created.rule.parameters.precision, updated.rule.parameters.precision, login.rule.parameters.precision], [0, 0, 0]);
  const loginDomain = describeConstraintDomain(login, 24);
  assert.equal(loginDomain.state, "known");
  assert.match(loginDomain.decode(0n), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
  assert.match(created.rule.parameters.start, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
  assert.equal(Object.hasOwn(login.rule.parameters, "start"), false, "restricted generation keeps the schema fallback range");

  const generated = generateRows(plan);
  for (const name of ["created_at", "updated_at", "last_login_at"]) {
    const values = generated.rows.map((row) => row[name]).filter((value) => value !== null);
    assert.ok(values.length > 0, `${name} has non-NULL generated timestamps`);
    assert.ok(values.every((value) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)), name);
    assert.ok(values.every((value) => !/[.]\d{1,9}|Z|[+-]\d{2}:?\d{2}$/u.test(value)), name);
  }
});

test("dataApi capability false gracefully falls back without queryData", async () => {
  let calls = 0;
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: false },
    queryData: async () => { calls += 1; throw new Error("must not call"); },
  }, context, sampleTableSchema());
  assert.deepEqual(result, { sampleUsed: false, evidence: [] });
  assert.equal(calls, 0);
});

test("queryData reads only uncertain candidate columns using bounded rows and timeout", async () => {
  const requests = [];
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    async queryData(request) {
      requests.push(request);
      return resultFor(patternRows());
    },
  }, context, sampleTableSchema(), { timeoutMs: 99_000 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].connectionId, context.connectionId);
  assert.equal(requests[0].database, context.database);
  assert.equal(requests[0].schema, context.schema);
  assert.equal(requests[0].maxRows, DATA_SAMPLE_ROW_LIMIT);
  assert.equal(requests[0].timeoutMs, DATA_SAMPLE_TIMEOUT_MS, "an excessive timeout is clamped to the local bound");
  assert.match(requests[0].sql, /^SELECT ss\.display_name, ss\.status, ss\.last_login_at FROM p_admin_user AS ss LIMIT 8$/);
  assert.doesNotMatch(requests[0].sql, /\*|payload|picture|email|role|\bid\b/);
  assert.match(requests[0].sql, /^SELECT\b/i);
  assert.doesNotMatch(requests[0].sql, /;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
  assert.deepEqual(evidence, {
    sampleUsed: true,
    evidence: [
      { column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5 },
      { column: "status", kind: "enum_like", sampleCount: 5, distinctCount: 3 },
    ],
  });
});

test("sensitive monetary and location numeric columns are excluded from sample probes", () => {
  const schema = schemaOf([
    { name: "amount", dataType: "decimal", nullable: false, precision: 12, scale: 2 },
    { name: "latitude", dataType: "decimal", nullable: false, precision: 9, scale: 6 },
    { name: "金额", dataType: "decimal", nullable: false, precision: 12, scale: 2 },
    { name: "metric_value", dataType: "decimal", nullable: false, precision: 12, scale: 2 },
  ]);
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "metric_value", kind: "numeric", numericKind: "decimal", sampling: "direct" },
  ]);
});

test("numeric profiles preserve exact decimal scale, observed bounds, and zero frequency", async () => {
  const schema = schemaOf([{ name: "metric_value", dataType: "decimal", nullable: false, precision: 30, scale: 6 }]);
  const values = ["0.000000", "9007199254740993.123456", "-3.123456", "4.120000", "12.000000"];
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns: [{ name: "metric_value" }], rows: values.map((value) => [value]) }),
  }, context, schema);
  assert.deepEqual(result.evidence, [{
    column: "metric_value", kind: "numeric_range", sampleCount: 5,
    min: "-3.123456", max: "9007199254740993.123456", zeroCount: 1,
  }]);

  const plan = buildGenerationPlan(schema, { rowCount: 20, seed: "exact-decimal-sample", sampleEvidence: result.evidence });
  assert.equal(plan.columns[0].rule.kind, "sample_numeric");
  assert.equal(plan.columns[0].rule.parameters.minUnits, "-3123456");
  assert.equal(plan.columns[0].rule.parameters.maxUnits, "9007199254740993123456");
  assert.equal(plan.columns[0].rule.parameters.zeroCount, 1);
  const generated = generateRows(plan);
  const minUnits = decimalUnits("-3.123456", 6);
  const maxUnits = decimalUnits("9007199254740993.123456", 6);
  assert.ok(generated.rows.every((row) => {
    const units = decimalUnits(row.metric_value, 6);
    return units >= minUnits && units <= maxUnits;
  }));
});

test("ordered all-distinct numeric samples do not become identifier-like range evidence", async () => {
  const schema = schemaOf([{ name: "event_counter", dataType: "integer", nullable: false }]);
  const shortSequence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns: [{ name: "event_counter" }], rows: [[1001], [1002], [1003]] }),
  }, context, schema);
  assert.deepEqual(shortSequence, { sampleUsed: true, evidence: [] }, "the minimum-sized ordered sample is rejected too");

  const result = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns: [{ name: "event_counter" }], rows: Array.from({ length: 8 }, (_value, index) => [1001 + index]) }),
  }, context, schema);
  assert.deepEqual(result, { sampleUsed: true, evidence: [] });
  const plan = buildGenerationPlan(schema, { rowCount: 8, seed: "ordered-counter", sampleEvidence: result.evidence });
  assert.equal(plan.columns[0].rule.kind, "integer");
  assert.equal(plan.columns[0].rule.source, "schema_type_fallback");
});

test("filename suffix profiles retain only extensions and drive synthetic filename generation", async () => {
  const column = "file_name";
  const schema = schemaOf([{ name: column, dataType: "varchar", nullable: false, length: 128 }]);
  const values = [
    "dws_cust_asset_d.sql", "dws_cust_asset_i.sql", "dwd_acct_event_i.hql", "load_loan_daily.py",
    "post_dws_cust_asset.sh", "dws_loan_balance_sum.json", "cust_asset_recv.json", "audit_snapshot.json",
  ];
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns: [{ name: column }], rows: values.map((value) => [value]) }),
  }, context, schema);
  assert.deepEqual(result, {
    sampleUsed: true,
    evidence: [{
      column, kind: "filename_pattern", sampleCount: 8, matchedCount: 8,
      suffixes: [
        { suffix: ".sql", frequency: 2 }, { suffix: ".hql", frequency: 1 }, { suffix: ".py", frequency: 1 },
        { suffix: ".sh", frequency: 1 }, { suffix: ".json", frequency: 3 },
      ],
    }],
  });
  for (const value of values) assert.equal(JSON.stringify(result).includes(value), false, `source filename ${value} must not escape`);

  const plan = buildGenerationPlan(schema, { rowCount: 20, seed: "filename-sample", sampleEvidence: result.evidence });
  const generated = generateRows(plan);
  assert.equal(plan.columns[0].rule.kind, "sample_filename");
  assert.equal(plan.columns[0].rule.source, "sample_inference");
  assert.ok(generated.rows.every((row) => /^generated_[A-Za-z0-9]+\.(?:sql|hql|py|sh|json)$/u.test(row[column])));
  assert.ok(generated.rows.every((row) => !values.includes(row[column])));

  const nameSchema = schemaOf([{ name: "rule_name", dataType: "varchar", nullable: true, length: 128 }]);
  const ruleNames = ["null_check", "syntax_rule", "required_field", "duplicate_rule", "unique_key", "not_null", "type_check", "valid_email"];
  const negative = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns: [{ name: "rule_name" }], rows: ruleNames.map((value) => [value]) }),
  }, context, nameSchema);
  assert.deepEqual(negative.evidence, [
    { column: "rule_name", kind: "chinese_name_pattern_rejected", sampleCount: 8, matchedCount: 0 },
  ]);
  const fallback = buildGenerationPlan(nameSchema, { rowCount: 2, seed: "negative-name-evidence", sampleEvidence: negative.evidence });
  assert.equal(fallback.columns[0].rule.kind, "varchar");
  assert.equal(fallback.columns[0].inference.status, "unknown");
});

test("mixed pattern samples remain inconclusive and preserve the weak candidate", async () => {
  const schema = schemaOf([{ name: "file_name", dataType: "varchar", nullable: true, length: 128 }]);
  const values = ["张三", "李四", "王小红", "赵六", "foo.sql", "main.py", "rule_x", "README.md"];
  const sampleResult = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({ columns: [{ name: "file_name" }], rows: values.map((value) => [value]) }),
  }, context, schema);
  assert.deepEqual(sampleResult, { sampleUsed: true, evidence: [] });

  const plan = buildGenerationPlan(schema, { rowCount: 2, seed: "mixed-name-evidence", sampleEvidence: sampleResult.evidence });
  assert.equal(plan.columns[0].inference.semanticType, "name");
  assert.equal(plan.columns[0].inference.confidence, "medium");
  assert.equal(plan.columns[0].semanticMapping.status, "needs_confirmation");
});

test("repeated low-cardinality labels become categorical profiles while all-distinct strings fall back", async () => {
  const schema = schemaOf([
    { name: "category", dataType: "varchar", nullable: true, length: 32 },
    { name: "level", dataType: "varchar", nullable: true, length: 32 },
    { name: "all_unique", dataType: "varchar", nullable: true, length: 32 },
  ]);
  const categoryValues = ["dws", "dws", "hive", "python", "sbin", "config", "recv", "dws"];
  const levelValues = ["err", "err", "err", "err", "warn", "err", "warn", "info"];
  const uniqueValues = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
  const result = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({
      columns: [{ name: "category" }, { name: "level" }, { name: "all_unique" }],
      rows: categoryValues.map((category, index) => [category, levelValues[index], uniqueValues[index]]),
    }),
  }, context, schema);

  assert.equal(result.sampleUsed, true);
  assert.deepEqual(result.evidence, [
    { column: "category", kind: "enum_like", sampleCount: 8, distinctCount: 6, candidates: [
      { value: "dws", frequency: 3 }, { value: "hive", frequency: 1 }, { value: "python", frequency: 1 },
      { value: "sbin", frequency: 1 }, { value: "config", frequency: 1 }, { value: "recv", frequency: 1 },
    ] },
    { column: "level", kind: "enum_like", sampleCount: 8, distinctCount: 3, candidates: [
      { value: "err", frequency: 5 }, { value: "warn", frequency: 2 }, { value: "info", frequency: 1 },
    ] },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel/);
  const plan = buildGenerationPlan(schema, { rowCount: 20, seed: "categorical-profile", sampleEvidence: result.evidence });
  assert.equal(plan.columns[0].rule.kind, "sample_enum");
  assert.equal(plan.columns[1].rule.kind, "sample_enum");
  assert.equal(plan.columns[2].rule.kind, "varchar");
  assert.deepEqual(plan.columns[0].inference.recommendation, { kind: "enum", source: "sample_inference" });
  assert.deepEqual(plan.columns[1].inference.recommendation, { kind: "enum", source: "sample_inference" });
});

test("all-NULL and inconsistent name samples do not create inference evidence", async () => {
  const allNull = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => resultFor(Array.from({ length: DATA_SAMPLE_ROW_LIMIT }, () => [null, null, null])),
  }, context, sampleTableSchema());
  assert.deepEqual(allNull, { sampleUsed: false, evidence: [] });

  const mixed = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => resultFor([["张三", "ACTIVE", "ADMIN"], ["A1", "DISABLED", "EDITOR"], ["test", "ACTIVE", "ADMIN"], ["UNKNOWN", "LOCKED", "VIEWER"]]),
  }, context, sampleTableSchema());
  assert.deepEqual(mixed, {
    sampleUsed: true,
    evidence: [{ column: "status", kind: "enum_like", sampleCount: 4, distinctCount: 3 }],
  });
});

test("permission denial, query errors, and timeout return metadata-only evidence", async () => {
  const denied = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => { throw new Error("PLUGIN_DATA_ACCESS_NOT_GRANTED: private sample detail"); },
  }, context, sampleTableSchema());
  assert.deepEqual(denied, { sampleUsed: false, evidence: [] });

  const errored = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => { throw new Error("query failed"); },
  }, context, sampleTableSchema());
  assert.deepEqual(errored, { sampleUsed: false, evidence: [] });

  const timedOut = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: () => new Promise(() => {}),
  }, context, sampleTableSchema(), { timeoutMs: 1 });
  assert.deepEqual(timedOut, { sampleUsed: false, evidence: [] });
});

test("query builder combines direct and truncated projections while keeping LIMIT 8", () => {
  const query = buildSampleSelectQuery(context, [
    { name: "bounded_field", kind: "enum", sampling: "direct" },
    { name: "category", kind: "enum", sampling: "truncate" },
  ]);
  assert.deepEqual(query, {
    sql: "SELECT ss.bounded_field, SUBSTR(ss.category, 1, 1024) AS category FROM p_admin_user AS ss LIMIT 8",
    columns: ["bounded_field", "category"],
  });
});

test("identifier renderer fails closed for unsafe tables and excludes unsafe columns", async () => {
  const direct = { name: "status", kind: "enum", sampling: "direct" };
  assert.equal(buildSampleSelectQuery({ ...context, table: "users; DROP TABLE accounts" }, [direct]), null);
  assert.equal(buildSampleSelectQuery({ ...context, table: "user" }, [direct]), null);
  assert.equal(buildSampleSelectQuery(context, [{ ...direct, name: "status; DELETE FROM users" }]), null);
  assert.deepEqual(buildSampleSelectQuery(context, [
    direct,
    { name: "status; DELETE FROM users", kind: "enum", sampling: "truncate" },
  ]), {
    sql: "SELECT ss.status FROM p_admin_user AS ss LIMIT 8",
    columns: ["status"],
  });

  let calls = 0;
  const unsafeTableResult = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => { calls += 1; return resultFor([]); },
  }, { ...context, table: "users; DROP TABLE accounts" }, sampleTableSchema());
  assert.deepEqual(unsafeTableResult, { sampleUsed: false, evidence: [] });
  assert.equal(calls, 0, "an unsafe table identifier skips the whole probe");
});

test("sample values longer than 1024 characters cannot enter evidence", async () => {
  const schema = schemaOf([{ name: "category", dataType: "text", nullable: true }]);
  const privateValueA = `private-a-${"x".repeat(DATA_SAMPLE_FIELD_MAX_LENGTH)}`;
  const privateValueB = `private-b-${"y".repeat(DATA_SAMPLE_FIELD_MAX_LENGTH)}`;
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({
      columns: [{ name: "category" }],
      rows: [[privateValueA], [privateValueA], [privateValueB], [privateValueB]],
    }),
  }, context, schema);
  assert.deepEqual(evidence, { sampleUsed: false, evidence: [] });
  assert.doesNotMatch(JSON.stringify(evidence), /private-a|private-b/);
});

test("sample summaries raise display_name confidence but never copy source values into synthetic rows", () => {
  const schema = schemaOf([
    { name: "display_name", dataType: "varchar", nullable: false, length: 128 },
    { name: "status", dataType: "varchar", nullable: false, length: 32 },
    { name: "role", dataType: "varchar", nullable: false, length: 32 },
    { name: "last_login_at", dataType: "timestamp", nullable: false, precision: 6 },
    { name: "amount", dataType: "numeric", nullable: false, precision: 12, scale: 3 },
  ]);
  const sampleEvidence = [
    { column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5 },
    {
      column: "status", kind: "enum_like", sampleCount: 5, distinctCount: 3,
      candidates: [{ value: "active", frequency: 3 }, { value: "archived", frequency: 1 }, { value: "pending", frequency: 1 }],
    },
    { column: "role", kind: "enum_like", sampleCount: 5, distinctCount: 3 },
  ];
  const plan = buildGenerationPlan(schema, { rowCount: 20, seed: "synthetic-only", sampleEvidence });
  const generated = generateRows(plan);
  const displayName = plan.columns.find((column) => column.schema.name === "display_name");
  assert.equal(displayName.inference.confidence, "high");
  assert.equal(displayName.semanticMapping.selected, true);
  assert.equal(displayName.rule.kind, "semantic:name");
  assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required" && entry.column === "display_name"), false);
  assert.ok(generated.rows.every((row) => !privateNames.includes(row.display_name)));
  assert.ok(generated.rows.every((row) => !privateStates.includes(row.status)));
  assert.ok(generated.rows.every((row) => !privateRoles.includes(row.role)));

  const status = plan.columns.find((entry) => entry.schema.name === "status");
  assert.equal(status.inference.recommendation.kind, "enum");
  assert.equal(status.rule.kind, "sample_enum");
  const statusView = toColumnViewModel(status, plan.diagnostics, { translator: createI18n("zh-CN") });
  assert.equal(statusView.recommendation.label, "枚举值");
  assert.equal(statusView.selectedMapping, "枚举采样");
  assert.equal(statusView.mappingStatusToken, "sampleStrategy");

  const role = plan.columns.find((entry) => entry.schema.name === "role");
  assert.equal(role.inference.recommendation, null, "sensitive category labels without safe candidates are not recommended");
  assert.equal(role.rule.kind, "varchar");
  const timestamp = plan.table.columns.find((column) => column.name === "last_login_at");
  assert.deepEqual(timestamp.precision, { state: "known", value: 6 });
  assert.equal(plan.diagnostics.some((entry) => entry.code === "timestamp_precision_unknown" && entry.column === "last_login_at"), false);
  assert.deepEqual(plan.table.columns.find((column) => column.name === "amount").precision, { state: "known", value: 12 });
  assert.deepEqual(plan.table.columns.find((column) => column.name === "amount").scale, { state: "known", value: 3 });
  assert.doesNotMatch(JSON.stringify(plan), /张三|李四|王小红|赵六|钱七|ACTIVE|DISABLED|LOCKED|ADMIN|EDITOR|VIEWER/);
  assert.doesNotMatch(JSON.stringify(generated.rows), /张三|李四|王小红|赵六|钱七|ACTIVE|DISABLED|LOCKED|ADMIN|EDITOR|VIEWER/);
});

test("controller reports metadata-only when there are no probe candidates", async () => {
  const schema = schemaOf([{ name: "id", dataType: "integer", nullable: false }]);
  let calls = 0;
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    async sampleProbe() { calls += 1; return { sampleUsed: true, evidence: [] }; },
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });
  assert.equal(calls, 0);
  assert.equal(view.sampleUsed, false);
});

test("controller applies safe category profiles and shows their effective strategy", async () => {
  const schema = schemaOf([{ name: "category", dataType: "text", nullable: true }]);
  const values = ["dws", "dws", "hive", "python", "sbin", "config", "recv", "dws"];
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    translator: createI18n("zh-CN"),
    sampleProbe: ({ context: sampleContext, schema: sampleSchema }) => probeDbxDataSamples({
      capabilities: { dataApi: true },
      queryData: async () => ({ columns: [{ name: "category" }], rows: values.map((value) => [value]) }),
    }, sampleContext, sampleSchema),
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });

  assert.equal(view.sampleUsed, true);
  assert.equal(controller.sampleEvidence[0].kind, "enum_like");
  assert.equal(view.columns.find((column) => column.column === "category").rule.kind, "sample_enum");
  const category = view.columns.find((column) => column.column === "category");
  assert.equal(category.selectedMapping, "枚举采样");
  assert.equal(category.mappingStatusToken, "sampleStrategy");
});

test("temporal sample ranges and NULL rates drive one consistent Preview/CSV/JSON/INSERT snapshot", async () => {
  const schema = schemaOf([
    { name: "started_at", dataType: "timestamp", nullable: true, precision: 6 },
    { name: "finished_at", dataType: "timestamp without time zone", nullable: true, precision: 6 },
    { name: "created_on", dataType: "date", nullable: false },
    { name: "created_instant", dataType: "timestamptz", nullable: false, precision: 6 },
  ], "dbx:audit_events");
  const sampleRows = [
    ["2026-06-03 10:15:30.423911", null, "2026-06-03", "2026-06-03T18:15:30.423911+08:00"],
    ["2026-06-05 10:15:31.123456", null, "2026-06-05", "2026-06-05T10:15:31.123456Z"],
    [null, "2026-06-08 11:00:00.000001", "2026-06-08", "2026-06-08T11:00:00.000001Z"],
    ["2026-07-08 15:47:40.423911", null, "2026-07-08", null],
    ["2026-07-31 23:59:59.999999", null, "2026-07-31", "2026-07-31T23:59:59.999999-05:00"],
  ];
  const host = {
    capabilities: { dataApi: true },
    async queryData() {
      return {
        columns: [{ name: "started_at" }, { name: "finished_at" }, { name: "created_on" }, { name: "created_instant" }],
        rows: sampleRows,
      };
    },
  };
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    translator: createI18n("en"),
    sampleProbe: ({ context: sampleContext, schema: sampleSchema }) => probeDbxDataSamples(host, sampleContext, sampleSchema),
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  let view = await controller.setContext({ ...context, table: "audit_events" });
  view = await controller.dispatch({ type: "update-controls", controls: { rowCount: 80, seed: "temporal-profile", locale: "en" } });

  assert.equal(view.sampleUsed, true);
  assert.equal(view.export.enabled, true);
  assert.equal(controller.sampleEvidence.length, 4);
  const started = view.columns.find(({ column }) => column === "started_at");
  const finished = view.columns.find(({ column }) => column === "finished_at");
  const createdOn = view.columns.find(({ column }) => column === "created_on");
  const instant = view.columns.find(({ column }) => column === "created_instant");
  assert.equal(started.rule.kind, "timestamp_range");
  assert.equal(finished.rule.kind, "timestamp_range");
  assert.equal(createdOn.rule.kind, "date_range");
  assert.equal(instant.rule.kind, "timestamp_range");
  assert.equal(controller.plan.columns.find(({ schema: column }) => column.name === "started_at").nullProbability, 0.2);
  assert.equal(controller.plan.columns.find(({ schema: column }) => column.name === "finished_at").nullProbability, 0.8);
  assert.equal(controller.plan.columns.find(({ schema: column }) => column.name === "created_instant").nullProbability, 0,
    "NOT NULL schema facts override observed sample NULLs");
  assert.equal(started.recommendation.label, "Sampled temporal range");

  const rows = view.preview.rows;
  assert.equal(rows.length, 80);
  assert.ok(rows.some(({ started_at }) => started_at === null));
  assert.ok(rows.some(({ started_at }) => started_at !== null));
  assert.ok(rows.some(({ finished_at }) => finished_at === null));
  assert.ok(rows.some(({ finished_at }) => finished_at !== null));
  assert.ok(rows.every(({ started_at }) => started_at === null
    || (started_at >= "2026-06-03 10:15:30.423911" && started_at <= "2026-07-31 23:59:59.999999")));
  assert.ok(rows.every(({ finished_at }) => finished_at === null || finished_at === "2026-06-08 11:00:00.000001"));
  assert.ok(rows.every(({ created_on }) => /^2026-0[67]-\d{2}$/u.test(created_on)));
  assert.ok(rows.every(({ created_instant }) => {
    if (created_instant === null) return false;
    const parsed = parseTimestamp(created_instant, { timezoneAware: true });
    return typeof created_instant === "string" && created_instant.endsWith("Z") && parsed !== null
      && parsed.nanoseconds >= parseTimestamp("2026-06-03T10:15:30.423911Z", { timezoneAware: true }).nanoseconds
      && parsed.nanoseconds <= parseTimestamp("2026-08-01T04:59:59.999999Z", { timezoneAware: true }).nanoseconds;
  }));
  assert.ok(rows.every(({ started_at, finished_at }) => [started_at, finished_at].every((value) => value === null || !value.endsWith("Z"))));

  const csv = controller.prepareExport("csv").content;
  const json = controller.prepareExport("json").content;
  const sql = controller.prepareExport("sql").content;
  assert.deepEqual(JSON.parse(json), rows, "JSON serializes the exact preview snapshot");
  assert.match(csv, /2026-06-08 11:00:00\.000001/u);
  assert.match(csv, /2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z/u);
  assert.match(sql, /'2026-06-08 11:00:00\.000001'/u);
  assert.match(sql, /'2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z'/u);
  assert.doesNotMatch(sql, /'2026-06-08 11:00:00\.000001Z'/u);
});

test("Workbench session probes a table once, caches summaries only, and never resamples for UI edits", async () => {
  const schemaA = sampleTableSchema();
  const schemaB = schemaOf([{ name: "display_name", dataType: "varchar", nullable: false, length: 128 }], "dbx:other");
  const sampleCalls = [];
  const previewCalls = [];
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata({ tableContext }) { return tableContext.table === "alpha" ? schemaA : schemaB; } },
    async sampleProbe(request) {
      sampleCalls.push(request.context.table);
      return [{ column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5, values: privateNames }];
    },
    async preview(schema, options) {
      previewCalls.push(structuredClone(options));
      const plan = buildGenerationPlan(schema, options);
      return { plan, generated: generateRows(plan) };
    },
  });

  let view = await controller.setContext({ ...context, table: "alpha" });
  assert.equal(sampleCalls.length, 1);
  assert.equal(view.sampleUsed, true);
  assert.equal(view.columns.find((column) => column.column === "display_name").confidenceKey, "high");
  assert.equal(Object.hasOwn(previewCalls[0].sampleEvidence[0], "values"), false);
  assert.doesNotMatch(JSON.stringify(previewCalls[0].sampleEvidence), /张三|李四|王小红/);

  view = await controller.dispatch({ type: "update-controls", controls: { rowCount: 5, seed: "new-seed", locale: "zh-CN" } });
  assert.equal(sampleCalls.length, 1);
  await controller.setContext({ ...context, table: "alpha" });
  assert.equal(sampleCalls.length, 1);
  await controller.setContext({ ...context, table: "beta" });
  await controller.setContext({ ...context, table: "alpha" });
  assert.deepEqual(sampleCalls, ["alpha", "beta"], "returning to a table reuses the in-session sample evidence");
  assert.ok(previewCalls.every((options) => !JSON.stringify(options.sampleEvidence).includes("张三")));
});

test("raw sample values never reach the Core preview, synthetic rows, or export", async () => {
  const schema = schemaOf([
    { name: "display_name", dataType: "varchar", nullable: false, length: 128 },
    { name: "status", dataType: "varchar", nullable: false, length: 32 },
    { name: "role", dataType: "varchar", nullable: false, length: 32 },
  ]);
  const previewCalls = [];
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    async sampleProbe() {
      return [
        { column: "display_name", kind: "chinese_name_pattern", sampleCount: 5, matchedCount: 5, values: privateNames },
        { column: "status", kind: "enum_like", sampleCount: 5, distinctCount: 3, values: privateStates },
        { column: "role", kind: "enum_like", sampleCount: 5, distinctCount: 3, values: privateRoles },
      ];
    },
    async preview(tableSchema, options) {
      previewCalls.push(structuredClone(options));
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });
  const privateValues = /张三|李四|王小红|赵六|钱七|ACTIVE|DISABLED|LOCKED|ADMIN|EDITOR|VIEWER/;

  assert.equal(view.export.enabled, true);
  assert.equal(Object.hasOwn(previewCalls[0].sampleEvidence[0], "values"), false);
  assert.doesNotMatch(JSON.stringify(previewCalls[0].sampleEvidence), privateValues);
  assert.doesNotMatch(JSON.stringify(view.preview.rows), privateValues);
  assert.doesNotMatch(controller.prepareExport("json").content, privateValues);
});

test("sample probe failure falls back to a usable metadata-only Workbench preview", async () => {
  const schema = schemaOf([{ name: "status", dataType: "text", nullable: true }]);
  let calls = 0;
  const controller = new DbxGenerationWorkbenchController({
    provider: { async getTableMetadata() { return schema; } },
    async sampleProbe({ candidates }) {
      calls += 1;
      assert.deepEqual(candidates, [{ name: "status", kind: "text", sampling: "truncate" }]);
      throw new Error("PLUGIN_DATA_ACCESS_NOT_GRANTED: private sample details");
    },
    async preview(tableSchema, options) {
      const plan = buildGenerationPlan(tableSchema, options);
      return { plan, generated: generateRows(plan) };
    },
  });
  const view = await controller.setContext({ connectionId: "connection-A", table: "audit_results" });
  assert.equal(calls, 1);
  assert.equal(view.sampleUsed, false);
  assert.ok(view.preview.rows.length > 0);
  assert.equal(view.export.enabled, true);
  assert.deepEqual(controller.sampleEvidence, []);
  assert.doesNotMatch(JSON.stringify(view), /private sample details|PLUGIN_DATA_ACCESS_NOT_GRANTED/);
});

test("uncertain email and mobile candidates use pattern evidence, never their values", async () => {
  const schema = schemaOf([
    { name: "billing_email", dataType: "varchar", nullable: true, length: 254 },
    { name: "primary_phone", dataType: "varchar", nullable: true, length: 24 },
  ]);
  const sampleEmails = ["person1@example.org", "person2@example.org", "person3@example.org", "person4@example.org"];
  const samplePhones = ["13800000001", "13800000002", "13800000003", "13800000004"];
  assert.deepEqual(getSampleProbeCandidates(schema), [
    { name: "billing_email", kind: "email", sampling: "direct" },
    { name: "primary_phone", kind: "mobile", sampling: "direct" },
  ]);
  const evidence = await probeDbxDataSamples({
    capabilities: { dataApi: true },
    queryData: async () => ({
      columns: [{ name: "billing_email" }, { name: "primary_phone" }],
      rows: sampleEmails.map((email, index) => [email, samplePhones[index]]),
    }),
  }, context, schema);
  assert.deepEqual(evidence, {
    sampleUsed: true,
    evidence: [
      { column: "billing_email", kind: "email_pattern", sampleCount: 4, matchedCount: 4 },
      { column: "primary_phone", kind: "mobile_pattern", sampleCount: 4, matchedCount: 4 },
    ],
  });

  const plan = buildGenerationPlan(schema, { rowCount: 5, seed: "email-mobile-synthetic", sampleEvidence: evidence.evidence });
  const generated = generateRows(plan);
  for (const name of ["billing_email", "primary_phone"]) {
    const column = plan.columns.find((entry) => entry.schema.name === name);
    assert.equal(column.semanticMapping.selected, true);
    assert.equal(plan.diagnostics.some((entry) => entry.code === "semantic_confirmation_required" && entry.column === name), false);
  }
  assert.ok(generated.rows.every((row) => !sampleEmails.includes(row.billing_email)));
  assert.ok(generated.rows.every((row) => !samplePhones.includes(row.primary_phone)));
  assert.doesNotMatch(JSON.stringify(plan), /person1@example\.org|13800000001/);
});

test("sample evidence adds no raw values to logs or durable storage", async () => {
  const source = await readFile(path.join(root, "src/host/dbx-data-sample-probe.mjs"), "utf8");
  const app = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
  assert.doesNotMatch(source, /console\.(?:log|debug|info|warn|error)|localStorage|sessionStorage|telemetry|analytics|fetch\s*\(/i);
  assert.doesNotMatch(app, /console\.(?:log|debug|info|warn|error)|localStorage\.setItem\([^)]*sample/i);
});
