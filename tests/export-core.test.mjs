import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportCsv } from "../src/export/csv-exporter.mjs";
import { createExportDataset, createExportFilename, ExportError } from "../src/export/export-dataset.mjs";
import { exportJson } from "../src/export/json-exporter.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { FixtureSchemaMetadataProvider } from "../src/providers/fixture-schema-metadata-provider.mjs";

const provider = new FixtureSchemaMetadataProvider();

function dataset(columns, rows, tableIdentity = "fixture_table") {
  return {
    tableIdentity,
    columns,
    rows,
    generationContext: {
      seed: "test-seed",
      locale: "zh-CN",
      rowCount: rows.length,
      determinismProfile: "sha256-addressed-v1",
    },
  };
}

function assertExportError(action, code) {
  assert.throws(action, (error) => error instanceof ExportError && error.code === code);
}

describe("Deterministic Export Core", () => {
  it("exports all required fixture families as CSV and JSON", async () => {
    for (const fixture of ["simple_customer", "financial_transaction", "person_basic", "person_partial"]) {
      const schema = await provider.getTableMetadata({ tableIdentity: fixture });
      const plan = buildGenerationPlan(schema, { seed: "fixture-export", rowCount: 4, locale: "zh-CN" });
      const generated = generateRows(plan);
      const exported = createExportDataset(plan, generated);
      const csv = exportCsv(exported);
      const json = exportJson(exported);
      const jsonRows = JSON.parse(json);

      assert.equal(generated.status === "blocked", false, fixture);
      assert.ok(csv.startsWith(exported.columns.join(",")), fixture);
      assert.equal(jsonRows.length, 4, fixture);
      assert.deepEqual(Object.keys(jsonRows[0]), exported.columns, fixture);
    }
  });

  it("uses explicit column order and RFC-style comma, quote, newline, CR and CRLF escaping", () => {
    const value = dataset(["last", "first", "quote", "lf", "cr", "crlf"], [{
      first: "a,b",
      last: "hello",
      quote: 'say "hi"',
      lf: "multi\nline",
      cr: "carriage\rreturn",
      crlf: "both\r\nlines",
    }]);
    const csv = exportCsv(value);

    assert.equal(csv, 'last,first,quote,lf,cr,crlf\r\nhello,"a,b","say ""hi""","multi\nline","carriage\rreturn","both\r\nlines"');
    assert.equal(exportCsv(value, { header: false }), 'hello,"a,b","say ""hi""","multi\nline","carriage\rreturn","both\r\nlines"');
  });

  it("keeps CSV header order and generated row order explicit", () => {
    const value = dataset(["second", "first"], [
      { first: "row 1", second: 1 },
      { first: "row 2", second: 2 },
    ]);
    assert.equal(exportCsv(value), "second,first\r\n1,row 1\r\n2,row 2");
  });

  it("preserves UTF-8 text, scalar CSV forms, empty NULL fields, and configurable nullToken", () => {
    const value = dataset(["chinese", "emoji", "integer", "decimal", "boolean", "date", "timestamp", "missing"], [{
      chinese: "安全合成数据",
      emoji: "你好🙂",
      integer: 42,
      decimal: "9007199254740993.123456789",
      boolean: false,
      date: "2025-03-04",
      timestamp: "2025-03-04T12:34:56.123Z",
      missing: null,
    }]);
    const csv = exportCsv(value, { bom: true });

    assert.equal(Buffer.from(csv, "utf8").subarray(0, 3).toString("hex"), "efbbbf");
    assert.ok(csv.includes("安全合成数据,你好🙂,42,9007199254740993.123456789,false,2025-03-04,2025-03-04T12:34:56.123Z,"));
    assert.ok(exportCsv(value, { nullToken: "<NULL>" }).endsWith(",<NULL>"));
  });

  it("applies the explicit spreadsheet-safe prefix to formula-leading strings only", () => {
    const value = dataset(["equal", "plus", "minus", "at", "negativeNumber"], [{
      equal: "=SUM(A1:A2)",
      plus: "+1",
      minus: "-1",
      at: "@cmd",
      negativeNumber: -1,
    }]);
    const originalRows = structuredClone(value.rows);
    const safeCsv = exportCsv(value, { mode: "spreadsheet_safe" });
    const rawCsv = exportCsv(value, { mode: "raw" });

    assert.equal(safeCsv, "equal,plus,minus,at,negativeNumber\r\n'=SUM(A1:A2),'+1,'-1,'@cmd,-1");
    assert.ok(rawCsv.endsWith("=SUM(A1:A2),+1,-1,@cmd,-1"));
    assert.deepEqual(value.rows, originalRows);
    assert.deepEqual(JSON.parse(exportJson(value)), originalRows);
  });

  it("preserves JSON types, exact decimal strings, UTF-8, and declared field order", () => {
    const value = dataset(["last", "first", "decimal", "nullable", "enabled", "count", "date", "timestamp"], [{
      first: "中文🙂",
      last: "value",
      decimal: "12345678901234567890.0001",
      nullable: null,
      enabled: true,
      count: 7,
      date: "2025-03-04",
      timestamp: "2025-03-04T12:34:56Z",
    }]);
    const content = exportJson(value);
    const parsed = JSON.parse(content);

    assert.match(content, /\n    "last": "value",\n    "first": "中文🙂",/);
    assert.equal(content.startsWith("\uFEFF"), false);
    assert.equal(parsed[0].decimal, "12345678901234567890.0001");
    assert.equal(typeof parsed[0].decimal, "string");
    assert.equal(parsed[0].nullable, null);
    assert.equal(parsed[0].enabled, true);
    assert.equal(parsed[0].count, 7);
    assert.equal(parsed[0].date, "2025-03-04");
    assert.equal(parsed[0].timestamp, "2025-03-04T12:34:56Z");
    assert.equal(exportJson(value, { pretty: false }), JSON.stringify(value.rows, value.columns));
  });

  it("produces deterministic CSV and JSON bytes for the same dataset and options", () => {
    const value = dataset(["name", "amount"], [{ name: "客户🙂", amount: "0.10" }]);
    const csv = exportCsv(value, { bom: true, mode: "spreadsheet_safe" });
    const json = exportJson(value, { pretty: true });

    assert.deepEqual(Buffer.from(exportCsv(value, { bom: true, mode: "spreadsheet_safe" }), "utf8"), Buffer.from(csv, "utf8"));
    assert.deepEqual(Buffer.from(exportJson(value, { pretty: true }), "utf8"), Buffer.from(json, "utf8"));
  });

  it("creates safe deterministic basenames from hostile table identities", () => {
    const filename = createExportFilename('../folder\\evil:C*?"<>|表名', 20, "csv");
    assert.equal(filename, "schemaseed-folder-evil-C-表名-20rows.csv");
    assert.equal(/[\\/:*?"<>|]/.test(filename), false);
    assert.equal(filename.includes(".."), false);
    assert.equal(createExportFilename("!!!", 1, "json"), "schemaseed-table-1rows.json");
  });

  it("fails explicitly for absent datasets, blocked plans, invalid columns, row shape, and unsafe values", () => {
    assertExportError(() => exportCsv(null), "export_no_dataset");
    const blockedPlan = {
      status: "blocked",
      table: { tableIdentity: "blocked", columns: [{ name: "id" }] },
      columns: [{ schema: { name: "id" } }],
      rowCount: 1,
    };
    assertExportError(() => createExportDataset(blockedPlan, { status: "blocked", rows: [] }), "export_blocked_plan");
    assertExportError(() => exportJson(dataset(["id", "id"], [{ id: 1 }])), "export_invalid_columns");
    assertExportError(() => exportCsv(dataset(["a", "b"], [{ c: 1 }])), "export_row_shape_mismatch");
    assertExportError(() => exportJson(dataset(["value"], [{ value: { exact: "no" } }])), "export_serialization_failed");
  });
});
