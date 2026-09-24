/**
 * @typedef {{ tableIdentity: string } | { tableContext: import("../table-context.mjs").TableContext }} TableSchemaRequest
 * @typedef {{ getTableMetadata(request: TableSchemaRequest): Promise<import("./schema-model.mjs").TableSchema> }} SchemaMetadataProvider
 */

/** @param {unknown} provider */
export function isSchemaMetadataProvider(provider) {
  return provider !== null
    && typeof provider === "object"
    && typeof provider.getTableMetadata === "function";
}
