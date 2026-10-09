import assert from "node:assert/strict";
import { test } from "node:test";
import { exportCsv } from "../src/export/csv-exporter.mjs";
import { exportJson } from "../src/export/json-exporter.mjs";
import { executeGenerationPreview } from "../src/generation/generation-runtime.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import {
  DEFAULT_GENERATION_ROW_COUNT,
  MAX_GENERATION_ROW_COUNT,
  MIN_GENERATION_ROW_COUNT,
} from "../src/generation/row-count.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";
import { paginatePreviewRows } from "../src/workbench/preview-pagination.mjs";

const schema = normalizeTableSchema({
  tableIdentity: "capacity_test",
  columns: [
    { name: "id", dataType: "integer", nullable: false },
    { name: "label", dataType: "varchar", nullable: false, length: 32 },
  ],
}).schema;
const rules = {
  id: { kind: "sequence", start: 1, step: 1 },
  label: { kind: "random_string", length: 8 },
};

function buildPreview(rowCount, seed = "capacity-seed") {
  return executeGenerationPreview(schema, {
    rowCount,
    seed,
    locale: "en",
    mode: "safe_synthetic",
    rules,
  });
}

test("shared row-count constants define the new minimum, default, and maximum", () => {
  assert.equal(MIN_GENERATION_ROW_COUNT, 1);
  assert.equal(DEFAULT_GENERATION_ROW_COUNT, 50);
  assert.equal(MAX_GENERATION_ROW_COUNT, 1_000);
});

test("GenerationPlan and runtime generate exactly 1, 50, 100, and 1000 rows", () => {
  for (const rowCount of [1, 50, 100, 1_000]) {
    const { plan, generated } = buildPreview(rowCount);
    assert.equal(plan.status, "ready", `${rowCount} row plan is valid`);
    assert.equal(plan.rowCount, rowCount);
    assert.equal(generated.status, "ready");
    assert.equal(generated.rows.length, rowCount);
    assert.equal(new Set(generated.rows.map(({ id }) => id)).size, rowCount, "explicit sequence IDs stay unique");
  }
});

test("zero, negative, fractional, and over-limit row counts are rejected without truncation", () => {
  for (const rowCount of [0, -1, 1.5, 1_001]) {
    const plan = buildGenerationPlan(schema, { rowCount, seed: "invalid-count", rules });
    assert.equal(plan.status, "blocked", `GenerationPlan blocks ${rowCount}`);
    assert.ok(plan.diagnostics.some(({ code }) => code === "invalid_row_count"));
    assert.deepEqual(generateRows(plan).rows, []);
    assert.throws(() => buildPreview(rowCount), RangeError, `runtime rejects ${rowCount}`);
  }
});

test("generation engine refuses a forged ready plan beyond the shared row limit", () => {
  const plan = buildGenerationPlan(schema, { rowCount: 1, seed: "forged", rules });
  const generated = generateRows({ ...plan, rowCount: 1_001 });
  assert.equal(generated.status, "blocked");
  assert.deepEqual(generated.rows, []);
  assert.ok(generated.diagnostics.some(({ code }) => code === "invalid_row_count"));
});

test("DBX Workbench keeps the 50-row default and all 1000 rows in preview and exports", async () => {
  let nextSeed = "different-seed";
  const controller = new DbxGenerationWorkbenchController({
    provider: { getTableMetadata: async () => schema },
    preview: executeGenerationPreview,
    seedFactory: () => nextSeed,
  });
  const context = { connectionId: "test-connection", database: "test_db", schema: "public", table: "capacity_test" };
  let view = await controller.setContext(context);
  assert.equal(view.controls.rowCount, DEFAULT_GENERATION_ROW_COUNT);
  assert.equal(view.preview.rows.length, DEFAULT_GENERATION_ROW_COUNT);

  await controller.dispatch({ type: "update-rule", column: "id", rule: rules.id });
  await controller.dispatch({ type: "update-rule", column: "label", rule: rules.label });
  view = await controller.dispatch({ type: "update-controls", controls: { rowCount: 1_000, seed: "capacity-seed", locale: "en" } });
  assert.equal(view.plan.rowCount, 1_000);
  assert.equal(view.preview.rows.length, 1_000);
  assert.equal(new Set(view.preview.rows.map(({ id }) => id)).size, 1_000);

  const csv = controller.prepareExport("csv");
  const json = controller.prepareExport("json");
  const sql = controller.prepareExport("sql");
  assert.equal(csv.summary.rowCount, 1_000);
  assert.equal(csv.content.replace(/^\uFEFF/u, "").split("\r\n").length - 1, 1_000);
  assert.equal(JSON.parse(json.content).length, 1_000);
  assert.deepEqual(JSON.parse(json.content), view.preview.rows, "JSON exports the complete current preview dataset");
  assert.equal((sql.content.match(/INSERT INTO/g) ?? []).length, 1_000);
  assert.match(sql.content, /-- Rows: 1000/u);

  const sameSeed = await controller.dispatch({ type: "regenerate-same-seed" });
  assert.deepEqual(sameSeed.preview.rows, view.preview.rows);
  nextSeed = "new-capacity-seed";
  const changedSeed = await controller.dispatch({ type: "new-seed" });
  assert.notDeepEqual(changedSeed.preview.rows, sameSeed.preview.rows);
  assert.equal(changedSeed.preview.rows.length, 1_000);
  assert.deepEqual(JSON.parse(controller.prepareExport("json").content), changedSeed.preview.rows);
});

test("invalid Workbench input keeps the previous row count and reports explicit validation", async () => {
  const controller = new DbxGenerationWorkbenchController({
    provider: { getTableMetadata: async () => schema },
    preview: executeGenerationPreview,
  });
  await controller.setContext({ connectionId: "test-connection", table: "capacity_test" });
  for (const rowCount of [0, -1, 1.5, 1_001]) {
    const view = await controller.dispatch({ type: "update-controls", controls: { rowCount } });
    assert.equal(view.controls.rowCount, 50);
    assert.match(view.actionError, /1 to 1000/u);
  }
});

test("preview pagination displays slices without modifying the complete generated dataset", () => {
  const rows = Array.from({ length: 1_000 }, (_value, index) => ({ id: index + 1 }));
  const first = paginatePreviewRows(rows, 0);
  const last = paginatePreviewRows(rows, 99);
  assert.equal(first.pageCount, 20);
  assert.equal(first.rows.length, 50);
  assert.equal(first.startRow, 1);
  assert.equal(first.endRow, 50);
  assert.equal(last.page, 19, "out-of-range pages are clamped to the last page");
  assert.equal(last.startRow, 951);
  assert.equal(last.endRow, 1_000);
  assert.equal(last.rows.length, 50);
  assert.equal(rows.length, 1_000);
  assert.equal(rows[999].id, 1_000);
});
