import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FIXTURE_DIRECTORY = fileURLToPath(new URL("../../fixtures/schemas/", import.meta.url));
const FIXTURE_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Local fixture provider for development and tests. It never reads a DBX host,
 * connection, credential, or database; this is not a production metadata source.
 */
export class FixtureSchemaMetadataProvider {
  /** @param {{ directory?: string }} [options] */
  constructor(options = {}) {
    this.directory = options.directory ?? DEFAULT_FIXTURE_DIRECTORY;
  }

  /** @returns {Promise<string[]>} */
  async listTableIdentities() {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
  }

  /**
   * @param {import("../schema/schema-metadata-provider.mjs").TableSchemaRequest} request
   * @returns {Promise<import("../schema/schema-model.mjs").TableSchema>}
   */
  async getTableMetadata(request) {
    const tableIdentity = request?.tableIdentity;
    if (typeof tableIdentity !== "string" || !FIXTURE_NAME.test(tableIdentity)) {
      throw new Error("Fixture tableIdentity must be a valid fixture name");
    }

    const filePath = path.join(this.directory, `${tableIdentity}.json`);
    const schema = JSON.parse(await readFile(filePath, "utf8"));
    if (schema?.tableIdentity !== tableIdentity) {
      throw new Error(`Fixture ${tableIdentity} has a mismatching tableIdentity`);
    }
    return schema;
  }
}
