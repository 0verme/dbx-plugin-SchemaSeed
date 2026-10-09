import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { interpretColumnType, parseDeclaredTemporalPrecision } from "../src/schema/schema-interpreter.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import {
  buildMySqlTemporalMetadataQuery,
  buildPostgresTemporalMetadataQuery,
  resolveDbxTemporalMetadata,
  TEMPORAL_METADATA_MAX_ROWS,
  TEMPORAL_METADATA_TIMEOUT_MS,
} from "../src/host/dbx-temporal-metadata-resolver.mjs";

const context = { connectionId: "dbx-connection", database: "bilibili", table: "coupon_claims" };
const schemaFor = (dataType, precision = { state: "unknown", reason: "not returned" }, name = "checked_at") => normalizeTableSchema({
  tableIdentity: "dbx:test",
  columns: [{ name, dataType, nullable: false, precision }],
}).schema;
const planFor = (dataType, precision, options = {}) => buildGenerationPlan(schemaFor(dataType, precision), {
  rowCount: 12,
  seed: "issue-82-temporal-seed",
  ...options,
});
const columnPlan = (plan) => plan.columns[0];
const warningFor = (plan) => plan.diagnostics.find((entry) => entry.code === "timestamp_precision_unknown");

function dataApiHost(handler, calls = []) {
  return {
    capabilities: { dataApi: true },
    async queryData(request) {
      calls.push(request);
      return handler(request, calls.length);
    },
  };
}

function discoveryResult(dbType = "mysql") {
  return { dbType, columns: [{ name: "ss_temporal_precision_probe" }], rows: [[1]], truncated: false };
}

function metadataResult({ dbType = "mysql", columnName = "checked_at", dataType = "timestamp", columnType = "timestamp(6)", precision = 6, truncated = false } = {}) {
  return {
    dbType,
    columns: [
      { name: "column_name" },
      { name: "data_type" },
      { name: "column_type" },
      { name: "datetime_precision" },
    ],
    rows: [[columnName, dataType, columnType, precision]],
    truncated,
  };
}

