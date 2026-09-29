import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const packagePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : await defaultPackagePath();
  const entries = readStoredZip(await readFile(packagePath));
  const packagedManifest = parseManifest(entries.get("manifest.json"));
  const identityModule = entries.get("backend/plugin-identity.mjs");
  if (!identityModule) throw new Error("Package is missing backend/plugin-identity.mjs");
  if (!entries.has("backend/schema-seed-runtime.mjs")) throw new Error("Package is missing backend/schema-seed-runtime.mjs");

  const extractionRoot = await mkdtemp(path.join(os.tmpdir(), "schema-seed-identity-smoke-"));
  try {
    for (const [name, contents] of entries) {
      const destination = path.resolve(extractionRoot, ...name.split("/"));
      if (destination !== extractionRoot && !destination.startsWith(`${extractionRoot}${path.sep}`)) {
        throw new Error(`Unsafe package path: ${name}`);
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }

    const runtimePath = path.join(extractionRoot, "backend/schema-seed-runtime.mjs");
    const request = {
      jsonrpc: "2.0",
      id: "packaged-identity-smoke",
      method: "plugin/initialize",
      params: { plugin: { id: "host-supplied-id", version: "host-supplied-version" } },
    };
    const result = spawnSync(process.execPath, [runtimePath], {
      cwd: os.tmpdir(),
      input: `${JSON.stringify(request)}\n`,
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Packaged backend exited ${result.status}: ${result.stderr}`);

    const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
    if (lines.length !== 1) throw new Error(`Expected one initialize response, received ${lines.length}`);
    const response = JSON.parse(lines[0]);
    if (response.error) throw new Error(`Packaged initialize returned an error: ${JSON.stringify(response.error)}`);
    const actualIdentity = response.result?.plugin;
    if (actualIdentity?.id !== packagedManifest.id || actualIdentity?.version !== packagedManifest.version) {
      throw new Error(`Packaged backend identity ${JSON.stringify(actualIdentity)} does not match manifest ${JSON.stringify({ id: packagedManifest.id, version: packagedManifest.version })}`);
    }
    console.log(`Packaged backend identity matches its manifest: ${actualIdentity.id}/${actualIdentity.version}`);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function defaultPackagePath() {
  const sourceManifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  assertManifestIdentity(sourceManifest);
  return path.join(root, "dist", `${sourceManifest.id}-${sourceManifest.version}-universal.dbxp`);
}

function parseManifest(data) {
  if (!data) throw new Error("Package is missing manifest.json");
  const manifest = JSON.parse(data.toString("utf8"));
  assertManifestIdentity(manifest);
  return manifest;
}

function assertManifestIdentity(manifest) {
  for (const field of ["id", "version"]) {
    if (typeof manifest?.[field] !== "string" || manifest[field].trim() === "") {
      throw new TypeError(`Packaged manifest ${field} must be a non-empty string`);
    }
  }
}

function readStoredZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length) throw new Error("Input is not a supported .dbxp ZIP package");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid .dbxp central directory entry");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    if (method !== 0 || compressedSize !== uncompressedSize) throw new Error(`Unsupported compression for package entry ${name}`);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid local ZIP header for package entry ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > buffer.length || entries.has(name)) throw new Error(`Invalid or duplicate package entry ${name}`);
    entries.set(name, buffer.subarray(dataOffset, dataEnd));
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}
