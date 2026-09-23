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

const coreFiles = [
  "src/diagnostics.mjs",
  "src/schema/schema-model.mjs",
  "src/schema/schema-interpreter.mjs",
  "src/schema/schema-metadata-provider.mjs",
  "src/generation/generation-plan.mjs",
  "src/generation/generation-engine.mjs",
  "src/generation/person-synthetic.mjs",
  "src/semantic/semantic-inference.mjs",
  "src/semantic/person-groups.mjs",
  "src/preview/fixture-preview.mjs",
  "src/providers/fixture-schema-metadata-provider.mjs",
];
const forbiddenCoreAccess = /information_schema|pg_catalog|SHOW\s+(?:COLUMNS|CREATE\s+TABLE)|PRAGMA\s+table_info|connectionString|host\.(?:schema|metadata)/i;
const importPattern = /\bfrom\s+["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
for (const relative of coreFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  assert.equal(forbiddenCoreAccess.test(source), false, `${relative} crosses the fixture-only metadata boundary`);
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    assert.ok(specifier.startsWith(".") || specifier.startsWith("node:"), `${relative} imports an external dependency: ${specifier}`);
  }
}

console.log("SchemaSeed contract and fixture-only Core verification passed");
