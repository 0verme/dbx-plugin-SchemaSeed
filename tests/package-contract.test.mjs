import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKBENCH_ID = "io.github.0verme.schema-seed.generation-workbench";
const TABLE_ACTION_ID = "io.github.0verme.schema-seed.generate-test-data";

function readStoredZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(end, -1, "dbxp is a ZIP package");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "valid central directory entry");
    const method = buffer.readUInt16LE(offset + 10);
    assert.equal(method, 0, "package uses the supported stored-entry format");
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, buffer.subarray(dataOffset, dataOffset + compressedSize));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("manifest declares the production Workbench and #10244 table action contract", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const config = await readFile(path.join(root, "dbx-plugin.toml"), "utf8");
  assert.equal(manifest.engines.host_api, "^1.3");
  assert.equal(manifest.engines.dbx, ">=0.6.19", "do not guess an unpublished DBX release floor");
  assert.equal(manifest.icon, "assets/plugin.svg");
  assert.deepEqual(manifest.permissions, ["host.schema:read"]);
  assert.deepEqual(manifest.entrypoints.ui, { root: "ui", entry: "ui/index.html" });
  assert.equal(manifest.entrypoints.backend.executable, "bin/universal/schema-seed-runtime");

  const workbenches = manifest.contributions.filter((entry) => entry.type === "workbench");
  assert.equal(workbenches.some((entry) => entry.id === "io.github.0verme.schema-seed.schema-metadata-probe"), true);
  assert.equal(workbenches.some((entry) => entry.id === WORKBENCH_ID), true);
  const generationWorkbench = workbenches.find((entry) => entry.id === WORKBENCH_ID);
  assert.equal(generationWorkbench.icon, manifest.icon);

  const action = manifest.contributions.find((entry) => entry.id === TABLE_ACTION_ID);
  assert.equal(action.type, "context-menu");
  assert.equal(action.menu, "table");
  assert.equal(action.label, "生成测试数据");
  assert.deepEqual(action.action, { type: "open-workbench", workbench: WORKBENCH_ID });
  assert.equal(manifest.contributions.some((entry) => entry.type === "context-menu" && entry.id.endsWith("table-context-probe")), true);

  const router = await readFile(path.join(root, "ui/app.mjs"), "utf8");
  assert.match(router, new RegExp(WORKBENCH_ID.replaceAll(".", "\\.")));
  assert.match(router, /dbx-plugin-init/);
  const productionApp = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
  assert.match(productionApp, /DbxHostSchemaMetadataProvider/);
  assert.match(productionApp, /onContext/);
  assert.doesNotMatch(productionApp, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider/);
  assert.match(config, /src\/workbench\/dbx-generation-workbench-controller\.mjs/);
  assert.doesNotMatch(config, /^\s+"(?:fixtures|web|tests|src\/providers\/fixture|src\/workbench\/workbench-controller)/m);
});

test("built DBXP contains production runtime/UI and Phase 0 Probe, but excludes fixture/dev resources", async () => {
  execFileSync(process.execPath, [path.join(root, "scripts/build.mjs")], { cwd: root, stdio: "pipe" });
  const dist = path.join(root, "dist");
  const names = (await (await import("node:fs/promises")).readdir(dist)).filter((name) => name.endsWith(".dbxp"));
  assert.equal(names.length, 1);

  const entries = readStoredZip(await readFile(path.join(dist, names[0])));
  const expected = [
    "manifest.json",
    "assets/plugin.svg",
    "backend/schema-seed-runtime.mjs",
    "src/diagnostics.mjs",
    "src/export/export-dataset.mjs",
    "src/generation/generation-engine.mjs",
    "src/generation/generation-plan.mjs",
    "src/generation/generation-runtime-contract.mjs",
    "src/generation/generation-runtime-protocol.mjs",
    "src/host/dbx-schema-metadata-probe.mjs",
    "src/probe-protocol.mjs",
    "src/providers/dbx-host-schema-metadata-provider.mjs",
    "src/workbench/dbx-generation-workbench-controller.mjs",
    "src/workbench/workbench-view-model.mjs",
    "ui/index.html",
    "ui/app.mjs",
    "ui/probe-app.mjs",
    "ui/generation-workbench/app.mjs",
    "ui/generation-workbench/styles.css",
    "ui/schema-metadata-probe.mjs",
    "checksums.json",
  ];
  for (const name of expected) assert.equal(entries.has(name), true, `package includes ${name}`);

  for (const name of entries.keys()) {
    assert.equal(/^(?:fixtures|web|tests)\//.test(name), false, `package excludes dev path ${name}`);
    assert.equal(/fixture-schema-metadata-provider|fixture-preview/.test(name), false, `package excludes fixture module ${name}`);
    assert.notEqual(name, "src/workbench/workbench-controller.mjs");
    assert.notEqual(name, "src/workbench/workbench-server.mjs");
    assert.notEqual(name, "backend/schema-seed-probe.mjs");
  }

  const packagedManifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  const packagedAction = packagedManifest.contributions.find((entry) => entry.id === TABLE_ACTION_ID);
  assert.deepEqual(packagedAction.action, { type: "open-workbench", workbench: WORKBENCH_ID });
  assert.equal(packagedManifest.contributions.some((entry) => entry.id === packagedAction.action.workbench), true);
  assert.equal(packagedManifest.engines.dbx, ">=0.6.19");
  assert.equal(packagedManifest.entrypoints.backend.executable, "bin/universal/schema-seed-runtime");
  assert.match(entries.get("ui/index.html").toString("utf8"), /generation-workbench\/styles\.css/);
  assert.match(entries.get("backend/schema-seed-runtime.mjs").toString("utf8"), /generation-runtime-protocol/);
  assert.match(entries.get("src/generation/generation-runtime-protocol.mjs").toString("utf8"), /generation\/preview/);

  const referencedIcons = [packagedManifest.icon, ...packagedManifest.contributions.map((entry) => entry.icon).filter(Boolean)];
  for (const iconPath of referencedIcons) {
    assert.equal(entries.has(iconPath), true, `package includes manifest icon ${iconPath}`);
    assert.deepEqual(entries.get(iconPath), await readFile(path.join(root, iconPath)), `packaged icon matches ${iconPath}`);
  }
  assert.deepEqual(packagedManifest.permissions, ["host.schema:read"]);
  assert.equal(packagedManifest.entrypoints.ui.entry, "ui/index.html");
  const checksums = JSON.parse(entries.get("checksums.json").toString("utf8")).files;
  for (const [name, digest] of Object.entries(checksums)) {
    assert.deepEqual(createHash("sha256").update(entries.get(name)).digest("hex"), digest, `checksum for ${name}`);
  }
});
