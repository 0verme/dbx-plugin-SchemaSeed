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
    const generated = generateRows(plan);
    return JSON.parse(JSON.stringify({ plan, generated }));
  };
}

function createController(options = {}) {
  return new DbxGenerationWorkbenchController({
    provider: options.provider ?? productionProvider(),
    preview: options.preview ?? previewCore(),
    seedFactory: options.seedFactory ?? (() => "fresh-seed"),
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
  it("accepts direct TableContext, preserves optional scope, loads provider schema and previews Core output", async () => {
    const calls = [];
    const controller = createController({ provider: productionProvider({ calls }) });
    const context = { connectionId: "connection-A", table: "customer", schema: "public" };
    const view = await controller.setContext(context);

    assert.equal(view.status, "warning", "the inferred display_name mapping remains a Core warning until confirmed");
    assert.deepEqual(calls, [{ connectionId: "connection-A", schema: "public", table: "customer" }]);
    assert.deepEqual(view.context, context);
    assert.deepEqual(view.table, { database: null, schema: "public", table: "customer" });
    assert.equal(view.plan.rowCount, 20);
    assert.equal(view.preview.rows.length, 20);
    assert.deepEqual(view.preview.columns, ["customer_id", "display_name"]);
    assert.equal(view.export.enabled, true);
    assert.equal(view.columns[0].column, "customer_id");
    assert.equal(view.columns[0].rule.kind, "integer");
    assert.equal(view.ruleEditorSlot.issue, 32);
    assert.equal(Object.hasOwn(calls[0], "table"), true, "provider receives TableContext itself, not a { table: ... } envelope");
  });

  it("invalidates context, metadata, plan and preview for A → B → C table switches", async () => {
    const calls = [];
    const controller = createController({ provider: productionProvider({ calls }) });
    let view = await controller.setContext({ connectionId: "conn", table: "alpha" });
    assert.deepEqual(view.preview.columns, ["alpha_id"]);

    const switchingToB = controller.setContext({ connectionId: "conn", database: "db", table: "beta" });
    view = controller.getViewModel();
    assert.equal(view.status, "loading");
    assert.equal(view.plan, null);
    assert.deepEqual(view.preview.rows, []);
    assert.equal(controller.schema, null, "table A metadata is invalidated immediately");
    assert.equal(view.export.enabled, false, "table A preview cannot be exported as table B");
    view = await switchingToB;
    assert.deepEqual(view.preview.columns, ["beta_id"]);
    assert.equal(view.context.table, "beta");

    view = await controller.setContext({ connectionId: "conn", database: "db", schema: "s3", table: "gamma" });
    assert.deepEqual(view.preview.columns, ["gamma_id"]);
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
    assert.ok(view.preview.rows.every((row) => Object.hasOwn(row, "gamma_id")));
  });

  it("replays the same seed, changes a new seed, and exports only the current preview dataset", async () => {
    const previewCalls = [];
    const controller = createController({ preview: previewCore(previewCalls) });
    let view = await controller.setContext(BASE_CONTEXT);
    const firstRows = structuredClone(view.preview.rows);
    const firstDataset = controller.currentDataset;
    const sameSeed = await controller.dispatch({ type: "regenerate-same-seed" });
    assert.deepEqual(sameSeed.preview.rows, firstRows);

    const callsBeforeExport = previewCalls.length;
    const datasetBeforeExport = controller.currentDataset;
    const csv = controller.prepareExport("csv");
    const json = controller.prepareExport("json");
    assert.equal(previewCalls.length, callsBeforeExport, "export never calls Core generation");
    assert.equal(controller.currentDataset, datasetBeforeExport, "exports retain the current dataset snapshot");
    assert.ok(csv.content.startsWith("\uFEFFcustomer_id,display_name"));
    assert.deepEqual(JSON.parse(json.content), sameSeed.preview.rows);
    assert.equal(csv.summary.rowCount, sameSeed.preview.rows.length);
    assert.equal(firstDataset.rows.length, 20);

    view = await controller.dispatch({ type: "new-seed" });
    assert.equal(view.controls.seed, "fresh-seed");
    assert.notDeepEqual(view.preview.rows, firstRows);
    assert.deepEqual(JSON.parse(controller.prepareExport("json").content), view.preview.rows);
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
    view = await createController({ provider: warningProvider }).setContext(BASE_CONTEXT);
    assert.equal(view.status, "warning");
    assert.equal(view.plan.status, "ready_with_warnings");
    assert.equal(view.preview.rows.length, 20);
    assert.equal(view.export.enabled, true);
    assert.ok(view.diagnostics.some((diagnostic) => diagnostic.code === "nullability_unknown"));
  });

  it("production controller and runtime RPC remain fixture-free", async () => {
    const source = await readFile(path.join(root, "src/workbench/dbx-generation-workbench-controller.mjs"), "utf8");
    const runtime = await readFile(path.join(root, "backend/schema-seed-runtime.mjs"), "utf8");
    const rpc = await readFile(path.join(root, "src/generation/generation-runtime-protocol.mjs"), "utf8");
    assert.doesNotMatch(source, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
    assert.doesNotMatch(runtime, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
    assert.doesNotMatch(rpc, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider|fixtures\/schemas/);
  });
});
