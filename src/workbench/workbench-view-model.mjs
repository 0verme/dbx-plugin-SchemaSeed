import { createI18n, DEFAULT_UI_LOCALE } from "../i18n/index.mjs";
import {
  confidenceLabel,
  detectedLabel,
  generatorKindLabel,
  mappingStatusLabel,
  ruleFieldLabel,
  ruleKindLabel,
  ruleSourceLabel,
  schemaTypeStateLabel,
} from "../i18n/labels.mjs";
import { SEMANTIC_TYPES } from "../semantic/semantic-inference.mjs";

/**
 * Convert one Core column plan into a presentation-neutral view model.
 *
 * Machine values (enum tokens, raw types, identities, evidence) are kept as
 * they are; only `detected`, `confidence`, `mappingStatus`, `selectedMapping`,
 * `schemaType` and the editor labels are localized. The translator defaults to
 * `en-US` so non-localized consumers such as the standalone dev harness keep
 * their previous English output.
 *
 * @param {import("../generation/generation-plan.mjs").ColumnGenerationPlan} column
 * @param {import("../diagnostics.mjs").GenerationDiagnostic[]} [diagnostics]
 * @param {{ translator?: import("../i18n/index.mjs").Translator }} [options]
 */
export function toColumnViewModel(column, diagnostics = [], options = {}) {
  const t = options.translator ?? createI18n(DEFAULT_UI_LOCALE);
  const inference = column.inference;
  const semanticMapping = column.semanticMapping;
  const generationRule = column.generationRule ?? { kind: "auto" };
  const isSelectedSemantic = semanticMapping.selected && column.rule.kind.startsWith("semantic:");
  const rejectedMapping = ["invalid", "incompatible"].includes(semanticMapping.status)
    && ["explicit_user_semantic_override", "confirmed_semantic_mapping"].includes(semanticMapping.source);
  const { token: mappingStatusToken, kind } = mappingStatusTokenFor({
    generationRuleKind: generationRule.kind,
    isSelectedSemantic,
    rejectedMapping,
    semanticSource: semanticMapping.source,
    inferenceStatus: inference.status,
  });
  const mappingStatus = mappingStatusLabel(mappingStatusToken, t, kind ? { kind: ruleKindLabel(kind, t) } : undefined);

  const detectedKey = inference.status === "ambiguous" ? "ambiguous" : "semantic";
  const detectedInput = {
    detectedKey,
    detectedType: inference.semanticType,
    candidates: [...inference.candidates],
  };
  return {
    column: column.schema.name,
    schemaType: formatSchemaType(column.schema, t),
    detected: detectedLabel(detectedInput, t),
    detectedKey,
    detectedType: inference.semanticType,
    candidates: [...inference.candidates],
    confidence: confidenceLabel(inference.confidence, t),
    confidenceKey: inference.confidence,
    selectedMapping: selectedMappingLabel({
      isSelectedSemantic,
      rejectedMapping,
      semanticMapping,
      generationRule,
      ruleKind: column.rule.kind,
    }, t),
    mappingStatus,
    mappingStatusToken,
    mappingValue: isSelectedSemantic || rejectedMapping ? semanticMapping.semanticType : "auto",
    canConfirm: !isSelectedSemantic && inference.status === "candidate" && SEMANTIC_TYPES.includes(inference.semanticType),
    rule: { kind: column.rule.kind, source: column.rule.source, sourceLabel: ruleSourceLabel(column.rule.source, t) },
    generationRule: { ...generationRule, ...(Array.isArray(generationRule.values) ? { values: [...generationRule.values] } : {}) },
    ruleChoices: column.ruleChoices?.map((choice) => ({
      kind: choice.kind,
      label: ruleKindLabel(choice.kind, t, choice.label),
      draft: { ...choice.draft },
    })) ?? [],
    semanticTypes: [...(column.semanticTypes ?? [])],
    ruleFields: column.ruleFields?.map((field) => ({
      ...field,
      label: ruleFieldLabel(field, generationRule.kind, t),
    })) ?? [],
    ruleDiagnostics: diagnostics.filter((entry) => entry.column === column.schema.name).map((entry) => ({ ...entry })),
    evidence: [...semanticMapping.evidence],
  };
}

/**
 * Stable presentation token for the mapping status. The Internal enum
 * (`semanticMapping.status`, `inference.status`) is untouched; the token only
 * selects copy.
 * @param {{ generationRuleKind: string, isSelectedSemantic: boolean, rejectedMapping: boolean, semanticSource: string, inferenceStatus: string }} input
 * @returns {{ token: string, kind: string | null }}
 */
export function mappingStatusTokenFor(input) {
  if (input.generationRuleKind !== "auto" && input.generationRuleKind !== "semantic") {
    return { token: "explicit", kind: input.generationRuleKind };
  }
  if (input.isSelectedSemantic) {
    return { token: input.semanticSource === "confirmed_semantic_mapping" ? "confirmed" : "override", kind: null };
  }
  if (input.rejectedMapping) {
    return { token: input.semanticSource === "confirmed_semantic_mapping" ? "confirmedIncompatible" : "overrideIncompatible", kind: null };
  }
  if (input.inferenceStatus === "candidate") return { token: "needsConfirmation", kind: null };
  if (input.inferenceStatus === "ambiguous") return { token: "ambiguous", kind: null };
  if (input.inferenceStatus === "incompatible") return { token: "incompatible", kind: null };
  return { token: "fallback", kind: null };
}

/** @param {{ isSelectedSemantic: boolean, rejectedMapping: boolean, semanticMapping: Record<string, any>, generationRule: Record<string, any>, ruleKind: string }} input @param {import("../i18n/index.mjs").Translator} t */
function selectedMappingLabel(input, t) {
  if (input.isSelectedSemantic || input.rejectedMapping) {
    return semanticTypeLabel(input.semanticMapping.semanticType, t);
  }
  if (input.generationRule.kind === "semantic") {
    return semanticTypeLabel(input.generationRule.semanticType ?? input.semanticMapping.semanticType, t);
  }
  return generatorKindLabel(input.ruleKind, t);
}

/** @param {unknown} semanticType @param {import("../i18n/index.mjs").Translator} t */
function semanticTypeLabel(semanticType, t) {
  const key = `semantic.${String(semanticType)}`;
  return t.has(key) ? t(key) : String(semanticType ?? "");
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column @param {import("../i18n/index.mjs").Translator} t */
function formatSchemaType(column, t) {
  const type = column.dataType.state === "known" ? String(column.dataType.value) : schemaTypeStateLabel(column.dataType.state, t);
  const length = column.length.state === "known" ? column.length.value : null;
  const precision = column.precision.state === "known" ? column.precision.value : null;
  const scale = column.scale.state === "known" ? column.scale.value : null;
  if (length !== null) return `${type}(${length})`;
  if (precision !== null) return `${type}(${precision}${scale === null ? "" : `, ${scale}`})`;
  return type;
}
