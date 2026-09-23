import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = ["src", "backend", "scripts", "tests", "web", "ui"];
const files = [];

async function collectJavaScript(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectJavaScript(entryPath);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(entryPath);
  }
}

for (const directory of directories) await collectJavaScript(path.join(root, directory));

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax lint passed (${files.length} files)`);
