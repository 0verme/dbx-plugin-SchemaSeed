import { readFile } from "node:fs/promises";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

export const PLUGIN_IDENTITY = Object.freeze({
  id: requiredManifestText(manifest?.id, "id"),
  version: requiredManifestText(manifest?.version, "version"),
});

function requiredManifestText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`manifest.json plugin ${field} must be a non-empty string`);
  }
  return value;
}
