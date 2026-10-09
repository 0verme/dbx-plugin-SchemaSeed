import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const generationWorkbenchId = `${manifest.id}.generation-workbench`;
const generationAction = manifest.contributions?.find((entry) => entry.id === `${manifest.id}.generate-test-data`);
const tableContributions = manifest.contributions?.filter((entry) => entry.type === "context-menu" && entry.menu === "table") ?? [];

assert.equal(manifest.manifest_version, 1);
assert.equal(typeof manifest.id, "string");
assert.notEqual(manifest.id.trim(), "");
assert.equal(typeof manifest.version, "string");
assert.notEqual(manifest.version.trim(), "");
assert.equal(manifest.engines.host_api, "^1.4");
assert.equal(manifest.engines.dbx, ">=0.6.23");
assert.deepEqual(manifest.permissions, ["host.schema:read", "host.data:read"]);
assert.deepEqual(manifest.entrypoints, { ui: { root: "ui", entry: "ui/index.html" } });
assert.equal(tableContributions.length, 1, "the manifest exposes one table context-menu contribution");
assert.equal(tableContributions[0].id, `${manifest.id}.generate-test-data`);
assert.deepEqual(generationAction?.action, { type: "open-workbench", workbench: generationWorkbenchId });
assert.deepEqual(manifest.contributions.filter((entry) => entry.type === "workbench").map((entry) => entry.id), [generationWorkbenchId]);
assert.equal(packageJson.devDependencies["@dbx-app/plugin-cli"], "0.1.9");
assert.equal(packageJson.scripts.workbench, "node scripts/workbench.mjs");

const config = await readFile(path.join(root, "dbx-plugin.toml"), "utf8");
assert.doesNotMatch(config, /^\[backend\]/m);
assert.match(config, /include\s*=\s*\["assets",\s*"ui"\]/);

const coreFiles = [
  "src/diagnostics.mjs",
  "src/schema/schema-model.mjs",
  "src/schema/schema-interpreter.mjs",
  "src/schema/temporal-values.mjs",
  "src/generation/constraint-allocation.mjs",
  "src/generation/constraint-domain.mjs",
  "src/generation/generation-engine.mjs",
  "src/generation/generation-identity.mjs",
  "src/generation/generation-plan.mjs",
  "src/generation/generation-rules.mjs",
  "src/generation/generation-runtime.mjs",
  "src/generation/generation-runtime-protocol.mjs",
  "src/generation/manual-constraints.mjs",
  "src/generation/person-synthetic.mjs",
  "src/generation/sha256.mjs",
  "src/semantic/semantic-inference.mjs",
  "src/semantic/sample-evidence.mjs",
  "src/semantic/person-groups.mjs",
  "src/export/export-dataset.mjs",
  "src/export/csv-exporter.mjs",
  "src/export/json-exporter.mjs",
  "src/export/sql-exporter.mjs",
  "src/workbench/dbx-generation-workbench-adapter.mjs",
  "src/workbench/dbx-generation-workbench-controller.mjs",
  "src/workbench/workbench-view-model.mjs",
];
const forbiddenCoreAccess = /information_schema|pg_catalog|SHOW\s+(?:COLUMNS|CREATE\s+TABLE)|PRAGMA\s+table_info|connectionString|host\.(?:schema|metadata)/i;
const importPattern = /\bfrom\s+["']([^"']+)["']|\bimport\s*(?:\(\s*)?["']([^"']+)["']/g;
for (const relative of coreFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  assert.equal(forbiddenCoreAccess.test(source), false, `${relative} crosses the Core/Host boundary`);
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    assert.ok(specifier.startsWith(".") || specifier.startsWith("node:"), `${relative} imports an external dependency: ${specifier}`);
  }
}

for (const relative of ["ui/app.mjs", "ui/generation-workbench/app.mjs"]) {
  const source = await readFile(path.join(root, relative), "utf8");
  assert.doesNotMatch(source, /host\.invoke/);
}
const productionWorkbench = await readFile(path.join(root, "src/workbench/dbx-generation-workbench-adapter.mjs"), "utf8");
assert.match(productionWorkbench, /preview: executeGenerationPreview/);
assert.match(productionWorkbench, /host\.getTableMetadata/);
assert.match(productionWorkbench, /host\.queryData/);

const provider = await readFile(path.join(root, "src/providers/dbx-host-schema-metadata-provider.mjs"), "utf8");
assert.doesNotMatch(provider, /information_schema|pg_catalog|SHOW\s+(?:COLUMNS|CREATE\s+TABLE)|PRAGMA\s+table_info|connectionString|credential|password|username|private\s+store|private\s+frontend|new\s+(?:Pool|Client|Connection)\b|createConnection\s*\(|@tauri|tauri::|fetch\s*\(|window\.dbxPlugin|FixtureSchemaMetadataProvider/i);

const dataProbe = await readFile(path.join(root, "src/host/dbx-data-sample-probe.mjs"), "utf8");
assert.match(dataProbe, /capabilities\?\.dataApi !== true/);
assert.match(dataProbe, /host\.queryData\(request\)/);
assert.match(dataProbe, /maxRows: DATA_SAMPLE_ROW_LIMIT/);
assert.match(dataProbe, /timeoutMs: requestedTimeout/);
assert.doesNotMatch(dataProbe, /console\.(?:log|debug|info|warn|error)|localStorage|sessionStorage|telemetry|analytics|fetch\s*\(|connectionString|credential|password|jdbc|new\s+(?:Pool|Client|Connection)\b|createConnection\s*\(/i);

console.log("SchemaSeed UI-only manifest, local Generation Core, public Host boundary, and package inputs verified");
