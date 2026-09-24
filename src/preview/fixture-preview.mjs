import { makeDiagnostic } from "../diagnostics.mjs";
import { buildGenerationPlan } from "../generation/generation-plan.mjs";
import { generateRows } from "../generation/generation-engine.mjs";
import { FixtureSchemaMetadataProvider } from "../providers/fixture-schema-metadata-provider.mjs";
import { isSchemaMetadataProvider } from "../schema/schema-metadata-provider.mjs";

export const DEFAULT_PREVIEW_ROW_COUNT = 20;

/**
 * Preview is a consumer of the generation engine. Its convenience default is
 * intentionally outside the core/plan, which always requires rowCount.
 * @param {{ provider?: import("../schema/schema-metadata-provider.mjs").SchemaMetadataProvider, tableIdentity: string, rowCount?: number, seed?: string | number, rules?: Record<string, unknown>, overrides?: Record<string, unknown>, semanticOverrides?: Record<string, string>, semanticMappings?: Record<string, string>, personGroups?: Array<{ id: string, columns: string[] }>, locale?: string, mode?: string }} input
 */
export async function previewTable(input) {
  const tableIdentity = typeof input?.tableIdentity === "string" ? input.tableIdentity : "<unknown-table>";
  const provider = input?.provider;
  if (!isSchemaMetadataProvider(provider)) {
    const diagnostics = [makeDiagnostic({
      severity: "unsupported",
      code: "schema_metadata_provider_unavailable",
      table: tableIdentity,
      rule: "fixture-preview",
      reason: "A SchemaMetadataProvider with getTableMetadata(request) is required",
    })];
    return { plan: null, rows: [], diagnostics, status: "blocked" };
  }

  let tableSchema;
  try {
    tableSchema = await provider.getTableMetadata({ tableIdentity });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const diagnostics = [makeDiagnostic({
      severity: "error",
      code: "schema_metadata_provider_failed",
      table: tableIdentity,
      rule: "fixture-preview",
      reason,
    })];
    return { plan: null, rows: [], diagnostics, status: "blocked" };
  }

  const plan = buildGenerationPlan(tableSchema, {
    seed: input.seed,
    rowCount: input.rowCount ?? DEFAULT_PREVIEW_ROW_COUNT,
    rules: input.rules,
    overrides: input.overrides,
    semanticOverrides: input.semanticOverrides,
    semanticMappings: input.semanticMappings,
    personGroups: input.personGroups,
    locale: input.locale,
    mode: input.mode,
  });
  const generated = generateRows(plan);
  return {
    plan,
    rows: generated.rows,
    diagnostics: generated.diagnostics,
    status: generated.status,
  };
}

/** @param {{ fixtureName: string, rowCount?: number, seed?: string | number, rules?: Record<string, unknown>, overrides?: Record<string, unknown>, semanticOverrides?: Record<string, string>, semanticMappings?: Record<string, string>, personGroups?: Array<{ id: string, columns: string[] }>, locale?: string, mode?: string, provider?: FixtureSchemaMetadataProvider }} input */
export async function previewFixture(input) {
  const provider = input?.provider ?? new FixtureSchemaMetadataProvider();
  return previewTable({
    provider,
    tableIdentity: input?.fixtureName,
    rowCount: input?.rowCount,
    seed: input?.seed,
    rules: input?.rules,
    overrides: input?.overrides,
    semanticOverrides: input?.semanticOverrides,
    semanticMappings: input?.semanticMappings,
    personGroups: input?.personGroups,
    locale: input?.locale,
    mode: input?.mode,
  });
}
