import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { DbxHostSchemaMetadataError, DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";
import { settingsSchemaFingerprint } from "../src/workbench/settings-draft.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_CONTEXT = Object.freeze({ connectionId: "connection-A", database: "sales", schema: "public", table: "customer" });

function hostResponse(columns, fieldCapabilities = {
  length: "supported",
  precision: "supported",
  scale: "supported",
  default: "supported",
}) {
  return { columns, fieldCapabilities };
}

function columnsFor(table) {
  if (table === "alpha") return [{ name: "alpha_id", dataType: "integer", nullable: false }];
  if (table === "beta") return [{ name: "beta_id", dataType: "integer", nullable: false }];
  if (table === "gamma") return [{ name: "gamma_id", dataType: "integer", nullable: false }];
  return [
    { name: "customer_id", dataType: "integer", nullable: false },
    { name: "display_name", dataType: "varchar", nullable: false, length: 24 },
  ];
}

function productionProvider({ calls = [], host, capabilities = { schemaMetadataApi: true }, response = hostResponse } = {}) {
  return new DbxHostSchemaMetadataProvider({
    capabilities,
    async getTableMetadata(context) {
      calls.push(structuredClone(context));
      if (host) return host(context);
      return response(columnsFor(context.table));
    },
  });
}

function previewCore(calls = []) {
  return async (schema, options) => {
    calls.push({ schema, options: structuredClone(options) });
    const plan = buildGenerationPlan(schema, options);
    const generated = options.validateOnly
      ? { rows: [], diagnostics: [...plan.diagnostics], status: plan.status }
      : generateRows(plan);
    return JSON.parse(JSON.stringify({ plan, generated }));
  };
}

function generationCalls(calls) {
  return calls.filter((call) => call.options.validateOnly !== true);
}

function createController(options = {}) {
  return new DbxGenerationWorkbenchController({
    provider: options.provider ?? productionProvider(),
    preview: options.preview ?? previewCore(),
    sampleProbe: options.sampleProbe,
    temporalMetadataResolver: options.temporalMetadataResolver,
    seedFactory: options.seedFactory ?? (() => "fresh-seed"),
    translator: options.translator,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function columnsResponse(table) {
  return hostResponse(columnsFor(table));
}

describe("DBX Generation Workbench production controller", () => {
  it("loads TableContext and a validation-only plan on open without sampling or generating rows", async () => {
    const metadataCalls = [];
    const previewCalls = [];
    let sampleCalls = 0;
    const controller = createController({
      provider: productionProvider({ calls: metadataCalls }),
      preview: previewCore(previewCalls),
      sampleProbe: async () => { sampleCalls += 1; return { sampleUsed: true, evidence: [] }; },
    });
    const context = { connectionId: "connection-A", table: "customer", schema: "public" };
    const view = await controller.setContext(context);

    assert.equal(view.status, "idle");
    assert.equal(view.previewState, "EMPTY");
    assert.equal(view.previewAction.action, "generate");
    assert.equal(view.plan.status, "ready_with_warnings", "the inferred display_name mapping remains a Core warning until confirmed");
    assert.deepEqual(metadataCalls, [{ connectionId: "connection-A", schema: "public", table: "customer" }]);
    assert.deepEqual(view.context, context);
    assert.deepEqual(view.table, { database: null, schema: "public", table: "customer" });
    assert.equal(view.plan.rowCount, 50);
    assert.equal(view.controls.seed, "demo");
    assert.equal(view.columns[0].generationRule.kind, "auto");
    assert.ok(view.columns[0].ruleChoices.some((choice) => choice.kind === "sequence"));
    assert.deepEqual(view.preview.rows, []);
    assert.deepEqual(view.preview.columns, ["customer_id", "display_name"]);
    assert.equal(view.export.enabled, false);
    assert.equal(view.sampleUsed, false);
    assert.equal(sampleCalls, 0, "opening a table does not query real sample rows");
    assert.equal(generationCalls(previewCalls).length, 0, "opening a table validates a plan but never calls the Generator");
    assert.ok(previewCalls.every((call) => call.options.validateOnly === true));
    assert.equal(view.columns[0].column, "customer_id");
    assert.equal(view.columns[0].rule.kind, "integer");
    assert.equal(view.ruleEditor.issue, 32);
    assert.equal(Object.hasOwn(metadataCalls[0], "table"), true, "provider receives TableContext itself, not a { table: ... } envelope");
  });

  it("configuration edits invalidate Preview/Export without invoking the Generator", async () => {
    const previewCalls = [];
    let sampleCalls = 0;
    const controller = createController({
      preview: previewCore(previewCalls),
      sampleProbe: async () => { sampleCalls += 1; return { sampleUsed: false, evidence: [] }; },
    });
    let view = await controller.setContext(BASE_CONTEXT);
    assert.equal(generationCalls(previewCalls).length, 0);
    assert.equal(sampleCalls, 0);

    view = await controller.dispatch({ type: "generate" });
    assert.equal(generationCalls(previewCalls).length, 1);
    assert.equal(sampleCalls, 1, "authorized sample inference is deferred until the explicit generation action");
    assert.equal(view.export.enabled, true);
    assert.equal(view.previewState, "READY");
    assert.equal(view.previewAction.action, "generate-new-data");
    assert.deepEqual(view.lastSuccessfulParameters, {
      rowCount: 50, seed: "demo", locale: "zh-CN", rules: {}, constraints: [],
    });
    assert.equal(view.lastSuccessfulParametersCurrent, true);

    const changes = [
      { type: "update-controls", controls: { rowCount: 12 } },
      { type: "update-controls", controls: { locale: "en" } },
      { type: "update-controls", controls: { seed: "manual-seed" } },
      { type: "update-rule", column: "customer_id", rule: { kind: "sequence", start: 5, step: 2 } },
    ];
    for (const action of changes) {
      view = await controller.dispatch(action);
      assert.deepEqual(view.preview.rows, [], `${action.type} clears the previous preview`);
      assert.equal(view.export.enabled, false, `${action.type} disables stale export`);
      assert.equal(view.previewState, "DIRTY");
      assert.equal(view.previewAction.action, "generate", "DIRTY regenerates the edited configuration rather than changing its seed");
      assert.equal(view.lastSuccessfulParametersCurrent, false);
      assert.equal(view.lastSuccessfulParameters.seed, "demo", "the previous generation snapshot is separate from edited controls");
      for (const format of ["csv", "json", "sql"]) {
        assert.throws(() => controller.prepareExport(format), (error) => error.code === "export_no_dataset");
      }
      assert.equal(generationCalls(previewCalls).length, 1, `${action.type} does not invoke the Generator`);
    }
    assert.equal(sampleCalls, 1, "configuration edits reuse the bounded session summary rather than sampling again");

    view = await controller.dispatch({ type: "generate" });
    assert.equal(generationCalls(previewCalls).length, 2);
    assert.equal(view.preview.rows.length, 12);
    assert.equal(view.controls.locale, "en");
    assert.equal(view.controls.seed, "manual-seed");
    assert.equal(view.previewState, "READY");
    assert.equal(view.lastSuccessfulParameters.seed, "manual-seed");
    assert.equal(view.lastSuccessfulParametersCurrent, true);

    const beforeLocaleSwitch = structuredClone(view.preview.rows);
    controller.setTranslator(Object.assign((key) => key, { locale: "en-US" }));
    assert.equal(generationCalls(previewCalls).length, 2, "UI locale changes are presentation-only");
    assert.deepEqual(controller.getViewModel().preview.rows, beforeLocaleSwitch);
  });

  it("coalesces rapid explicit Generate actions into one in-flight task", async () => {
    const pending = deferred();
    const started = deferred();
    const validation = previewCore();
    const calls = [];
    const controller = createController({
      preview: async (schema, options) => {
        if (options.validateOnly) return validation(schema, options);
        calls.push({ schema, options: structuredClone(options) });
        started.resolve();
        return pending.promise;
      },
    });
    await controller.setContext(BASE_CONTEXT);

    const first = controller.dispatch({ type: "generate" });
    const second = controller.dispatch({ type: "generate" });
    await started.promise;
    assert.equal(calls.length, 1);
    assert.equal(controller.getViewModel().status, "loading");
    assert.equal(controller.getViewModel().previewState, "GENERATING");
    assert.equal(controller.getViewModel().previewAction.disabled, true);
    assert.equal(controller.getViewModel().previewAction.busy, true);
    const generated = await previewCore()(calls[0].schema, calls[0].options);
    const newBatchWhileBusy = await controller.dispatch({ type: "generate-new-data" });
    const repeatedNewBatchWhileBusy = await controller.dispatch({ type: "generate-new-data" });
    assert.equal(newBatchWhileBusy.controls.seed, "demo", "a new-batch action cannot mutate the seed during an in-flight generation");
    assert.equal(repeatedNewBatchWhileBusy.controls.seed, "demo", "repeated new-batch clicks remain inert while generation is active");
    pending.resolve(generated);
    const [firstView, secondView] = await Promise.all([first, second]);
    assert.equal(calls.length, 1);
    assert.deepEqual(firstView.preview.rows, secondView.preview.rows);
    assert.equal(firstView.export.enabled, true);
  });

  it("drops a late A generation after switching context to B", async () => {
    const pending = deferred();
    const started = deferred();
    const validation = previewCore();
    let alphaSchema;
    let alphaOptions;
    const controller = createController({
      preview: async (schema, options) => {
        if (options.validateOnly) return validation(schema, options);
        if (schema.columns[0].name === "alpha_id") {
          alphaSchema = schema;
          alphaOptions = structuredClone(options);
          started.resolve();
          return pending.promise;
        }
        return validation(schema, options);
      },
    });
    await controller.setContext({ connectionId: "conn-A", database: "db", schema: "s", table: "alpha" });
    const generatingA = controller.dispatch({ type: "generate" });
    await started.promise;

    let view = await controller.setContext({ connectionId: "conn-B", database: "db", schema: "s", table: "beta" });
    assert.equal(view.status, "idle");
    assert.equal(view.context.connectionId, "conn-B");
    assert.equal(view.context.table, "beta");
    assert.deepEqual(view.preview.rows, []);
    assert.deepEqual(view.preview.columns, ["beta_id"]);
    assert.equal(view.export.enabled, false);

    pending.resolve(await previewCore()(alphaSchema, alphaOptions));
    await generatingA;
    view = controller.getViewModel();
    assert.equal(view.context.table, "beta");
    assert.deepEqual(view.preview.rows, []);
    assert.deepEqual(view.preview.columns, ["beta_id"]);
    assert.equal(view.export.enabled, false);
  });

  it("does not reuse a same-named table preview across different connections", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    let view = await controller.setContext({ connectionId: "conn-A", database: "db", table: "orders" });
    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.preview.rows.length, 50);
    assert.equal(generationCalls(calls).length, 1);

    view = await controller.setContext({ connectionId: "conn-B", database: "db", table: "orders" });
    assert.equal(view.context.connectionId, "conn-B");
    assert.equal(view.context.table, "orders");
    assert.equal(view.status, "idle");
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);
    assert.equal(generationCalls(calls).length, 1);
  });

  it("clears the generated snapshot and returns to EMPTY when the table context is lost", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    await controller.setContext(BASE_CONTEXT);
    let view = await controller.dispatch({ type: "generate" });
    assert.equal(view.previewState, "READY");
    assert.equal(view.lastSuccessfulParametersCurrent, true);

    view = await controller.setContext({});
    assert.equal(view.status, "empty");
    assert.equal(view.previewState, "EMPTY");
    assert.equal(view.previewAction.disabled, true);
    assert.equal(view.lastSuccessfulParameters, null);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);
    assert.equal(generationCalls(calls).length, 1, "losing context never auto-generates");
  });

  it("clears failed generation output and permits an explicit retry", async () => {
    const calls = [];
    const actualPreview = previewCore(calls);
    let generationAttempts = 0;
    const controller = createController({
      preview: async (schema, options) => {
        if (options.validateOnly) return actualPreview(schema, options);
        generationAttempts += 1;
        if (generationAttempts === 1) throw new Error("temporary generator failure");
        return actualPreview(schema, options);
      },
    });
    await controller.setContext(BASE_CONTEXT);
    let view = await controller.dispatch({ type: "update-controls", controls: { rowCount: 7, seed: "manual-retry-seed" } });
    assert.equal(view.status, "dirty");
    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "error");
    assert.equal(view.previewState, "ERROR");
    assert.equal(view.previewAction.action, "generate");
    assert.equal(view.previewAction.labelKey, "actions.retryGeneration");
    assert.match(view.error, /temporary generator failure/u);
    assert.equal(view.controls.rowCount, 7);
    assert.equal(view.controls.seed, "manual-retry-seed");
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);
    assert.equal(view.lastSuccessfulParametersCurrent, false);
    for (const format of ["csv", "json", "sql"]) {
      assert.throws(() => controller.prepareExport(format), (error) => error.code === "export_no_dataset");
    }

    view = await controller.dispatch({ type: view.previewAction.action });
    assert.equal(view.preview.rows.length, 7);
    assert.equal(view.controls.seed, "manual-retry-seed", "retry does not replace a manually entered seed");
    assert.equal(generationAttempts, 2);
    assert.equal(view.export.enabled, true);
    assert.equal(view.previewState, "READY");
    assert.equal(view.error, null, "a successful retry clears the prior error");
    assert.equal(view.lastSuccessfulParametersCurrent, true);
  });

  it("invalidates context, metadata, plan and preview for A → B → C table switches", async () => {
    const calls = [];
    const controller = createController({ provider: productionProvider({ calls }) });
    let view = await controller.setContext({ connectionId: "conn", table: "alpha" });
    assert.deepEqual(view.preview.columns, ["alpha_id"]);
    assert.deepEqual(view.preview.rows, []);
    view = await controller.dispatch({ type: "generate" });
    assert.ok(view.preview.rows.every((row) => Object.hasOwn(row, "alpha_id")));

    const switchingToB = controller.setContext({ connectionId: "conn", database: "db", table: "beta" });
    view = controller.getViewModel();
    assert.equal(view.status, "loading");
    assert.equal(view.plan, null);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(controller.schema, null, "table A metadata is invalidated immediately");
    assert.equal(view.export.enabled, false, "table A preview cannot be exported as table B");
    view = await switchingToB;
    assert.equal(view.status, "idle");
    assert.equal(view.previewState, "EMPTY");
    assert.equal(view.lastSuccessfulParameters, null);
    assert.deepEqual(view.preview.columns, ["beta_id"]);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.context.table, "beta");
    assert.equal(view.export.enabled, false);
    view = await controller.dispatch({ type: "generate" });
    assert.ok(view.preview.rows.every((row) => Object.hasOwn(row, "beta_id")));

    view = await controller.setContext({ connectionId: "conn", database: "db", schema: "s3", table: "gamma" });
    assert.deepEqual(view.preview.columns, ["gamma_id"]);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.context.table, "gamma");
    assert.deepEqual(calls.map((call) => call.table), ["alpha", "beta", "gamma"]);
  });

  it("ignores late metadata responses so a stale A/B request cannot replace C", async () => {
    const pending = new Map();
    const calls = [];
    const provider = {
      getTableMetadata({ tableContext }) {
        calls.push(tableContext.table);
        const request = deferred();
        pending.set(tableContext.table, request);
        return request.promise;
      },
    };
    const controller = createController({ provider });
    const a = controller.setContext({ connectionId: "conn", table: "alpha" });
    const b = controller.setContext({ connectionId: "conn", table: "beta" });
    const c = controller.setContext({ connectionId: "conn", table: "gamma" });
    assert.deepEqual(calls, ["alpha", "beta", "gamma"]);

    pending.get("gamma").resolve(normalizeTableSchema({
      tableIdentity: "gamma-schema",
      columns: [{ name: "gamma_id", dataType: "integer", nullable: false }],
    }).schema);
    let view = await c;
    assert.deepEqual(view.preview.columns, ["gamma_id"]);
    pending.get("beta").resolve(normalizeTableSchema({
      tableIdentity: "beta-schema",
      columns: [{ name: "beta_id", dataType: "integer", nullable: false }],
    }).schema);
    pending.get("alpha").resolve(normalizeTableSchema({
      tableIdentity: "alpha-schema",
      columns: [{ name: "alpha_id", dataType: "integer", nullable: false }],
    }).schema);
    await Promise.all([a, b]);
    view = controller.getViewModel();
    assert.equal(view.context.table, "gamma");
    assert.deepEqual(view.preview.columns, ["gamma_id"]);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.status, "idle");
  });

  it("replays the same seed, generates a different batch immediately, and exports only the current snapshot", async () => {
    const previewCalls = [];
    const controller = createController({ preview: previewCore(previewCalls) });
    let view = await controller.setContext(BASE_CONTEXT);
    assert.equal(generationCalls(previewCalls).length, 0);
    assert.throws(() => controller.prepareExport("json"), (error) => error.code === "export_no_dataset");

    view = await controller.dispatch({ type: "generate" });
    const firstRows = structuredClone(view.preview.rows);
    const firstDataset = controller.currentDataset;
    const generationCount = generationCalls(previewCalls).length;
    const sameSeed = await controller.dispatch({ type: "generate" });
    assert.equal(sameSeed.controls.seed, "demo");
    assert.equal(sameSeed.previewAction.state, "READY");
    assert.equal(sameSeed.previewAction.action, "generate-new-data");
    assert.deepEqual(sameSeed.preview.rows, firstRows);
    assert.equal(generationCalls(previewCalls).length, generationCount + 1);

    const callsBeforeExport = previewCalls.length;
    const datasetBeforeExport = controller.currentDataset;
    const csv = controller.prepareExport("csv");
    const json = controller.prepareExport("json");
    assert.equal(previewCalls.length, callsBeforeExport, "export never calls Core generation");
    assert.equal(controller.currentDataset, datasetBeforeExport, "exports retain the current dataset snapshot");
    assert.ok(csv.content.startsWith("\uFEFFcustomer_id,display_name"));
    assert.deepEqual(JSON.parse(json.content), sameSeed.preview.rows);
    assert.equal(csv.summary.rowCount, sameSeed.preview.rows.length);
    assert.equal(firstDataset.rows.length, 50);

    view = await controller.dispatch({ type: sameSeed.previewAction.action });
    assert.equal(view.controls.seed, "fresh-seed");
    assert.equal(view.preview.rows.length, 50);
    assert.equal(view.export.enabled, true);
    assert.equal(generationCalls(previewCalls).length, generationCount + 2, "Generate New Data immediately runs the Generator");
    assert.notDeepEqual(view.preview.rows, firstRows);
    assert.deepEqual(JSON.parse(controller.prepareExport("json").content), view.preview.rows);
  });

  it("caches temporal metadata per Workbench session and uses one dataset for Preview and all exports", async () => {
    const temporalCalls = [];
    const previewCalls = [];
    const provider = {
      async getTableMetadata() {
        return normalizeTableSchema({
          tableIdentity: "dbx:temporal-export",
          columns: [{
            name: "created_at",
            dataType: "timestamp",
            nullable: false,
            precision: { state: "unknown", reason: "Host did not return structured precision" },
          }],
        }).schema;
      },
    };
    const temporalPrecisionMetadata = {
      created_at: {
        state: "known",
        value: 0,
        source: "system_metadata",
        provenance: "DBX Host Data API 1.4 MySQL information_schema.COLUMNS.DATETIME_PRECISION",
      },
    };
    const controller = createController({
      provider,
      preview: previewCore(previewCalls),
    });
    controller.temporalMetadataResolver = async (request) => {
      temporalCalls.push(request.context);
      return temporalPrecisionMetadata;
    };

    let view = await controller.setContext({ connectionId: "connection-A", database: "sales", table: "events" });
    assert.equal(temporalCalls.length, 1);
    assert.equal(view.status, "idle");
    assert.equal(view.columns[0].temporalPrecision.declaration.source, "system_metadata");
    assert.deepEqual(view.columns[0].temporalPrecision.generation, { value: 0, source: "system_metadata" });
    assert.equal(view.diagnostics.some((entry) => entry.code === "timestamp_precision_unknown"), false);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(previewCalls.at(-1).options.temporalPrecisionMetadata.created_at.value, 0);

    view = await controller.dispatch({ type: "generate" });
    assert.ok(view.preview.rows.every((row) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(row.created_at)));
    const same = await controller.dispatch({ type: "generate" });
    assert.deepEqual(same.preview.rows, view.preview.rows);
    assert.equal(temporalCalls.length, 1, "changing generation actions does not repeat metadata lookup");
    const firstDataset = controller.currentDataset;
    const previewCallCount = previewCalls.length;
    const csv = controller.prepareExport("csv");
    const json = controller.prepareExport("json");
    const sql = controller.prepareExport("sql");
    assert.equal(previewCalls.length, previewCallCount, "exports never regenerate a dataset");
    assert.equal(controller.currentDataset, firstDataset, "all formats use the current ExportDataset snapshot");
    assert.deepEqual(JSON.parse(json.content), same.preview.rows);
    assert.ok(csv.content.includes("created_at"));
    assert.match(sql.content, /INSERT INTO/u);
    assert.match(sql.content, /'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'/u);
  });

  it("invalidates Preview/Export on rule edits, validates through Core, and Generate uses the current rules", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "generate" });
    const before = view.preview.rows;
    assert.equal(view.columns[0].ruleChoices.some((choice) => choice.kind === "sequence"), true);

    view = await controller.dispatch({
      type: "update-rule",
      column: "customer_id",
      rule: { kind: "sequence", start: 40, step: 2 },
    });
    assert.equal(view.status, "dirty");
    assert.equal(view.ruleEditor.state, "dirty");
    assert.equal(view.export.enabled, false);
    assert.deepEqual(view.preview.rows, []);
    assert.notDeepEqual(view.preview.rows, before);
    assert.equal(calls.at(-1).options.validateOnly, true);
    assert.deepEqual(calls.at(-1).options.rules.customer_id, { kind: "sequence", start: 40, step: 2 });
    assert.equal(Object.hasOwn(view.columns[0].generationRule, "identity"), false, "editor values stay within the tagged config contract");
    view = await controller.dispatch({
      type: "update-rule",
      column: "customer_id",
      rule: { ...view.columns[0].generationRule, step: 3 },
    });
    assert.equal(view.status, "dirty");
    assert.deepEqual(calls.at(-1).options.rules.customer_id, { kind: "sequence", start: 40, step: 3 });
    assert.throws(() => controller.prepareExport("json"), (error) => error.code === "export_no_dataset");

    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "warning", "the unrelated inferred display_name candidate retains its Core warning");
    assert.deepEqual(view.preview.rows.map((row) => row.customer_id), Array.from({ length: 50 }, (_v, index) => 40 + index * 3));
    assert.deepEqual(view.lastSuccessfulParameters.rules.customer_id, { kind: "sequence", start: 40, step: 3 });
    assert.equal(view.lastSuccessfulParametersCurrent, true);
    const generated = structuredClone(view.preview.rows);
    const exported = JSON.parse(controller.prepareExport("json").content);
    assert.deepEqual(exported, generated);
    view = await controller.dispatch({ type: "generate" });
    assert.deepEqual(view.preview.rows, generated);
  });

  it("validates enum candidates through Core and uses the current rule for Generate, Preview and Export", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    await controller.setContext(BASE_CONTEXT);
    let view = await controller.dispatch({
      type: "update-rule",
      column: "customer_id",
      rule: { kind: "enum", values: [] },
    });
    assert.equal(view.status, "blocked");
    assert.equal(view.export.enabled, false);
    assert.ok(view.diagnostics.some((entry) => entry.code === "generation_rule_invalid"));
    assert.throws(() => controller.prepareExport("json"), (error) => error.code === "export_blocked_plan");

    view = await controller.dispatch({
      type: "update-rule",
      column: "customer_id",
      rule: { kind: "enum", values: [11, 17, 23] },
    });
    assert.equal(view.status, "dirty");
    assert.equal(calls.at(-1).options.validateOnly, true);
    assert.deepEqual(calls.at(-1).options.rules.customer_id, { kind: "enum", values: [11, 17, 23] });
    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "warning");
    assert.ok(view.preview.rows.every((row) => [11, 17, 23].includes(row.customer_id)));
    assert.deepEqual(JSON.parse(controller.prepareExport("json").content), view.preview.rows);
    const generated = structuredClone(view.preview.rows);
    view = await controller.dispatch({ type: "generate" });
    assert.deepEqual(view.preview.rows, generated);
  });

  it("keeps invalid rule diagnostics visible and blocks Generate/Export without falling back", async () => {
    const controller = createController();
    await controller.setContext(BASE_CONTEXT);
    const view = await controller.dispatch({
      type: "update-rule",
      column: "customer_id",
      rule: { kind: "random_integer", min: 0, max: Number.MAX_SAFE_INTEGER },
    });
    assert.equal(view.status, "blocked");
    assert.equal(view.ruleEditor.state, "blocked");
    assert.equal(view.export.enabled, false);
    assert.deepEqual(view.preview.rows, []);
    assert.ok(view.diagnostics.some((entry) => entry.code === "generation_rule_incompatible"));
    assert.equal(view.columns[0].generationRule.kind, "random_integer");
    assert.throws(() => controller.prepareExport("csv"), (error) => error.code === "export_blocked_plan");
  });

  it("adds, edits, and deletes manual constraints through validation-only Core calls", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "add-constraint", kind: "unique" });
    assert.equal(view.status, "dirty");
    assert.equal(view.constraints.length, 1);
    assert.equal(view.constraintPlan.constraints[0].kind, "unique");
    assert.deepEqual(calls.at(-1).options.constraints, [{ id: "manual-1", kind: "unique", column: "customer_id" }]);
    assert.equal(calls.at(-1).options.validateOnly, true);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);

    view = await controller.dispatch({ type: "update-constraint", constraint: {
      id: "manual-1", kind: "composite_unique", columns: ["display_name", "customer_id"],
    } });
    assert.equal(view.status, "dirty");
    assert.deepEqual(view.constraints[0].columns, ["display_name", "customer_id"]);
    assert.deepEqual(view.constraintPlan.constraints[0].columns, ["display_name", "customer_id"]);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);

    view = await controller.dispatch({ type: "update-constraint", constraint: {
      id: "manual-1", kind: "composite_unique", columns: ["customer_id"],
    } });
    assert.equal(view.status, "blocked");
    assert.ok(view.diagnostics.some((entry) => entry.code === "invalid_constraint_config"));
    assert.equal(view.export.enabled, false);
    assert.deepEqual(view.preview.rows, []);
    assert.throws(() => controller.prepareExport("json"), (error) => error.code === "export_blocked_plan");

    view = await controller.dispatch({ type: "update-constraint", constraint: {
      id: "manual-1", kind: "composite_unique", columns: ["customer_id", "display_name"],
    } });
    assert.equal(view.status, "dirty");
    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "warning");
    assert.equal(view.preview.rows.length, 50);
    assert.equal(view.export.enabled, true);

    view = await controller.dispatch({ type: "delete-constraint", id: "manual-1" });
    assert.deepEqual(view.constraints, []);
    assert.equal(view.status, "dirty");
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);
    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "warning");
    assert.equal(view.preview.rows.length, 50);
    assert.equal(view.export.enabled, true);
  });

  it("saves valid advanced settings atomically, preserves a stale preview, and never auto-generates", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "generate" });
    const originalRows = structuredClone(view.preview.rows);
    const originalGenerationCount = generationCalls(calls).length;
    const contextKey = JSON.stringify(view.context);

    view = await controller.dispatch({
      type: "save-settings",
      contextKey,
      rules: { customer_id: { kind: "sequence", start: 40, step: 2 } },
      constraints: [],
    });
    assert.equal(view.settingsSaveResult.ok, true);
    assert.equal(view.settingsSaveResult.changed, true);
    assert.equal(view.status, "dirty");
    assert.equal(view.lastSuccessfulParametersCurrent, false);
    assert.deepEqual(view.preview.rows, originalRows, "old rows remain visible for reference");
    assert.equal(view.export.enabled, false, "stale data is never exportable as current");
    assert.throws(() => controller.prepareExport("json"), (error) => error.code === "export_no_dataset");
    assert.equal(generationCalls(calls).length, originalGenerationCount, "saving only runs validation-only Core work");
    assert.equal(calls.at(-1).options.validateOnly, true);
    assert.deepEqual(controller.rules.customer_id, { kind: "sequence", start: 40, step: 2 });

    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "warning");
    assert.equal(view.lastSuccessfulParametersCurrent, true);
    assert.equal(view.preview.rows.length, 50);
    assert.deepEqual(view.preview.rows.map((row) => row.customer_id), Array.from({ length: 50 }, (_value, index) => 40 + index * 2));
    assert.equal(generationCalls(calls).length, originalGenerationCount + 1, "only the explicit Generate action invokes the Generator");
  });

  it("commits an explicit default restore and stales the old preview only after successful Save", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    await controller.setContext(BASE_CONTEXT);
    await controller.dispatch({ type: "update-rule", column: "customer_id", rule: { kind: "sequence", start: 40, step: 2 } });
    await controller.dispatch({ type: "add-constraint", kind: "unique" });
    let view = await controller.dispatch({ type: "generate" });
    const originalRows = structuredClone(view.preview.rows);
    const generationCount = generationCalls(calls).length;

    view = await controller.dispatch({
      type: "save-settings",
      contextKey: JSON.stringify(view.context),
      schemaKey: settingsSchemaFingerprint(controller.schema),
      settingsRevision: controller.settingsRevision,
      rules: {},
      constraints: [],
    });

    assert.equal(view.settingsSaveResult.ok, true);
    assert.equal(view.settingsSaveResult.changed, true);
    assert.deepEqual(controller.rules, {}, "the explicit per-table override is actually removed");
    assert.deepEqual(controller.constraints, [], "manual generation constraints are actually removed");
    assert.equal(view.status, "dirty");
    assert.equal(view.lastSuccessfulParametersCurrent, false);
    assert.deepEqual(view.preview.rows, originalRows, "the immutable old preview remains visible only for reference");
    assert.equal(view.export.enabled, false);
    assert.equal(generationCalls(calls).length, generationCount, "Save validates but never generates replacement rows");
    assert.equal(calls.at(-1).options.validateOnly, true);
  });

  it("validates a restored draft through Core without committing or invalidating the current dataset", async () => {
    const calls = [];
    let sampleCalls = 0;
    const controller = createController({
      preview: previewCore(calls),
      sampleProbe: async () => { sampleCalls += 1; return { sampleUsed: false, evidence: [] }; },
    });
    await controller.setContext(BASE_CONTEXT);
    await controller.dispatch({ type: "update-rule", column: "customer_id", rule: { kind: "sequence", start: 40, step: 2 } });
    await controller.dispatch({ type: "add-constraint", kind: "unique" });
    let view = await controller.dispatch({ type: "generate" });
    const dataset = controller.currentDataset;
    const rows = structuredClone(view.preview.rows);
    const committedRules = structuredClone(controller.rules);
    const committedConstraints = structuredClone(controller.constraints);
    const revision = controller.settingsRevision;
    const generationCount = generationCalls(calls).length;

    const result = await controller.validateSettingsDraft({
      contextKey: JSON.stringify(view.context),
      schemaKey: settingsSchemaFingerprint(controller.schema),
      settingsRevision: revision,
      rules: {},
      constraints: [],
    });
    view = controller.getViewModel();

    assert.equal(result.valid, true);
    assert.ok(result.diagnostics.some((entry) => entry.code === "semantic_confirmation_required"));
    assert.deepEqual(controller.rules, committedRules);
    assert.deepEqual(controller.constraints, committedConstraints);
    assert.equal(controller.currentDataset, dataset);
    assert.deepEqual(view.preview.rows, rows);
    assert.equal(view.export.enabled, true);
    assert.equal(controller.settingsRevision, revision);
    assert.equal(sampleCalls, 1, "draft Core validation reuses evidence and never queries DBX");
    assert.equal(generationCalls(calls).length, generationCount, "validateOnly never generates rows");
    assert.equal(calls.at(-1).options.validateOnly, true);
    assert.deepEqual(calls.at(-1).options.rules, {});
    assert.deepEqual(calls.at(-1).options.constraints, []);
  });

  it("does not invalidate a preview for an explicitly selected Auto rule equivalent to Core defaults", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "generate" });
    const dataset = controller.currentDataset;
    const rowSnapshot = structuredClone(view.preview.rows);
    const revision = controller.settingsRevision;
    const callCount = calls.length;

    view = await controller.dispatch({
      type: "save-settings",
      contextKey: JSON.stringify(view.context),
      schemaKey: settingsSchemaFingerprint(controller.schema),
      settingsRevision: revision,
      rules: { customer_id: { kind: "auto" } },
      constraints: [],
    });

    assert.equal(view.settingsSaveResult.ok, true);
    assert.equal(view.settingsSaveResult.changed, false);
    assert.equal(controller.settingsRevision, revision);
    assert.deepEqual(controller.rules, {});
    assert.equal(controller.currentDataset, dataset);
    assert.deepEqual(view.preview.rows, rowSnapshot);
    assert.equal(view.export.enabled, true);
    assert.equal(calls.length, callCount, "equivalent defaults skip even validation work");
  });

  it("rejects a stale advanced-settings draft after schema or committed settings revisions change", async () => {
    const controller = createController();
    let view = await controller.setContext(BASE_CONTEXT);
    const contextKey = JSON.stringify(view.context);
    const schemaKey = settingsSchemaFingerprint(controller.schema);
    const revision = controller.settingsRevision;

    const changedSchema = normalizeTableSchema({
      tableIdentity: controller.schema.tableIdentity,
      columns: [
        { name: "customer_id", dataType: "integer", nullable: false },
        { name: "display_name", dataType: "varchar", nullable: false, length: 25 },
      ],
    }).schema;
    controller.schema = changedSchema;
    view = await controller.dispatch({
      type: "save-settings", contextKey, schemaKey, settingsRevision: revision,
      rules: { customer_id: { kind: "sequence", start: 3, step: 2 } }, constraints: [],
    });
    assert.match(view.actionError, /schema changed/u);
    assert.deepEqual(controller.rules, {});

    await controller.setContext(BASE_CONTEXT, { force: true });
    const currentView = controller.getViewModel();
    const staleRevision = controller.settingsRevision;
    await controller.dispatch({ type: "update-rule", column: "customer_id", rule: { kind: "sequence", start: 5, step: 2 } });
    view = await controller.dispatch({
      type: "save-settings",
      contextKey: JSON.stringify(currentView.context),
      schemaKey: settingsSchemaFingerprint(controller.schema),
      settingsRevision: staleRevision,
      rules: {},
      constraints: [],
    });
    assert.match(view.actionError, /settings changed/u);
    assert.deepEqual(controller.rules.customer_id, { kind: "sequence", start: 5, step: 2 });
  });

  it("ignores an in-flight old-settings generation that completes after settings are saved", async () => {
    const generationResult = deferred();
    const generationStarted = deferred();
    let deferNextGeneration = false;
    let pendingOptions;
    const core = previewCore();
    const controller = createController({
      preview: async (schema, options) => {
        if (!options.validateOnly && deferNextGeneration) {
          deferNextGeneration = false;
          pendingOptions = structuredClone(options);
          generationStarted.resolve();
          return generationResult.promise;
        }
        return core(schema, options);
      },
    });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "generate" });
    const originalRows = structuredClone(view.preview.rows);
    deferNextGeneration = true;
    const generationTask = controller.dispatch({ type: "generate" });
    await generationStarted.promise;

    await controller.saveSettings({
      type: "save-settings",
      contextKey: JSON.stringify(view.context),
      rules: { customer_id: { kind: "sequence", start: 80, step: 2 } },
      constraints: [],
    });
    view = controller.getViewModel();
    assert.equal(view.status, "dirty");
    generationResult.resolve(await core(controller.schema, pendingOptions));
    view = await generationTask;
    assert.equal(view.status, "dirty");
    assert.equal(view.lastSuccessfulParametersCurrent, false);
    assert.deepEqual(view.preview.rows, originalRows);
    assert.equal(view.export.enabled, false);
  });

  it("keeps the old preview visibly stale if regeneration after a settings save fails", async () => {
    let failNextGeneration = false;
    const controller = createController({
      preview: async (schema, options) => {
        if (!options.validateOnly && failNextGeneration) {
          failNextGeneration = false;
          throw new Error("temporary generation failure");
        }
        return previewCore()(schema, options);
      },
    });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "generate" });
    const oldRows = structuredClone(view.preview.rows);
    view = await controller.dispatch({
      type: "save-settings",
      contextKey: JSON.stringify(view.context),
      rules: { customer_id: { kind: "sequence", start: 70, step: 3 } },
      constraints: [],
    });
    assert.equal(view.status, "dirty");
    failNextGeneration = true;

    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "error");
    assert.equal(view.lastSuccessfulParametersCurrent, false);
    assert.deepEqual(view.preview.rows, oldRows, "failure does not erase or certify the previous rows");
    assert.equal(view.export.enabled, false);

    view = await controller.dispatch({ type: "generate" });
    assert.equal(view.status, "warning");
    assert.equal(view.lastSuccessfulParametersCurrent, true);
    assert.notDeepEqual(view.preview.rows, oldRows);
    assert.deepEqual(view.preview.rows.map((row) => row.customer_id), Array.from({ length: 50 }, (_value, index) => 70 + index * 3));
  });

  it("rejects invalid advanced settings without changing effective config or the current preview", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "generate" });
    const originalRows = structuredClone(view.preview.rows);
    const originalDataset = controller.currentDataset;
    const generationCount = generationCalls(calls).length;

    view = await controller.dispatch({
      type: "save-settings",
      contextKey: JSON.stringify(view.context),
      rules: { customer_id: { kind: "random_integer", min: 0, max: Number.MAX_SAFE_INTEGER } },
      constraints: [],
    });
    assert.equal(view.settingsSaveResult.ok, false);
    assert.ok(view.settingsSaveResult.diagnostics.some((entry) => entry.code === "generation_rule_incompatible"));
    assert.deepEqual(controller.rules, {}, "failed draft never replaces the effective configuration");
    assert.equal(controller.currentDataset, originalDataset);
    assert.equal(view.status, "warning");
    assert.deepEqual(view.preview.rows, originalRows);
    assert.equal(view.export.enabled, true);
    assert.equal(generationCalls(calls).length, generationCount, "invalid settings are checked without generation");
  });

  it("does not invalidate a preview when advanced settings are saved without actual changes", async () => {
    const calls = [];
    const controller = createController({ preview: previewCore(calls) });
    let view = await controller.setContext(BASE_CONTEXT);
    view = await controller.dispatch({ type: "generate" });
    const originalRows = structuredClone(view.preview.rows);
    const originalDataset = controller.currentDataset;
    const callCount = calls.length;

    view = await controller.dispatch({
      type: "save-settings",
      contextKey: JSON.stringify(view.context),
      rules: {},
      constraints: [],
    });
    assert.equal(view.settingsSaveResult.ok, true);
    assert.equal(view.settingsSaveResult.changed, false);
    assert.equal(view.status, "warning");
    assert.equal(view.lastSuccessfulParametersCurrent, true);
    assert.deepEqual(view.preview.rows, originalRows);
    assert.equal(controller.currentDataset, originalDataset);
    assert.equal(view.export.enabled, true);
    assert.equal(calls.length, callCount, "an unchanged valid draft needs no extra Core or Generator work");
  });

  it("binds an advanced-settings draft to its originating table context", async () => {
    const controller = createController();
    await controller.setContext({ connectionId: "conn", table: "alpha" });
    const contextKeyA = JSON.stringify(controller.getViewModel().context);
    await controller.setContext({ connectionId: "conn", table: "beta" });

    const view = await controller.dispatch({
      type: "save-settings",
      contextKey: contextKeyA,
      rules: { alpha_id: { kind: "sequence", start: 4, step: 3 } },
      constraints: [],
    });
    assert.match(view.actionError, /table changed/u);
    assert.deepEqual(controller.rules, {});
    assert.equal(view.context.table, "beta");
    assert.equal(view.columns[0].column, "beta_id");
  });

  it("clears table-session rules and constraints on context refresh", async () => {
    const controller = createController();
    await controller.setContext({ connectionId: "conn", table: "alpha" });
    await controller.dispatch({ type: "update-rule", column: "alpha_id", rule: { kind: "sequence", start: 4, step: 3 } });
    await controller.dispatch({ type: "add-constraint", kind: "unique" });
    await controller.dispatch({ type: "generate" });
    assert.equal(controller.rules.alpha_id.kind, "sequence");
    assert.equal(controller.constraints.length, 1);
    const view = await controller.setContext({ connectionId: "conn", table: "beta" });
    assert.deepEqual(controller.rules, {});
    assert.deepEqual(controller.constraints, []);
    assert.equal(view.columns[0].generationRule.kind, "auto");
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);
  });

  it("represents invalid direct context and unavailable metadata as blocked, with provider diagnostics", async () => {
    const controller = createController();
    let view = await controller.setContext({ table: "customer" });
    assert.equal(view.status, "blocked");
    assert.equal(view.diagnostics[0].code, "table_context_invalid");
    assert.equal(view.export.enabled, false);
    assert.throws(() => controller.prepareExport("csv"), (error) => error.code === "export_blocked_plan");

    const unavailable = createController({ provider: productionProvider({ capabilities: { schemaMetadataApi: false } }) });
    view = await unavailable.setContext(BASE_CONTEXT);
    assert.equal(view.status, "blocked");
    assert.equal(view.diagnostics[0].code, "metadata_capability_unavailable");
    assert.match(view.error, /schemaMetadataApi/);
    assert.equal(unavailable.plan, null);
    assert.equal(unavailable.currentDataset, null);
  });

  it("distinguishes Host API failure, Core-blocked plan and Core warning state", async () => {
    const failedProvider = {
      async getTableMetadata() {
        throw new DbxHostSchemaMetadataError({
          severity: "error",
          code: "metadata_request_failed",
          table: "customer",
          column: null,
          rule: "dbx-host-metadata",
          reason: "Host API request failed",
          blocking: true,
        });
      },
    };
    let view = await createController({ provider: failedProvider }).setContext(BASE_CONTEXT);
    assert.equal(view.status, "error");
    assert.equal(view.ruleEditor.state, "error");
    assert.equal(view.diagnostics[0].code, "metadata_request_failed");

    const blockedProvider = productionProvider({
      response: () => hostResponse(
        [{ name: "label", dataType: "varchar", nullable: false }],
        { length: "unsupported", precision: "unsupported", scale: "unsupported", default: "supported" },
      ),
    });
    view = await createController({ provider: blockedProvider }).setContext(BASE_CONTEXT);
    assert.equal(view.status, "blocked");
    assert.equal(view.plan.status, "blocked");
    assert.deepEqual(view.preview.rows, []);
    assert.equal(view.export.enabled, false);

    const warningProvider = {
      async getTableMetadata() {
        return normalizeTableSchema({
          tableIdentity: "warning-schema",
          columns: [{ name: "customer_id", dataType: "integer" }],
        }).schema;
      },
    };
    const warningController = createController({ provider: warningProvider });
    view = await warningController.setContext(BASE_CONTEXT);
    assert.equal(view.status, "idle");
    assert.equal(view.plan.status, "ready_with_warnings");
    assert.deepEqual(view.preview.rows, []);
    view = await warningController.dispatch({ type: "generate" });
    assert.equal(view.status, "warning");
    assert.equal(view.preview.rows.length, 50);
    assert.equal(view.export.enabled, true);
    assert.ok(view.diagnostics.some((diagnostic) => diagnostic.code === "nullability_unknown"));
  });

  it("production controller and runtime RPC remain fixture-free", async () => {
    const source = await readFile(path.join(root, "src/workbench/dbx-generation-workbench-controller.mjs"), "utf8");
    const runtime = await readFile(path.join(root, "src/generation/generation-runtime.mjs"), "utf8");
    const rpc = await readFile(path.join(root, "src/generation/generation-runtime-protocol.mjs"), "utf8");
    assert.doesNotMatch(source, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
    assert.doesNotMatch(runtime, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
    assert.doesNotMatch(rpc, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
  });
});
