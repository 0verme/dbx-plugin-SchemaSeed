import assert from "node:assert/strict";
import { test } from "node:test";
import { createGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-adapter.mjs";

const context = { connectionId: "connection-A", database: "sales", schema: "public", table: "customer" };
const schemaMetadata = {
  columns: [
    { name: "customer_id", dataType: "integer", nullable: false },
    { name: "display_name", dataType: "varchar", nullable: false, length: 24 },
  ],
  fieldCapabilities: { length: "supported", precision: "supported", scale: "supported", default: "supported" },
};

function hostStub() {
  let invokeCalls = 0;
  return {
    api: {
      capabilities: { schemaMetadataApi: true, dataApi: false },
      getTableMetadata: async () => schemaMetadata,
      invoke: async () => {
        invokeCalls += 1;
        throw new Error("A generation backend invoke must not be used");
      },
    },
    invokeCalls: () => invokeCalls,
  };
}

test("Workbench preview executes the shared Generation Core locally without Host invoke", async () => {
  const host = hostStub();
  const controller = createGenerationWorkbenchController(host.api);
  let view = await controller.setContext(context);

  assert.equal(view.status, "idle");
  assert.deepEqual(view.preview.rows, []);
  assert.deepEqual(view.preview.columns, ["customer_id", "display_name"]);
  assert.equal(view.export.enabled, false);
  view = await controller.dispatch({ type: "generate" });
  assert.ok(["ready", "warning"].includes(view.status));
  assert.equal(view.preview.rows.length, 50);
  assert.equal(view.export.enabled, true);
  assert.equal(view.sampleUsed, false, "unavailable Data API keeps generation metadata-only");
  assert.equal(host.invokeCalls(), 0);
});

test("opening the Workbench without table context shows the empty-state guidance", async () => {
  const host = hostStub();
  const controller = createGenerationWorkbenchController(host.api);
  const view = await controller.setContext(null);

  assert.equal(view.status, "empty");
  assert.deepEqual(view.diagnostics, []);
  assert.equal(view.preview.rows.length, 0);
  assert.equal(host.invokeCalls(), 0);
});
