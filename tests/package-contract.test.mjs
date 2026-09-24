import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("manifest declares the narrow Host API contract and only the Probe Workbench", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const config = await readFile(path.join(root, "dbx-plugin.toml"), "utf8");
  assert.equal(manifest.engines.host_api, "^1.3");
  assert.equal(manifest.icon, "assets/plugin.svg");
  assert.deepEqual(manifest.permissions, ["host.schema:read"]);
  assert.deepEqual(manifest.entrypoints.ui, { root: "ui", entry: "ui/index.html" });
  assert.equal(manifest.entrypoints.backend.transport, "stdio-jsonl");
  assert.equal(manifest.contributions.some((entry) => entry.type === "context-menu" && entry.menu === "table"), true);
  assert.equal(manifest.contributions.some((entry) => entry.type === "workbench" && entry.id === "io.github.0verme.schema-seed.schema-metadata-probe"), true);
  assert.equal(manifest.contributions.filter((entry) => entry.type === "workbench").length, 1);
  assert.equal(manifest.contributions.find((entry) => entry.type === "workbench").icon, manifest.icon);
  assert.match(config, /include\s*=\s*\["backend",\s*"src",\s*"ui",\s*"assets"\]/);
});

test("built DBXP contains the metadata consumer UI and excludes the fixture Workbench", async () => {
  execFileSync(process.execPath, [path.join(root, "scripts/build.mjs")], { cwd: root, stdio: "pipe" });
  const dist = path.join(root, "dist");
  const names = (await (await import("node:fs/promises")).readdir(dist)).filter((name) => name.endsWith(".dbxp"));
  assert.equal(names.length, 1);

  const entries = readStoredZip(await readFile(path.join(dist, names[0])));
  const expected = [
    "manifest.json",
    "assets/plugin.svg",
    "backend/schema-seed-probe.mjs",
    "src/probe-state.mjs",
    "src/probe-protocol.mjs",
    "ui/index.html",
    "ui/app.mjs",
    "ui/probe.css",
    "ui/schema-metadata-probe.mjs",
    "checksums.json",
  ];
  for (const name of expected) assert.equal(entries.has(name), true, `package includes ${name}`);
  assert.equal([...entries.keys()].some((name) => name.startsWith("web/") || name.startsWith("src/workbench/")), false);
  const packagedUi = entries.get("ui/index.html").toString("utf8");
  assert.match(packagedUi, /Raw Host API response/);
  assert.match(packagedUi, /SchemaSeed normalized result/);
  assert.match(packagedUi, /id="raw-host-response"/);
  assert.match(packagedUi, /id="normalized-result"/);

  const packagedManifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  const sourceProbeModule = await readFile(path.join(root, "src/host/dbx-schema-metadata-probe.mjs"));
  assert.deepEqual(entries.get("ui/schema-metadata-probe.mjs"), sourceProbeModule);
  assert.equal(packagedManifest.engines.host_api, "^1.3");
  const referencedIcons = [packagedManifest.icon, ...packagedManifest.contributions.map((entry) => entry.icon).filter(Boolean)];
  for (const iconPath of referencedIcons) {
    assert.equal(entries.has(iconPath), true, `package includes manifest icon ${iconPath}`);
    assert.deepEqual(entries.get(iconPath), await readFile(path.join(root, iconPath)), `packaged icon matches ${iconPath}`);
  }
  assert.deepEqual(packagedManifest.permissions, ["host.schema:read"]);
  assert.equal(packagedManifest.entrypoints.ui.entry, "ui/index.html");
  const checksums = JSON.parse(entries.get("checksums.json").toString("utf8")).files;
  for (const [name, digest] of Object.entries(checksums)) {
    assert.equal(createHash("sha256").update(entries.get(name)).digest("hex"), digest, `checksum for ${name}`);
  }
  assert.equal(checksums["ui/schema-metadata-probe.mjs"], createHash("sha256").update(entries.get("ui/schema-metadata-probe.mjs")).digest("hex"));
});
