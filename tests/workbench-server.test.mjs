import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createWorkbenchServer } from "../src/workbench/workbench-server.mjs";

const server = createWorkbenchServer({ controllerOptions: { seedFactory: () => "new-server-seed" } });
let baseUrl;

const listening = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
});

after(async () => {
  if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("Standalone Workbench HTTP harness", () => {
  it("serves the native UI assets and fixture-backed state", async () => {
    await listening;
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /SchemaSeed Workbench/);

    const script = await fetch(`${baseUrl}/app.mjs`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /api\/state/);

    const stateResponse = await fetch(`${baseUrl}/api/state`);
    const state = await stateResponse.json();
    assert.equal(stateResponse.status, 200);
    assert.equal(state.selectedFixture, "simple_customer");
    assert.equal(state.preview.rows.length, 20);
    assert.equal(state.export.enabled, true);

    const csvResponse = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "csv" }),
    });
    const csv = await csvResponse.json();
    assert.equal(csvResponse.status, 200);
    assert.equal(csv.filename, "schemaseed-simple_customer-20rows.csv");
    assert.equal(csv.mimeType, "text/csv;charset=utf-8");
    assert.ok(csv.content.startsWith("\uFEFFcustomer_id,name,age"));
    assert.equal(csv.summary.spreadsheetSafe, true);

    const jsonResponse = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "json" }),
    });
    const json = await jsonResponse.json();
    assert.equal(jsonResponse.status, 200);
    assert.equal(json.mimeType, "application/json;charset=utf-8");
    assert.deepEqual(JSON.parse(json.content), state.preview.rows);
  });

  it("dispatches actions through WorkbenchController and rejects unknown paths", async () => {
    await listening;
    const response = await fetch(`${baseUrl}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "new-seed" }),
    });
    const state = await response.json();
    assert.equal(response.status, 200);
    assert.equal(state.controls.seed, "new-server-seed");

    const choosePerson = await fetch(`${baseUrl}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "select-fixture", fixture: "person_basic" }),
    });
    assert.equal(choosePerson.status, 200);
    const blockPlan = await fetch(`${baseUrl}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "set-mapping", column: "birthday", semanticType: "email" }),
    });
    assert.equal((await blockPlan.json()).status, "blocked");
    const blockedExport = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "csv" }),
    });
    const blocked = await blockedExport.json();
    assert.equal(blockedExport.status, 409);
    assert.equal(blocked.code, "export_blocked_plan");

    const notFound = await fetch(`${baseUrl}/unexpected`);
    assert.equal(notFound.status, 404);
  });
});
