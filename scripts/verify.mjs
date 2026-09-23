import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const contribution = manifest.contributions?.find((entry) => entry.id === "io.github.0verme.schema-seed.table-context-probe");

assert.equal(manifest.manifest_version, 1);
assert.equal(manifest.engines.host_api, "^1.0");
assert.deepEqual(manifest.permissions, []);
assert.equal(manifest.entrypoints.backend.transport, "stdio-jsonl");
assert.equal(contribution?.type, "context-menu");
assert.equal(contribution?.menu, "table");
assert.ok(manifest.entrypoints.backend.executable);
assert.equal(manifest.entrypoints.workbench, undefined, "The standalone harness must not be presented as DBX-packaged UI");
assert.equal(packageJson.scripts.workbench, "node scripts/workbench.mjs");

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
  "src/export/export-dataset.mjs",
  "src/export/csv-exporter.mjs",
  "src/export/json-exporter.mjs",
  "src/providers/fixture-schema-metadata-provider.mjs",
  "src/workbench/workbench-controller.mjs",
  "src/workbench/workbench-server.mjs",
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

const uiFiles = ["web/app.mjs", "web/render.mjs"];
const forbiddenUiAccess = /host\.(?:schema|metadata)|schemaMetadataApi|information_schema|pg_catalog|SHOW\s+(?:COLUMNS|CREATE\s+TABLE)|PRAGMA\s+table_info|connectionString|credential|password|username/i;
for (const relative of uiFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  assert.equal(forbiddenUiAccess.test(source), false, `${relative} crosses the fixture-only boundary`);
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    assert.ok(specifier.startsWith("."), `${relative} imports a runtime dependency: ${specifier}`);
  }
}

console.log("SchemaSeed package, fixture-only Core, and standalone Workbench boundaries verified");
