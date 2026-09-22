import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const contribution = manifest.contributions?.find((entry) => entry.id === "io.github.0verme.schema-seed.table-context-probe");

assert.equal(manifest.manifest_version, 1);
assert.equal(manifest.engines.host_api, "^1.0");
assert.deepEqual(manifest.permissions, []);
assert.equal(manifest.entrypoints.backend.transport, "stdio-jsonl");
assert.equal(contribution?.type, "context-menu");
assert.equal(contribution?.menu, "table");
assert.ok(manifest.entrypoints.backend.executable);

const implementationFiles = [
  "src/table-context.mjs",
  "src/probe-protocol.mjs",
  "backend/schema-seed-probe.mjs",
];
const forbidden = /information_schema|pg_catalog|SHOW\s+(?:COLUMNS|CREATE\s+TABLE)|PRAGMA\s+table_info|connectionString|credential|password|username/i;
for (const relative of implementationFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  assert.equal(forbidden.test(source), false, `${relative} crosses the metadata/credential boundary`);
}

console.log("SchemaSeed contract verification passed");
