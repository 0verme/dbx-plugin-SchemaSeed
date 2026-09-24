import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const contribution = manifest.contributions?.find((entry) => entry.id === "io.github.0verme.schema-seed.table-context-probe");
const generationWorkbenchId = "io.github.0verme.schema-seed.generation-workbench";
const generationAction = manifest.contributions?.find((entry) => entry.id === "io.github.0verme.schema-seed.generate-test-data");

assert.equal(manifest.manifest_version, 1);
assert.equal(manifest.engines.host_api, "^1.3");
assert.equal(manifest.engines.dbx, ">=0.6.19", "do not guess a future DBX release number");
assert.deepEqual(manifest.permissions, ["host.schema:read"]);
assert.equal(manifest.entrypoints.backend.transport, "stdio-jsonl");
assert.deepEqual(manifest.entrypoints.ui, { root: "ui", entry: "ui/index.html" });
assert.equal(contribution?.type, "context-menu");
assert.equal(contribution?.menu, "table");
assert.equal(manifest.entrypoints.backend.executable, "bin/universal/schema-seed-runtime");
assert.equal(manifest.contributions.filter((entry) => entry.type === "workbench").length, 2);
assert.ok(manifest.contributions.some((entry) => entry.type === "workbench" && entry.id === "io.github.0verme.schema-seed.schema-metadata-probe"));
assert.ok(manifest.contributions.some((entry) => entry.type === "workbench" && entry.id === generationWorkbenchId));
assert.equal(generationAction?.type, "context-menu");
assert.equal(generationAction?.menu, "table");
assert.deepEqual(generationAction?.action, { type: "open-workbench", workbench: generationWorkbenchId });
assert.equal(packageJson.scripts.workbench, "node scripts/workbench.mjs");

const implementationFiles = [
  "src/table-context.mjs",
  "src/probe-state.mjs",
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
  "src/generation/generation-rules.mjs",
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
  "src/workbench/dbx-generation-workbench-controller.mjs",
  "src/workbench/workbench-view-model.mjs",
  "src/generation/generation-runtime-contract.mjs",
  "src/generation/generation-runtime-protocol.mjs",
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

const productionProviderFiles = ["src/providers/dbx-host-schema-metadata-provider.mjs"];
const forbiddenProductionProvider = /information_schema|pg_catalog|SHOW\s+(?:COLUMNS|CREATE\s+TABLE)|PRAGMA\s+table_info|connectionString|credential|password|username|private\s+store|private\s+frontend|new\s+(?:Pool|Client|Connection)\b|createConnection\s*\(|@tauri|tauri::|fetch\s*\(|window\.dbxPlugin|FixtureSchemaMetadataProvider/i;
for (const relative of productionProviderFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  assert.equal(forbiddenProductionProvider.test(source), false, `${relative} crosses the public Host adapter boundary`);
}

const probeBoundaryFiles = ["src/host/dbx-schema-metadata-probe.mjs", "ui/probe-app.mjs"];
const forbiddenProbeAccess = /information_schema|pg_catalog|\bSHOW\s+(?:COLUMNS|CREATE\s+TABLE)|\bPRAGMA\s+table_info|connectionString|@tauri|tauri::|fetch\s*\(/i;
for (const relative of probeBoundaryFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  assert.equal(forbiddenProbeAccess.test(source), false, `${relative} crosses the public Host API boundary`);
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    assert.ok(specifier.startsWith(".") || specifier.startsWith("node:"), `${relative} imports a private or external dependency: ${specifier}`);
  }
}

console.log("SchemaSeed package, public metadata probe, fixture-only Core, and standalone Workbench boundaries verified");
