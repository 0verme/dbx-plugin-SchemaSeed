import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { collectUiRuntimeGraph } from "./ui-runtime-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.DBX_PLUGIN_TARGET ?? "universal";
if (target !== "universal") {
  throw new Error(`DBX_PLUGIN_TARGET must be "universal" for SchemaSeed's frontend-only package (received "${target}")`);
}

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
if (manifest.entrypoints?.backend !== undefined) {
  throw new Error("SchemaSeed production packages must not declare a backend entrypoint");
}
const cli = path.join(root, "node_modules", "@dbx-app", "plugin-cli", "bin", "dbx-plugin.js");
const stage = await mkdtemp(path.join(os.tmpdir(), "schema-seed-frontend-package-"));
try {
  await mkdir(path.join(stage, "assets"), { recursive: true });
  await mkdir(path.join(stage, "ui"), { recursive: true });
  await writeFile(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(stage, "dbx-plugin.toml"), await readFile(path.join(root, "dbx-plugin.toml")));
  await writeFile(path.join(stage, "assets", "plugin.svg"), await readFile(path.join(root, "assets", "plugin.svg")));
  for (const relative of ["ui/index.html", "ui/generation-workbench.css"]) {
    await writeFile(path.join(stage, relative), await readFile(path.join(root, relative)));
  }

  // Stage every reachable browser module under the ui root. This includes the
  // existing Generation Core, which is shared with the Node-based dev tests but
  // is browser-safe in the final package.
  const graph = await collectUiRuntimeGraph((sourcePath) => readFile(path.join(root, sourcePath), "utf8"));
  for (const [packagePath, module] of graph) {
    const destination = path.join(stage, packagePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, module.source);
  }

  const packageResult = spawnSync(process.execPath, [cli, "package", stage, "--target", target, "--output-dir", path.join(root, "dist")], {
    cwd: stage,
    encoding: "utf8",
  });
  if (packageResult.error) throw packageResult.error;
  if (packageResult.status !== 0) {
    throw new Error(`Official dbx-plugin package failed (${packageResult.status}):\n${packageResult.stdout}\n${packageResult.stderr}`);
  }
  process.stdout.write(packageResult.stdout);
  process.stderr.write(packageResult.stderr);
} finally {
  await rm(stage, { recursive: true, force: true });
}
