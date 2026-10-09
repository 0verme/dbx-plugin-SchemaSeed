import { probeDbxDataSamples } from "../host/dbx-data-sample-probe.mjs";
import { resolveDbxTemporalMetadata } from "../host/dbx-temporal-metadata-resolver.mjs";
import { executeGenerationPreview } from "../generation/generation-runtime.mjs";
import { DbxHostSchemaMetadataProvider } from "../providers/dbx-host-schema-metadata-provider.mjs";
import { DbxGenerationWorkbenchController } from "./dbx-generation-workbench-controller.mjs";

/** @param {object} host @param {import("../i18n/index.mjs").Translator} [translator] */
export function createGenerationWorkbenchController(host, translator) {
  return new DbxGenerationWorkbenchController({
    provider: new DbxHostSchemaMetadataProvider({
      capabilities: host.capabilities,
      getTableMetadata: (tableContext) => host.getTableMetadata(tableContext),
    }),
    sampleProbe: ({ context, schema }) => probeDbxDataSamples({
      capabilities: host.capabilities,
      queryData: typeof host.queryData === "function" ? (request) => host.queryData(request) : undefined,
    }, context, schema),
    temporalMetadataResolver: ({ context, schema }) => resolveDbxTemporalMetadata({
      capabilities: host.capabilities,
      queryData: typeof host.queryData === "function" ? (request) => host.queryData(request) : undefined,
    }, context, schema),
    preview: executeGenerationPreview,
    translator,
  });
}
