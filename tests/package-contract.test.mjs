import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { collectUiRuntimeGraph, stripComments } from "../scripts/ui-runtime-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const PLUGIN_ID = manifest.id;
const WORKBENCH_ID = `${PLUGIN_ID}.generation-workbench`;
const TABLE_ACTION_ID = `${PLUGIN_ID}.generate-test-data`;
const HOST_PLUGIN_BASE = `http://dbx-plugin.localhost/${PLUGIN_ID}/`;

function readDbxZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(end, -1, "dbxp is a ZIP package");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "valid central directory entry");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, `valid local ZIP header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const contents = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    assert.ok(contents, `supported ZIP compression method ${method} for ${name}`);
    assert.equal(contents.length, uncompressedSize, `uncompressed size for ${name}`);
    assert.equal(entries.has(name), false, `unique package path ${name}`);
    entries.set(name, contents);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

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

function entryResourceReferences(html) {
  const resources = [];
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of withoutComments.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if (match[1].toLowerCase() === "script" && attributes.get("src")) {
      resources.push({ kind: "script", reference: attributes.get("src"), module: (attributes.get("type") ?? "").toLowerCase() === "module" });
    }
    if (match[1].toLowerCase() === "link" && (attributes.get("rel") ?? "").toLowerCase() === "stylesheet" && attributes.get("href")) {
      resources.push({ kind: "stylesheet", reference: attributes.get("href") });
    }
  }
  return resources;
}

function hostEntryDirectory(resources) {
  let entryDirectory = "";
  for (const { reference } of resources) {
    const assetPath = decodeURIComponent(new URL(reference, "https://dbx-plugin.invalid/").pathname).replace(/^\/+/, "");
    if (!entryDirectory) entryDirectory = assetPath.split("/").slice(0, -1).join("/");
  }
  return entryDirectory;
}

function pluginUrlToPackagePath(url) {
  assert.equal(url.origin, "http://dbx-plugin.localhost");
  const prefix = `/${PLUGIN_ID}/`;
  assert.ok(url.pathname.startsWith(prefix), `${url} stays inside the plugin asset origin`);
  return `ui/${url.pathname.slice(prefix.length)}`;
}

function contentSecurityPolicyMetas(html) {
  return startTags(html, "meta").filter((tag) => (tagAttributes(tag).get("http-equiv") ?? "").trim().toLowerCase() === "content-security-policy");
}

function assertDbxSandboxDocumentContract(html, entries) {
  assert.equal(contentSecurityPolicyMetas(html).length, 0, "DBX owns the sandbox CSP");
  assert.equal(startTags(html, "base").length, 0, "DBX injects the plugin asset base");
  const resources = entryResourceReferences(html);
  assert.ok(resources.length >= 2, "entry document references its runtime assets");
  for (const { reference } of resources) {
    assert.match(reference, /^\.\//, `entry reference ${reference} is ui-root-relative`);
    assert.doesNotMatch(reference, /\.\./, `entry reference ${reference} stays inside the ui root`);
    assert.equal(entries.has(pluginUrlToPackagePath(new URL(reference, HOST_PLUGIN_BASE))), true, `packaged asset resolves: ${reference}`);
  }
  assert.ok(resources.some((entry) => entry.reference === "./app.mjs" && entry.module), "entry module is packaged");
  assert.ok(resources.some((entry) => entry.reference === "./generation-workbench.css"), "Workbench stylesheet is packaged");
  assert.equal(hostEntryDirectory(resources), "", "all entry resources stay at the UI root");
}

const dist = path.join(root, "dist");
const packageName = `${manifest.id}-${manifest.version}-universal.dbxp`;
const packagePath = path.join(dist, packageName);
execFileSync(process.execPath, [path.join(root, "scripts/build.mjs")], { cwd: root, stdio: "pipe" });
const packageBytes = await readFile(packagePath);
const entries = readDbxZip(packageBytes);


test("manifest declares a frontend-only Workbench and the current DBX Host contract", async () => {
  const config = await readFile(path.join(root, "dbx-plugin.toml"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.engines.host_api, "^1.4");
  assert.equal(manifest.engines.dbx, ">=0.6.23");
  assert.deepEqual(manifest.permissions, ["host.schema:read", "host.data:read"]);
  assert.deepEqual(manifest.entrypoints, { ui: { root: "ui", entry: "ui/index.html" } });
  assert.doesNotMatch(config, /^\[backend\]/m);
  assert.match(config, /include\s*=\s*\["assets",\s*"ui"\]/);
  assert.equal(packageJson.devDependencies["@dbx-app/plugin-cli"], "0.1.9");

  const workbenches = manifest.contributions.filter((entry) => entry.type === "workbench");
  assert.deepEqual(workbenches.map((entry) => entry.id), [WORKBENCH_ID]);
  const action = manifest.contributions.find((entry) => entry.id === TABLE_ACTION_ID);
  assert.equal(action.type, "context-menu");
  assert.equal(action.menu, "table");
  assert.deepEqual(action.action, { type: "open-workbench", workbench: WORKBENCH_ID });
  assert.equal(manifest.localizations?.["zh-CN"]?.contributions?.[`${PLUGIN_ID}.schema-metadata-probe`], undefined);

  const router = await readFile(path.join(root, "ui/app.mjs"), "utf8");
  assert.match(router, /await host\.ready/);
  assert.match(router, /mountGenerationWorkbench/);
  assert.match(router, /showFatalBootError/);
  assert.match(router, /catch \(error\)/);
  assert.doesNotMatch(router, /host\.invoke/);
  const workbenchApp = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
  const adapter = await readFile(path.join(root, "src/workbench/dbx-generation-workbench-adapter.mjs"), "utf8");
  assert.match(workbenchApp, /createGenerationWorkbenchController/);
  assert.match(adapter, /preview: executeGenerationPreview/);
  assert.match(adapter, /host\.getTableMetadata/);
  assert.match(adapter, /host\.queryData/);
  assert.match(workbenchApp, /host\.saveFile/);
  assert.doesNotMatch(workbenchApp, /host\.invoke/);
  assert.doesNotMatch(workbenchApp, /URL\.createObjectURL|new Blob\(|\.download\s*=|link\.click\(\)/);
});

test("package build rejects platform-specific labels for the universal frontend runtime", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DBX_PLUGIN_TARGET: "darwin-arm64" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DBX_PLUGIN_TARGET/);
});

test("official CLI candidate metadata and archive bytes agree; candidate remains unsigned", async () => {
  const metadata = JSON.parse(await readFile(path.join(dist, `${manifest.id}-${manifest.version}-universal.artifact.json`), "utf8"));
  assert.equal(metadata.target, "universal");
  assert.equal(metadata.url, packageName);
  assert.equal(metadata.sha256, createHash("sha256").update(packageBytes).digest("hex"));
  assert.equal(metadata.size, packageBytes.length);
  assert.equal(metadata.signingKeyId, undefined);
  assert.equal(entries.has("signature.json"), false);
  const identitySmoke = spawnSync(process.execPath, [path.join(root, "scripts/packaged-identity-smoke.mjs"), packagePath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(identitySmoke.status, 0, `${identitySmoke.stdout}\n${identitySmoke.stderr}`);
  assert.match(identitySmoke.stdout, /Packaged frontend identity matches its manifest/u);

  const packagedManifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  assert.deepEqual(packagedManifest, manifest);
  assert.deepEqual(packagedManifest.entrypoints, { ui: { root: "ui", entry: "ui/index.html" } });
  assert.deepEqual(packagedManifest.permissions, ["host.schema:read", "host.data:read"]);

  const checksumDocument = JSON.parse(entries.get("checksums.json").toString("utf8"));
  assert.equal(checksumDocument.algorithm, "sha256");
  assert.deepEqual(Object.keys(checksumDocument.files).sort(), [...entries.keys()].filter((name) => name !== "checksums.json").sort());
  for (const [name, digest] of Object.entries(checksumDocument.files)) {
    assert.equal(createHash("sha256").update(entries.get(name)).digest("hex"), digest, `checksum covers ${name}`);
  }
});

test("the actual .dbxp contains a complete Node-free UI graph and no backend launcher", async () => {
  assert.equal(entries.has("manifest.json"), true);
  assert.equal(entries.has("assets/plugin.svg"), true);
  assert.equal(entries.has("ui/index.html"), true);
  assert.equal(entries.has("ui/app.mjs"), true);
  assert.equal(entries.has("ui/src/generation/generation-runtime.mjs"), true);
  assert.equal(entries.has("ui/src/generation/generation-engine.mjs"), true);
  assert.equal(entries.has("ui/src/generation/person-synthetic.mjs"), true);
  assert.equal([...entries.keys()].some((name) => name.startsWith("backend/") || name.startsWith("bin/")), false);
  assert.equal([...entries.keys()].some((name) => /^(?:tests|fixtures|web)\//.test(name)), false);
  assert.equal([...entries.keys()].some((name) => /(?:^|\/)(?:schema-seed-runtime|unix-launcher|windows-launcher)/i.test(name)), false);

  const runtimeModules = [...entries.keys()].filter((name) => name.startsWith("ui/") && name.endsWith(".mjs")).sort();
  const graph = await collectUiRuntimeGraph((sourcePath) => readFile(path.join(root, sourcePath), "utf8"));
  assert.deepEqual(runtimeModules, [...graph.keys()].filter((name) => name.endsWith(".mjs")).sort());
  for (const [packagePath, module] of graph) {
    assert.deepEqual(entries.get(packagePath), Buffer.from(module.source), `packaged runtime source ${packagePath}`);
    const source = stripComments(entries.get(packagePath).toString("utf8"));
    assert.doesNotMatch(source, /\bnode:/, `no Node builtin in ${packagePath}`);
    assert.doesNotMatch(source, /\b(?:Buffer|process)\s*\./, `no Node-only global in ${packagePath}`);
  }
  assert.equal(entries.has("ui/src/workbench/dbx-generation-workbench-controller.mjs"), true);
  assert.equal(entries.has("ui/src/generation/generation-runtime-protocol.mjs"), false, "test-only JSON-RPC compatibility adapter is not part of the production package");
  assertDbxSandboxDocumentContract(entries.get("ui/index.html").toString("utf8"), entries);
});

test("Workbench boot errors have an accessible fatal state instead of a blank screen", async () => {
  const source = await readFile(path.join(root, "src/bootstrap-error-state.mjs"), "utf8");
  const html = entries.get("ui/index.html").toString("utf8");
  assert.match(source, /role/);
  assert.match(source, /textContent/);
  assert.match(html, /id="boot-fatal"/);
  assert.match(html, /id="boot-fatal-description"/);
  assert.match(html, /id="boot-retry"/);
  assert.match(entries.get("ui/app.mjs").toString("utf8"), /showFatalBootError/);
});
