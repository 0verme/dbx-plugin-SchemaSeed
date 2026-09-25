import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { collectUiRuntimeGraph } from "../scripts/ui-runtime-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ID = "io.github.0verme.schema-seed";
const WORKBENCH_ID = "io.github.0verme.schema-seed.generation-workbench";
const TABLE_ACTION_ID = "io.github.0verme.schema-seed.generate-test-data";
const PHASE0_PROBE_ID = "io.github.0verme.schema-seed.table-context-probe";
// WebView2 maps DBX's dbx-plugin scheme to this origin; the host injects it as
// the sandbox document <base> and allows exactly this origin in its CSP.
const HOST_PLUGIN_BASE = `http://dbx-plugin.localhost/${PLUGIN_ID}/`;

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

/** Tags parsed like the host DOM parser: HTML comments cannot contribute elements. */
function startTags(html, name) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  return [...withoutComments.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function tagAttributes(tag) {
  const attributes = new Map();
  const body = tag.replace(/^<\s*[a-zA-Z][a-zA-Z0-9-]*/, "").replace(/\/?>$/, "");
  for (const match of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** Entry `script[src]` / `link[rel=stylesheet][href]` references in document order. */
function entryResourceReferences(html) {
  const resources = [];
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of withoutComments.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if (match[1].toLowerCase() === "script" && attributes.get("src")) resources.push({ kind: "script", reference: attributes.get("src"), module: (attributes.get("type") ?? "").toLowerCase() === "module" });
    if (match[1].toLowerCase() === "link" && (attributes.get("rel") ?? "").toLowerCase() === "stylesheet" && attributes.get("href")) resources.push({ kind: "stylesheet", reference: attributes.get("href") });
  }
  return resources;
}

/** Mirrors PluginWorkbenchHost.pluginUiBaseUrl/pluginUiHtmlCache entryDirectory. */
function hostEntryDirectory(resources) {
  let entryDirectory = "";
  for (const { reference } of resources) {
    const assetPath = decodeURIComponent(new URL(reference, "https://dbx-plugin.invalid/").pathname).replace(/^\/+/, "");
    if (!entryDirectory) entryDirectory = assetPath.split("/").slice(0, -1).join("/");
  }
  return entryDirectory;
}

/** DBX serves `<origin>/<plugin-id>/<path>` from `<package>/ui/<path>`. */
function pluginUrlToPackagePath(url) {
  assert.equal(url.origin, "http://dbx-plugin.localhost");
  const prefix = `/${PLUGIN_ID}/`;
  assert.ok(url.pathname.startsWith(prefix), `${url} stays inside the plugin asset origin`);
  return `ui/${url.pathname.slice(prefix.length)}`;
}

function contentSecurityPolicyMetas(html) {
  return startTags(html, "meta").filter((tag) => (tagAttributes(tag).get("http-equiv") ?? "").trim().toLowerCase() === "content-security-policy");
}

/** The DBX v0.6.23 sandbox contract: the host owns CSP + <base>; every entry
 * resource and every dynamic import must resolve to a packaged ui asset. */
function assertDbxSandboxDocumentContract(html, entries) {
  assert.equal(contentSecurityPolicyMetas(html).length, 0, "plugin UI must not declare its own CSP: DBX injects the sandbox CSP as a separate policy and the intersection is the strictest of both");
  assert.equal(startTags(html, "base").length, 0, "plugin UI must not declare <base>: DBX injects the plugin asset base and owns base-uri");

  const resources = entryResourceReferences(html);
  assert.ok(resources.length >= 3, "entry document references the runtime assets");
  for (const { reference } of resources) {
    assert.match(reference, /^\.\//, `entry reference ${reference} must be ui-root-relative`);
    assert.doesNotMatch(reference, /\.\./, `entry reference ${reference} must not leave the ui root`);
    assert.equal(entries.has(pluginUrlToPackagePath(new URL(reference, HOST_PLUGIN_BASE))), true, `DBX <base> resolves ${reference} to a packaged asset`);
  }
  assert.ok(resources.some((entry) => entry.reference === "./app.mjs" && entry.module), "the entry module stays a packaged relative module script");
  assert.ok(resources.some((entry) => entry.reference === "./generation-workbench.css"), "the Workbench stylesheet stays a packaged relative stylesheet");

  const entryDirectory = hostEntryDirectory(resources);
  assert.equal(entryDirectory, "", "no subdirectory entry asset may move DBX's injected <base> away from the ui root");

  const entryModule = entries.get("ui/app.mjs").toString("utf8");
  const dynamicSpecifiers = [...entryModule.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
  assert.ok(dynamicSpecifiers.includes("./generation-workbench/app.mjs"), "the Workbench module is reachable from the inlined entry");
  assert.ok(dynamicSpecifiers.includes("./probe-app.mjs"), "the Probe module stays reachable from the inlined entry");
  for (const specifier of dynamicSpecifiers) {
    const packagePath = pluginUrlToPackagePath(new URL(specifier, HOST_PLUGIN_BASE));
    assert.equal(entries.has(packagePath), true, `the inlined entry import ${specifier} resolves to packaged ${packagePath}`);
  }
}

test("manifest declares the production Workbench and DBX v0.6.23 table action contract", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const config = await readFile(path.join(root, "dbx-plugin.toml"), "utf8");
  assert.equal(manifest.engines.host_api, "^1.3");
  assert.equal(manifest.engines.dbx, ">=0.6.23", "DBX v0.6.23 is the first released runtime containing upstream #10244");
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
  const tableContextMenus = manifest.contributions.filter((entry) => entry.type === "context-menu" && entry.menu === "table");
  assert.equal(tableContextMenus.length, 1, "production manifest exposes exactly one table context-menu contribution");
  assert.equal(tableContextMenus[0].id, TABLE_ACTION_ID);
  assert.equal(manifest.contributions.some((entry) => entry.id === PHASE0_PROBE_ID), false, "the Phase 0 table context probe is not a production entry point");
  assert.equal(manifest.localizations?.["zh-CN"]?.contributions?.[PHASE0_PROBE_ID], undefined, "the Phase 0 table context probe localization is removed");

  const router = await readFile(path.join(root, "ui/app.mjs"), "utf8");
  assert.match(router, new RegExp(WORKBENCH_ID.replaceAll(".", "\\.")));
  assert.match(router, /dbx-plugin-init/);
  const productionApp = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
  const browserViewModel = await readFile(path.join(root, "src/workbench/workbench-view-model.mjs"), "utf8");
  assert.doesNotMatch(browserViewModel, /node:/, "the DBX browser UI view model must remain browser-safe");
  assert.match(productionApp, /data-rule-selector/);
  assert.match(productionApp, /data-rule-field/);
  assert.match(productionApp, /data-constraint-kind/);
  assert.match(productionApp, /data-i18n="app\.titleSuffix"/, "Workbench copy is bound to i18n message keys");
  assert.match(productionApp, /describeDiagnostics/);
  assert.match(productionApp, /data-i18n="diagnostics\.technicalSummary"|diagnostics\.technicalSummary/);
  assert.doesNotMatch(productionApp, /locale === "zh-CN" \?/, "no inline locale conditionals in the Workbench UI");
  assert.doesNotMatch(productionApp, /fixture-schema-metadata-provider/);
  assert.match(productionApp, /DbxHostSchemaMetadataProvider/);
  assert.match(productionApp, /onContext/);
  assert.match(productionApp, /\.\.\/src\/workbench\/dbx-generation-workbench-controller\.mjs/, "the Workbench module imports the DBX ui-root-relative vendored runtime");
  assert.doesNotMatch(productionApp, /node:crypto|\bBuffer\s*\./, "the browser Workbench module must stay WebView-safe");
  assert.doesNotMatch(productionApp, /FixtureSchemaMetadataProvider|fixture-schema-metadata-provider/);
  assert.match(config, /src\/workbench\/dbx-generation-workbench-controller\.mjs/);
  assert.doesNotMatch(config, /^\s+"(?:fixtures|web|tests|src\/providers\/fixture|src\/workbench\/workbench-controller)/m);
});

test("source version contract matches the manifest that the release packages", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const { PLUGIN_VERSION } = await import("../src/table-context.mjs");
  assert.equal(PLUGIN_VERSION, manifest.version, "src/table-context.mjs PLUGIN_VERSION must track manifest.json version");
});

test("package build refuses to mislabel a platform target", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DBX_PLUGIN_TARGET: "linux-x64" },
  });
  assert.notEqual(result.status, 0, "SchemaSeed only publishes the platform-independent universal candidate");
  assert.match(result.stderr, /DBX_PLUGIN_TARGET/);
});

