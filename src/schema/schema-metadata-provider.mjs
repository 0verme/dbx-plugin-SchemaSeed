/**
 * @typedef {{ tableIdentity: string }} TableSchemaRequest
 * @typedef {{ getTableMetadata(request: TableSchemaRequest): Promise<import("./schema-model.mjs").TableSchema> }} SchemaMetadataProvider
 */

/** @param {unknown} provider */
export function isSchemaMetadataProvider(provider) {
  return provider !== null
    && typeof provider === "object"
    && typeof provider.getTableMetadata === "function";
}
