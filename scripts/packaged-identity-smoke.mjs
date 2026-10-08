import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const packagePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : await defaultPackagePath();
  const packageBytes = await readFile(packagePath);
  const entries = readDbxZip(packageBytes);
  const manifest = JSON.parse(required(entries, "manifest.json").toString("utf8"));
  const artifactPath = packagePath.replace(/\.dbxp$/u, ".artifact.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  if (manifest.entrypoints?.backend !== undefined) throw new Error("Frontend-only package unexpectedly declares a backend entrypoint");
  if (manifest.entrypoints?.ui?.entry !== "ui/index.html") throw new Error("Packaged UI identity is missing its ui/index.html entrypoint");
  if (!entries.has("ui/app.mjs") || !entries.has("ui/index.html")) throw new Error("Package is missing its frontend Workbench entry assets");
  if ([...entries.keys()].some((name) => name.startsWith("backend/") || name.startsWith("bin/"))) {
    throw new Error("Frontend-only package unexpectedly contains a backend or launcher file");
  }
  if (artifact.url !== path.basename(packagePath)
    || artifact.target !== "universal"
    || artifact.sha256 !== createHash("sha256").update(packageBytes).digest("hex")
    || artifact.size !== packageBytes.length) {
    throw new Error("Artifact metadata does not identify the packaged frontend artifact bytes");
  }
  console.log(`Packaged frontend identity matches its manifest: ${manifest.id}/${manifest.version} (${artifact.target})`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function defaultPackagePath() {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  return path.join(root, "dist", `${manifest.id}-${manifest.version}-universal.dbxp`);
}

/** @param {Map<string, Buffer>} entries @param {string} name */
function required(entries, name) {
  const value = entries.get(name);
  if (!value) throw new Error(`Package is missing ${name}`);
  return value;
}

/** @param {Buffer} buffer */
function readDbxZip(buffer) {
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
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (entries.has(name) || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid or duplicate package entry ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const contents = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!contents || contents.length !== uncompressedSize) throw new Error(`Invalid compressed package entry ${name}`);
    entries.set(name, contents);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