describe("temporal precision resolution", () => {
  it("keeps structured Host precision authoritative, including zero and conflicts", () => {
    const schema = schemaFor("timestamp(6)", {
      state: "known",
      value: 0,
      provenance: "DBX Host API 1.3 fieldCapabilities.precision=supported; column.precision=present",
    });
    const plan = buildGenerationPlan(schema, { rowCount: 4, seed: "host-zero" });
    const column = columnPlan(plan);

    assert.equal(column.schema.precision.state, "known");
    assert.equal(column.schema.precision.value, 0);
    assert.equal(column.rule.parameters.precision, 0);
    assert.deepEqual(column.temporalPrecision, {
      declaration: {
        state: "known",
        value: 0,
        source: "structured",
        provenance: "DBX Host API 1.3 fieldCapabilities.precision=supported; column.precision=present",
      },
      generation: { value: 0, source: "structured" },
    });
    assert.equal(warningFor(plan), undefined);
    assert.ok(generateRows(plan).rows.every((row) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(row.checked_at)));
  });

  it("derives only explicit legal temporal declarations and propagates them to generation", () => {
    const cases = [
      ["timestamp(6)", 6, false],
      ["timestamp(3)", 3, false],
      ["datetime(6)", 6, false],
      ["datetime(3)", 3, false],
      ["timestamp(0)", 0, false],
      ["timestamp(6) without time zone", 6, false],
      ["timestamp(6) with time zone", 6, true],
      ["timestamptz(6)", 6, true],
    ];

    for (const [dataType, expected, timezoneAware] of cases) {
      const plan = planFor(dataType);
      const column = columnPlan(plan);
      assert.equal(column.rule.parameters.precision, expected, dataType);
      assert.equal(column.rule.parameters.timezoneAware, timezoneAware, dataType);
      assert.equal(column.temporalPrecision.declaration.state, "known", dataType);
      assert.equal(column.temporalPrecision.declaration.source, "declared_type", dataType);
      assert.match(column.temporalPrecision.declaration.provenance, /Declared temporal type precision/u);
      assert.equal(column.schema.precision.state, "unknown", "the original Host SchemaFact is not rewritten");
      assert.equal(warningFor(plan), undefined, dataType);
      const rows = generateRows(plan).rows;
      const fractional = expected === 0 ? "" : `\\.\\d{${expected}}`;
      assert.ok(rows.every((row) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}${fractional}${timezoneAware ? "Z" : ""}$`, "u").test(row.checked_at)), dataType);
    }
  });

  it("uses type-derived precision without rewriting null, omitted, unsupported, or unknown Host facts", () => {
    for (const rawPrecision of [null, undefined, { state: "absent" }, { state: "unsupported", reason: "not exposed" }, { state: "unknown", reason: "unknown" }]) {
      const schema = normalizeTableSchema({
        tableIdentity: "derived-fact-states",
        columns: [{ name: "checked_at", dataType: "timestamp(6)", nullable: false, precision: rawPrecision }],
      }).schema;
      const plan = buildGenerationPlan(schema, { rowCount: 3, seed: "p2-state" });
      assert.equal(columnPlan(plan).rule.parameters.precision, 6);
      assert.equal(columnPlan(plan).schema.precision.state, schema.columns[0].precision.state);
      assert.equal(columnPlan(plan).temporalPrecision.declaration.source, "declared_type");
      assert.equal(warningFor(plan), undefined);
    }
  });

  it("does not confuse numeric precision, unsupported typmods, or unqualified temporal types", () => {
    for (const declaration of ["timestamp", "datetime", "timestamp without time zone", "timestamptz", "timestamp(10)", "timestamp(6,2)", "timestamp(6) nonsense", "datetime(6) with time zone", "timestamptz(6) without time zone"]) {
      assert.equal(parseDeclaredTemporalPrecision({ dataType: { state: "known", value: declaration } }), null, declaration);
    }
    assert.equal(parseDeclaredTemporalPrecision({ dataType: { state: "known", value: "decimal(6,2)" } }), null);
    assert.equal(parseDeclaredTemporalPrecision({ dataType: { state: "known", value: "varchar(6)" } }), null);
    for (const declaration of ["timestamp(6) nonsense", "datetime(6) with time zone", "timestamptz(6) without time zone"]) {
      assert.equal(interpretColumnType(schemaFor(declaration).columns[0]), null, declaration);
    }

    for (const declaration of ["timestamp", "datetime", "timestamp(10)", "timestamp(6,2)"]) {
      const plan = planFor(declaration);
      assert.equal(columnPlan(plan).rule.parameters.precision, 3, declaration);
      assert.equal(columnPlan(plan).temporalPrecision.declaration.state, "unknown", declaration);
      assert.equal(warningFor(plan)?.code, "timestamp_precision_unknown", declaration);
      assert.match(warningFor(plan).reason, /Declared timestamp precision is unknown/u);
    }

    const numeric = buildGenerationPlan({ tableIdentity: "numeric", columns: [{ name: "amount", dataType: "DECIMAL(6,2)", precision: 6, scale: 2, nullable: false }] }, {
      rowCount: 2, seed: "numeric-is-not-temporal",
    });
    assert.equal(numeric.columns[0].rule.kind, "decimal");
    assert.equal(numeric.columns[0].rule.parameters.precision, 6);
    assert.equal(numeric.columns[0].temporalPrecision, undefined);
  });

  it("leaves unqualified PostgreSQL/SQLite temporal declarations unknown and preserves timezone semantics", () => {
    for (const dataType of ["TIMESTAMP", "DATETIME", "timestamp without time zone", "timestamp with time zone", "timestamptz"]) {
      const plan = planFor(dataType);
      assert.equal(columnPlan(plan).temporalPrecision.declaration.state, "unknown", dataType);
      assert.equal(columnPlan(plan).temporalPrecision.generation.value, 3, dataType);
      assert.equal(warningFor(plan)?.code, "timestamp_precision_unknown", dataType);
    }
    assert.equal(columnPlan(planFor("TIMESTAMP WITHOUT TIME ZONE")).rule.parameters.timezoneAware, false);
    assert.equal(columnPlan(planFor("TIMESTAMP WITH TIME ZONE")).rule.parameters.timezoneAware, true);
    assert.equal(columnPlan(planFor("TIMESTAMPTZ")).rule.parameters.timezoneAware, true);
    assert.equal(columnPlan(planFor("DATETIME")).rule.parameters.precision, 3, "SQLite-style loose declarations do not imply precision zero");
  });

  it("uses samples only as observed formatting evidence, while unknown declarations retain a warning", () => {
    const plan = buildGenerationPlan(schemaFor("timestamp", { state: "unavailable" }, "created_at"), {
      rowCount: 6,
      seed: "sample-is-not-schema",
      sampleEvidence: [{
        column: "created_at",
        kind: "temporal_range",
        temporalKind: "timestamp",
        sampleCount: 4,
        nullCount: 0,
        nullRate: 0,
        observedCount: 4,
        observedMin: "2024-01-01 00:00:00.123456",
        observedMax: "2024-01-02 00:00:00.123456",
        precision: 6,
        timezoneAware: false,
      }],
    });
    const column = columnPlan(plan);
    assert.equal(column.schema.precision.state, "unavailable");
    assert.equal(column.temporalPrecision.declaration.state, "unknown");
    assert.deepEqual(column.temporalPrecision.generation, { value: 6, source: "sample_observation" });
    assert.equal(column.rule.parameters.precision, 6);
    assert.equal(warningFor(plan)?.code, "timestamp_precision_unknown");
    assert.equal(column.rule.source, "sample_inference");
    assert.ok(generateRows(plan).rows.every((row) => /\.\d{6}$/u.test(row.created_at)));

    const fallback = planFor("timestamp");
    assert.deepEqual(columnPlan(fallback).temporalPrecision.generation, { value: 3, source: "schema_seed_fallback" });
    assert.ok(generateRows(fallback).rows.every((row) => /\.\d{3}$/u.test(row.checked_at)));
  });

  it("keeps one non-blocking unknown-precision warning for an explicit timestamp range", () => {
    const schema = schemaFor("timestamp", { state: "unavailable" }, "range_at");
    const plan = buildGenerationPlan(schema, {
      rowCount: 4,
      seed: "explicit-range-unknown-precision",
      rules: {
        range_at: {
          kind: "timestamp_range",
          start: "2024-01-01 00:00:00.000",
          end: "2024-01-02 00:00:00.000",
        },
      },
    });
    const warnings = plan.diagnostics.filter((entry) => entry.code === "timestamp_precision_unknown");
    assert.equal(warnings.length, 1, "the rule validator warning is not duplicated by Plan validation");
    assert.equal(warnings[0].blocking, false);
    assert.equal(warnings[0].severity, "warning");
    assert.equal(warnings[0].rule, "rule:timestamp_range");
    assert.deepEqual(columnPlan(plan).temporalPrecision.generation, { value: 3, source: "schema_seed_fallback" });
    assert.equal(columnPlan(plan).rule.parameters.precision, 3);
  });

  it("resolves authorized, target-scoped MySQL metadata after dialect discovery", async () => {
    const calls = [];
    const metadata = await resolveDbxTemporalMetadata(dataApiHost((_request, index) => index === 1
      ? discoveryResult()
      : metadataResult(), calls), context, schemaFor("timestamp"));

    assert.deepEqual(metadata, {
      checked_at: {
        state: "known",
        value: 6,
        source: "system_metadata",
        provenance: "DBX Host Data API 1.4 MySQL information_schema.COLUMNS.DATETIME_PRECISION",
      },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((request) => [request.connectionId, request.database, request.maxRows, request.timeoutMs]), [
      [context.connectionId, context.database, 1, TEMPORAL_METADATA_TIMEOUT_MS],
      [context.connectionId, context.database, TEMPORAL_METADATA_MAX_ROWS, TEMPORAL_METADATA_TIMEOUT_MS],
    ]);
    assert.match(calls[0].sql, /^SELECT 1 AS ss_temporal_precision_probe$/u);
    assert.match(calls[1].sql, /FROM information_schema\.COLUMNS/u);
    assert.match(calls[1].sql, /TABLE_SCHEMA = 'bilibili'/u);
    assert.match(calls[1].sql, /TABLE_NAME = 'coupon_claims'/u);
    assert.match(calls[1].sql, /COLUMN_NAME IN \('checked_at'\)/u);
    assert.match(calls[1].sql, /DATETIME_PRECISION/u);
    assert.match(calls[1].sql, /LIMIT 8$/u);
    assert.equal(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/iu.test(calls[1].sql), false);

    const plan = buildGenerationPlan(schemaFor("timestamp"), {
      rowCount: 5,
      seed: "system-metadata",
      temporalPrecisionMetadata: metadata,
      sampleEvidence: [{
        column: "checked_at",
        kind: "temporal_range",
        temporalKind: "timestamp",
        sampleCount: 4,
        nullCount: 0,
        nullRate: 0,
        observedCount: 4,
        observedMin: "2024-01-01 00:00:00.123",
        observedMax: "2024-01-02 00:00:00.123",
        precision: 3,
        timezoneAware: false,
      }],
    });
    assert.equal(columnPlan(plan).schema.precision.state, "unknown");
    assert.equal(columnPlan(plan).temporalPrecision.declaration.source, "system_metadata");
    assert.deepEqual(columnPlan(plan).temporalPrecision.generation, { value: 6, source: "system_metadata" });
    assert.equal(columnPlan(plan).rule.parameters.precision, 6);
    assert.equal(warningFor(plan), undefined);

    const zeroMetadata = await resolveDbxTemporalMetadata(dataApiHost((_request, index) => index === 1
      ? discoveryResult()
      : metadataResult({ columnType: "timestamp", precision: 0 })), context, schemaFor("timestamp"));
    assert.equal(zeroMetadata.checked_at.value, 0);
  });

  it("uses precision zero reported by MySQL system metadata for unqualified DATETIME", async () => {
    const metadata = await resolveDbxTemporalMetadata(dataApiHost((_request, index) => index === 1
      ? discoveryResult()
      : metadataResult({ dataType: "datetime", columnType: "datetime", precision: 0 })), context, schemaFor("datetime"));
    assert.equal(metadata.checked_at.value, 0);
    assert.equal(metadata.checked_at.source, "system_metadata");

    const plan = buildGenerationPlan(schemaFor("datetime"), {
      rowCount: 4,
      seed: "mysql-datetime-zero-precision",
      temporalPrecisionMetadata: metadata,
    });
    assert.equal(columnPlan(plan).temporalPrecision.declaration.source, "system_metadata");
    assert.deepEqual(columnPlan(plan).temporalPrecision.generation, { value: 0, source: "system_metadata" });
    assert.equal(warningFor(plan), undefined);
    assert.ok(generateRows(plan).rows.every((row) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(row.checked_at)));
  });

  it("uses target-scoped PostgreSQL catalog precision for unqualified timestamp defaults", async () => {
    const schema = normalizeTableSchema({
      tableIdentity: "dbx:postgres-test",
      columns: [
        { name: "naive_at", dataType: "timestamp without time zone", nullable: false, precision: { state: "unavailable" } },
        { name: "aware_at", dataType: "timestamptz", nullable: false, precision: { state: "unavailable" } },
      ],
    }).schema;
    const postgresContext = { ...context, schema: "public" };
    const calls = [];
    const postgresResult = {
      dbType: "postgres",
      columns: [{ name: "column_name" }, { name: "data_type" }, { name: "datetime_precision" }],
      rows: [
        ["naive_at", "timestamp without time zone", 6],
        ["aware_at", "timestamp with time zone", 6],
      ],
      truncated: false,
    };
    const metadata = await resolveDbxTemporalMetadata(dataApiHost((_request, index) => index === 1
      ? discoveryResult("postgres")
      : postgresResult, calls), postgresContext, schema);

    assert.deepEqual(Object.fromEntries(Object.entries(metadata).map(([name, fact]) => [name, [fact.value, fact.source, fact.provenance]])), {
      naive_at: [6, "system_metadata", "DBX Host Data API 1.4 PostgreSQL information_schema.columns.datetime_precision"],
      aware_at: [6, "system_metadata", "DBX Host Data API 1.4 PostgreSQL information_schema.columns.datetime_precision"],
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].database, context.database);
    assert.equal(calls[1].schema, "public");
    assert.equal(calls[1].maxRows, TEMPORAL_METADATA_MAX_ROWS);
    assert.equal(calls[1].timeoutMs, TEMPORAL_METADATA_TIMEOUT_MS);
    assert.match(calls[1].sql, /^SELECT /u);
    assert.doesNotMatch(calls[1].sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/iu);
    assert.match(calls[1].sql, /FROM information_schema\.columns/u);
    assert.match(calls[1].sql, /table_catalog = 'bilibili'/u);
    assert.match(calls[1].sql, /table_schema = 'public'/u);
    assert.match(calls[1].sql, /table_name = 'coupon_claims'/u);
    assert.match(calls[1].sql, /datetime_precision/u);
    assert.match(calls[1].sql, /LIMIT 8$/u);
    assert.deepEqual(buildPostgresTemporalMetadataQuery(postgresContext, schema.columns)?.columnTypes, {
      naive_at: "timestamp without time zone",
      aware_at: "timestamp with time zone",
    });
    assert.equal(buildPostgresTemporalMetadataQuery({ ...postgresContext, schema: "public' OR 1=1 --" }, schema.columns), null);

    const plan = buildGenerationPlan(schema, { rowCount: 5, seed: "postgres-system-metadata", temporalPrecisionMetadata: metadata });
    assert.ok(plan.columns.every((column) => column.schema.precision.state === "unavailable"));
    assert.deepEqual(plan.columns.map((column) => column.temporalPrecision.generation), [
      { value: 6, source: "system_metadata" },
      { value: 6, source: "system_metadata" },
    ]);
    assert.equal(plan.diagnostics.some((entry) => entry.code === "timestamp_precision_unknown"), false);
    const rows = generateRows(plan).rows;
    assert.ok(rows.every((row) => /\.\d{6}$/u.test(row.naive_at)));
    assert.ok(rows.every((row) => /\.\d{6}Z$/u.test(row.aware_at)));

    const mismatchedType = await resolveDbxTemporalMetadata(dataApiHost((_request, index) => index === 1
      ? discoveryResult("postgres")
      : { ...postgresResult, rows: [["naive_at", "time without time zone", 6]] }), postgresContext, schema);
    assert.deepEqual(mismatchedType, {}, "a catalog row for another type cannot become temporal precision");
  });

  it("does not query when structured or declared precision is already sufficient", async () => {
    let calls = 0;
    const host = dataApiHost(async () => { calls += 1; throw new Error("should not query"); });
    assert.deepEqual(await resolveDbxTemporalMetadata(host, context, schemaFor("timestamp(6)")), {});
    assert.deepEqual(await resolveDbxTemporalMetadata(host, context, schemaFor("timestamp", { state: "known", value: 0 })), {});
    assert.equal(calls, 0);
  });

  it("uses differing sample precision only as observed output format for the same unknown schema", () => {
    const schema = schemaFor("timestamp", { state: "unavailable" });
    const profile = (precision) => ({
      column: "checked_at",
      kind: "temporal_range",
      temporalKind: "timestamp",
      sampleCount: 4,
      nullCount: 0,
      nullRate: 0,
      observedCount: 4,
      observedMin: precision === 0 ? "2024-01-01 00:00:00" : "2024-01-01 00:00:00.123456",
      observedMax: precision === 0 ? "2024-01-02 00:00:00" : "2024-01-02 00:00:00.654321",
      precision,
      timezoneAware: false,
    });

    for (const precision of [0, 6]) {
      const options = { rowCount: 6, seed: "same-unknown-schema", sampleEvidence: [profile(precision)] };
      const plan = buildGenerationPlan(schema, options);
      const column = columnPlan(plan);
      assert.equal(column.temporalPrecision.declaration.state, "unknown");
      assert.deepEqual(column.temporalPrecision.generation, { value: precision, source: "sample_observation" });
      assert.equal(warningFor(plan)?.blocking, false, "a sample never proves the declared precision");
      const first = generateRows(plan).rows;
      const replay = generateRows(buildGenerationPlan(schema, options)).rows;
      assert.deepEqual(first, replay, "same schema/sample/seed remains deterministic");
      assert.ok(first.every((row) => precision === 0 ? !/\.\d/u.test(row.checked_at) : /\.\d{6}$/u.test(row.checked_at)));
    }
  });

  it("fails closed for missing Data API, unsafe names, ambiguous scope, and unknown dialects", async () => {
    let calls = 0;
    const host = dataApiHost((_request) => { calls += 1; return discoveryResult("postgres"); });
    assert.deepEqual(await resolveDbxTemporalMetadata({ capabilities: { dataApi: false }, queryData: host.queryData }, context, schemaFor("timestamp")), {});
    assert.deepEqual(await resolveDbxTemporalMetadata(host, { ...context, schema: "public" }, schemaFor("timestamp")), {});
    assert.deepEqual(await resolveDbxTemporalMetadata(host, context, schemaFor("timestamp", undefined, "checked_at; DROP TABLE x")), {});
    assert.deepEqual(await resolveDbxTemporalMetadata(host, context, schemaFor("timestamp")), {});
    assert.equal(calls, 3, "scoped PostgreSQL may query its catalog; missing schema falls back after discovery, and MySQL SQL is never sent blindly");

    assert.equal(buildMySqlTemporalMetadataQuery({ ...context, table: "coupon_claims' OR 1=1 --" }, [{ name: "checked_at", dataType: { state: "known", value: "timestamp" } }]), null);
    assert.equal(buildMySqlTemporalMetadataQuery({ ...context, database: "bilibili\\\\evil" }, [{ name: "checked_at", dataType: { state: "known", value: "timestamp" } }]), null);
  });

  it("falls back safely on consent denial, query errors, timeout, and missing capability", async () => {
    const deniedCalls = [];
    const denied = await resolveDbxTemporalMetadata(dataApiHost(async () => {
      throw new Error("PLUGIN_DATA_ACCESS_NOT_GRANTED: sensitive host detail");
    }, deniedCalls), context, schemaFor("timestamp"));
    assert.deepEqual(denied, {});
    assert.equal(deniedCalls.length, 1);

    const queryFailure = await resolveDbxTemporalMetadata(dataApiHost((_request, index) => {
      if (index === 1) return discoveryResult();
      throw new Error("information_schema rejected");
    }), context, schemaFor("timestamp"));
    assert.deepEqual(queryFailure, {});

    const timeoutCalls = [];
    const timeout = await resolveDbxTemporalMetadata(dataApiHost(() => new Promise(() => {}), timeoutCalls), context, schemaFor("timestamp"), { timeoutMs: 1 });
    assert.deepEqual(timeout, {});
    assert.equal(timeoutCalls.length, 1);
    assert.equal(timeoutCalls[0].timeoutMs, 1);

    assert.deepEqual(await resolveDbxTemporalMetadata({}, context, schemaFor("timestamp")), {});
    const noMethod = { capabilities: { dataApi: true } };
    assert.deepEqual(await resolveDbxTemporalMetadata(noMethod, context, schemaFor("timestamp")), {});
  });

  it("rejects malformed, truncated, wrong-type, and out-of-range system results", async () => {
    const malformed = [
      metadataResult({ dbType: "postgres" }),
      metadataResult({ dataType: "datetime", columnType: "datetime(6)" }),
      metadataResult({ columnType: "timestamp(10)", precision: 10 }),
      metadataResult({ precision: null }),
      metadataResult({ truncated: true }),
      { ...metadataResult(), columns: [{ name: "wrong" }] },
    ];
    for (const result of malformed) {
      let index = 0;
      const metadata = await resolveDbxTemporalMetadata(dataApiHost(() => {
        index += 1;
        return index === 1 ? discoveryResult() : result;
      }), context, schemaFor("timestamp"));
      assert.deepEqual(metadata, {}, JSON.stringify(result));
    }
  });

  it("caps multi-column metadata requests and returns only bounded precision summaries", async () => {
    const manyColumns = {
      tableIdentity: "dbx:many-temporals",
      columns: Array.from({ length: 10 }, (_unused, index) => ({
        name: `checked_${index}`,
        dataType: { state: "known", value: "timestamp" },
        precision: { state: "unknown" },
      })),
    };
    const query = buildMySqlTemporalMetadataQuery(context, manyColumns.columns.slice(0, TEMPORAL_METADATA_MAX_ROWS));
    assert.ok(query);
    assert.equal(Object.keys(query.columnTypes).length, TEMPORAL_METADATA_MAX_ROWS);
    assert.match(query.sql, /LIMIT 8$/u);
    assert.equal(query.sql.includes("checked_8"), false);
    assert.equal(query.sql.includes("checked_7"), true);

    const calls = [];
    const resultColumns = ["column_name", "data_type", "column_type", "datetime_precision"].map((name) => ({ name }));
    const rows = manyColumns.columns.slice(0, TEMPORAL_METADATA_MAX_ROWS)
      .map((column) => [column.name, "timestamp", "timestamp(0)", 0]);
    const metadata = await resolveDbxTemporalMetadata(dataApiHost((_request, index) => index === 1
      ? discoveryResult()
      : { dbType: "mysql", columns: resultColumns, rows, truncated: false }, calls), context, manyColumns);
    assert.equal(Object.keys(metadata).length, TEMPORAL_METADATA_MAX_ROWS);
    assert.ok(Object.values(metadata).every((entry) => entry.value === 0));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].maxRows, TEMPORAL_METADATA_MAX_ROWS);
    assert.equal(calls[1].sql.includes("checked_8"), false);
  });
});
