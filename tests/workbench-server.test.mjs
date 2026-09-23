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

    const notFound = await fetch(`${baseUrl}/unexpected`);
    assert.equal(notFound.status, 404);
  });
});