test("candidate artifact metadata matches the packaged bytes and stays unsigned", async () => {
  execFileSync(process.execPath, [path.join(root, "scripts/build.mjs")], { cwd: root, stdio: "pipe" });
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const candidateName = `${manifest.id}-${manifest.version}-universal`;
  const packageBytes = await readFile(path.join(root, "dist", `${candidateName}.dbxp`));
  const metadata = JSON.parse(await readFile(path.join(root, "dist", `${candidateName}.artifact.json`), "utf8"));
  assert.equal(metadata.target, "universal");
  assert.equal(metadata.url, `${candidateName}.dbxp`);
  assert.equal(metadata.sha256, createHash("sha256").update(packageBytes).digest("hex"));
  assert.equal(metadata.size, packageBytes.length);
  assert.equal(metadata.signingKeyId, undefined, "release candidates stay unsigned for DBX Store signing");
  const entries = readStoredZip(packageBytes);
  assert.equal(entries.has("signature.json"), false, "an unsigned candidate must not ship signature.json");
  const packagedManifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  assert.equal(packagedManifest.id, manifest.id);
  assert.equal(packagedManifest.publisher, manifest.publisher);
  assert.equal(packagedManifest.version, manifest.version);
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
    "src/generation/constraint-allocation.mjs",
    "src/generation/constraint-domain.mjs",
    "src/generation/generation-engine.mjs",
    "src/generation/generation-identity.mjs",
    "src/generation/generation-plan.mjs",
    "src/generation/manual-constraints.mjs",
    "src/generation/generation-rules.mjs",
    "src/generation/generation-runtime-contract.mjs",
    "src/generation/generation-runtime-protocol.mjs",
    "src/host/dbx-schema-metadata-probe.mjs",
    "src/i18n/catalog.mjs",
    "src/i18n/diagnostics.mjs",
    "src/i18n/en-US.mjs",
    "src/i18n/evidence.mjs",
    "src/i18n/index.mjs",
    "src/i18n/labels.mjs",
    "src/i18n/ui-locale.mjs",
    "src/i18n/workbench-messages.mjs",
    "src/i18n/zh-CN.mjs",
    "src/probe-protocol.mjs",
    "src/providers/dbx-host-schema-metadata-provider.mjs",
    "src/workbench/dbx-generation-workbench-controller.mjs",
    "src/workbench/workbench-view-model.mjs",
    "ui/index.html",
    "ui/app.mjs",
    "ui/probe-app.mjs",
    "ui/generation-workbench/app.mjs",
    "ui/generation-workbench.css",
    "ui/schema-metadata-probe.mjs",
    "checksums.json",
  ];
  for (const name of expected) assert.equal(entries.has(name), true, `package includes ${name}`);

  for (const name of entries.keys()) {
    assert.equal(/^(?:fixtures|web|tests)\//.test(name), false, `package excludes dev path ${name}`);
    assert.equal(/(?:^|\/)(?:fixture-schema-metadata-provider|fixture-preview)\.mjs$/.test(name), false, `package excludes fixture module ${name}`);
    assert.equal(/(?:^|\/)workbench-controller\.mjs$/.test(name), false, `package excludes the fixture workbench controller ${name}`);
    assert.equal(/(?:^|\/)workbench-server\.mjs$/.test(name), false, `package excludes the standalone workbench server ${name}`);
    assert.notEqual(name, "backend/schema-seed-probe.mjs");
  }

  const packagedManifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  const packagedAction = packagedManifest.contributions.find((entry) => entry.id === TABLE_ACTION_ID);
  assert.deepEqual(packagedAction.action, { type: "open-workbench", workbench: WORKBENCH_ID });
  assert.equal(packagedManifest.contributions.some((entry) => entry.id === packagedAction.action.workbench), true);
  assert.equal(packagedManifest.engines.dbx, ">=0.6.23", "DBX v0.6.23 is the first released runtime containing upstream #10244");
  const packagedTableMenus = packagedManifest.contributions.filter((entry) => entry.type === "context-menu" && entry.menu === "table");
  assert.equal(packagedTableMenus.length, 1, "packaged manifest exposes exactly one table context-menu contribution");
  assert.equal(packagedTableMenus[0].id, TABLE_ACTION_ID);
  assert.equal(packagedManifest.contributions.some((entry) => entry.id === PHASE0_PROBE_ID), false, "packaged manifest has no Phase 0 table context probe entry");
  assert.equal(packagedManifest.entrypoints.backend.executable, "bin/universal/schema-seed-runtime");
  assert.match(entries.get("ui/index.html").toString("utf8"), /generation-workbench\.css/);
  assert.match(entries.get("backend/schema-seed-runtime.mjs").toString("utf8"), /generation-runtime-protocol/);
  assert.match(entries.get("src/generation/generation-runtime-protocol.mjs").toString("utf8"), /generation\/preview/);
  assert.match(entries.get("src/generation/generation-runtime-protocol.mjs").toString("utf8"), /validateOnly/);
  assert.match(entries.get("src/generation/generation-plan.mjs").toString("utf8"), /generation-rules\.mjs/);
  assert.match(entries.get("ui/generation-workbench/app.mjs").toString("utf8"), /data-rule-selector/);

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

test("packaged Workbench satisfies the DBX v0.6.23 sandbox asset contract", async () => {
  execFileSync(process.execPath, [path.join(root, "scripts/build.mjs")], { cwd: root, stdio: "pipe" });
  const dist = path.join(root, "dist");
  const names = (await (await import("node:fs/promises")).readdir(dist)).filter((name) => name.endsWith(".dbxp"));
  assert.equal(names.length, 1);
  const entries = readStoredZip(await readFile(path.join(dist, names[0])));

  assertDbxSandboxDocumentContract(entries.get("ui/index.html").toString("utf8"), entries);

  // The package must ship exactly the reachable ui-rooted module graph; the
  // resolver rejects Node-only modules (`node:` builtins, `Buffer`), so a
  // browser-unsafe import fails this test instead of the DBX WebView.
  const graph = await collectUiRuntimeGraph((sourcePath) => readFile(path.join(root, sourcePath), "utf8"));
  for (const [packagePath, module] of graph) {
    assert.equal(entries.has(packagePath), true, `package contains UI runtime module ${packagePath}`);
    assert.deepEqual(entries.get(packagePath), Buffer.from(module.source), `packaged ${packagePath} matches its source`);
  }
  const packagedModules = [...entries.keys()].filter((name) => name.startsWith("ui/") && name.endsWith(".mjs")).sort();
  assert.deepEqual(packagedModules, [...graph.keys()].filter((name) => name.endsWith(".mjs")).sort(), "the package ships exactly the reachable UI module graph");
  assert.equal(graph.has("ui/src/generation/generation-identity.mjs"), true, "the shared sha256-addressed identity module is vendored under ui/src");
  assert.equal(graph.has("ui/src/workbench/dbx-generation-workbench-controller.mjs"), true, "the production Workbench controller is vendored under ui/src");
});
