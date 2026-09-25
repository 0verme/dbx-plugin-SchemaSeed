/**
 * Machine evidence contract for semantic inference and semantic mapping.
 *
 * Evidence entries keep the original Core fields (`source`, `observation`,
 * `explanation`) verbatim so existing consumers keep working, and add:
 *
 *  - `kind`: a stable machine identity for the observation, independent of the
 *    UI language;
 *  - `params`: the structured values the observation was derived from.
 *
 * The Workbench presentation layer translates `kind` + `params`. Core never
 * reads the UI locale and never emits localized copy here.
 */

export const EVIDENCE_KINDS = Object.freeze({
  columnNameExactAlias: "column_name_exact_alias",
  columnNameAliasToken: "column_name_alias_token",
  schemaTypeCompatible: "schema_type_compatible",
  schemaTypeIncompatible: "schema_type_incompatible",
  lengthAccommodatesMarker: "length_accommodates_marker",
  lengthInsufficientForMarker: "length_insufficient_for_marker",
  semanticOverrideConfirmed: "semantic_override_confirmed",
  semanticOverrideApplied: "semantic_override_applied",
  semanticLeftUnknown: "semantic_left_unknown",
});

/**
 * @param {{ kind: string, source: string, observation: string, explanation: string, params?: Record<string, unknown> }} input
 */
export function createEvidence(input) {
  return Object.freeze({
    kind: input.kind,
    source: input.source,
    observation: input.observation,
    explanation: input.explanation,
    params: Object.freeze({ ...(input.params ?? {}) }),
  });
}
