import { SEMANTIC_TYPES } from "../semantic/semantic-inference.mjs";

/** @param {import("../generation/generation-plan.mjs").ColumnGenerationPlan} column @param {import("../diagnostics.mjs").GenerationDiagnostic[]} [diagnostics] */
export function toColumnViewModel(column, diagnostics = []) {
  const inference = column.inference;
  const semanticMapping = column.semanticMapping;
  const generationRule = column.generationRule ?? { kind: "auto" };
  const isSelectedSemantic = semanticMapping.selected && column.rule.kind.startsWith("semantic:");
  const rejectedMapping = ["invalid", "incompatible"].includes(semanticMapping.status)
    && ["explicit_user_semantic_override", "confirmed_semantic_mapping"].includes(semanticMapping.source);
  let mappingStatus;
  if (generationRule.kind !== "auto" && generationRule.kind !== "semantic") {
    mappingStatus = `Explicit · ${title(generationRule.kind)}`;
  } else if (isSelectedSemantic) {
    mappingStatus = semanticMapping.source === "confirmed_semantic_mapping" ? "Confirmed" : "Override";
  } else if (rejectedMapping) {
    mappingStatus = `${semanticMapping.source === "confirmed_semantic_mapping" ? "Confirmed mapping" : "Override"} incompatible · fallback active`;
  } else if (inference.status === "candidate") {
    mappingStatus = "Needs confirmation · fallback active";
  } else if (inference.status === "ambiguous") {
    mappingStatus = "Ambiguous · fallback";
  } else if (inference.status === "incompatible") {
    mappingStatus = "Incompatible · fallback";
  } else {
    mappingStatus = "Fallback";
  }

  const detected = inference.status === "ambiguous"
    ? `Ambiguous · ${inference.candidates.map(title).join(" / ")}`
    : inference.semanticType === "unknown" ? "Unknown" : title(inference.semanticType);
  return {
    column: column.schema.name,
    schemaType: formatSchemaType(column.schema),
    detected,
    detectedType: inference.semanticType,
    candidates: [...inference.candidates],
    confidence: title(inference.confidence),
    selectedMapping: isSelectedSemantic || rejectedMapping
      ? title(semanticMapping.semanticType)
      : generationRule.kind === "semantic"
        ? title(generationRule.semanticType ?? semanticMapping.semanticType)
        : title(column.rule.kind),
    mappingStatus,
    mappingValue: isSelectedSemantic || rejectedMapping ? semanticMapping.semanticType : "auto",
    canConfirm: !isSelectedSemantic && inference.status === "candidate" && SEMANTIC_TYPES.includes(inference.semanticType),
    rule: { kind: column.rule.kind, source: column.rule.source },
    generationRule: { ...generationRule, ...(Array.isArray(generationRule.values) ? { values: [...generationRule.values] } : {}) },
    ruleChoices: column.ruleChoices?.map((choice) => ({ ...choice, draft: { ...choice.draft } })) ?? [],
    semanticTypes: [...(column.semanticTypes ?? [])],
    ruleFields: column.ruleFields?.map((field) => ({ ...field })) ?? [],
    ruleDiagnostics: diagnostics.filter((entry) => entry.column === column.schema.name).map((entry) => ({ ...entry })),
    evidence: [...semanticMapping.evidence],
  };
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
function formatSchemaType(column) {
  const type = column.dataType.state === "known" ? String(column.dataType.value) : title(column.dataType.state);
  const length = column.length.state === "known" ? column.length.value : null;
  const precision = column.precision.state === "known" ? column.precision.value : null;
  const scale = column.scale.state === "known" ? column.scale.value : null;
  if (length !== null) return `${type}(${length})`;
  if (precision !== null) return `${type}(${precision}${scale === null ? "" : `, ${scale}`})`;
  return type;
}

/** @param {string} value */
function title(value) {
  if (value === "unknown") return "Unknown";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
