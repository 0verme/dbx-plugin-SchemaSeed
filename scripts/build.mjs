import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const target = "universal";
const buildRoot = await fsMkdtemp(path.join(os.tmpdir(), "schema-seed-probe-"));

try {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const packageName = `${manifest.id}-${manifest.version}-${target}.dbxp`;
  const packagePath = path.join(dist, packageName);
  const metadataPath = packagePath.replace(/\.dbxp$/, ".artifact.json");
  manifest.entrypoints.backend.executable = `bin/${target}/schema-seed-probe`;

  /** @type {Map<string, { data: Buffer, mode: number }>} */
  const files = new Map();
  files.set("manifest.json", { data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), mode: 0o644 });
  files.set("bin/universal/schema-seed-probe", {
    data: await readFile(path.join(root, "scripts/unix-launcher.sh")),
    mode: 0o100755,
  });
  files.set("bin/universal/schema-seed-probe.bat", {
    data: await readFile(path.join(root, "scripts/windows-launcher.bat")),
    mode: 0o644,
  });
  files.set("backend/schema-seed-probe.mjs", {
    data: await readFile(path.join(root, "backend/schema-seed-probe.mjs")),
    mode: 0o644,
  });
  files.set("src/table-context.mjs", { data: await readFile(path.join(root, "src/table-context.mjs")), mode: 0o644 });
  files.set("src/probe-protocol.mjs", { data: await readFile(path.join(root, "src/probe-protocol.mjs")), mode: 0o644 });

  const checksumFiles = Object.fromEntries(
    [...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => [name, sha256(entry.data)]),
  );
  const checksums = Buffer.from(`${JSON.stringify({ algorithm: "sha256", files: checksumFiles }, null, 2)}\n`);
  files.set("checksums.json", { data: checksums, mode: 0o644 });

  await mkdir(dist, { recursive: true });
  await rm(packagePath, { force: true });
  await writeFile(packagePath, createStoredZip(files));
  const packageBytes = await readFile(packagePath);
  const metadata = {
    target,
    url: packageName,
    sha256: sha256(packageBytes),
    size: packageBytes.length,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Built unsigned candidate ${packagePath}`);
  console.log(`Metadata ${metadataPath}`);
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const entries = [...files.entries()].sort(([left], [right]) => left.localeCompare(right));

  for (const [name, entry] of entries) {
    const filename = Buffer.from(name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function fsMkdtemp(prefix) {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(prefix);
}
