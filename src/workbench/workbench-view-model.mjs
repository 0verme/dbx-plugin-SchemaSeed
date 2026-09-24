const SEMANTIC_TYPES = new Set(["name", "gender", "birthday", "mobile", "email", "address"]);

/** @param {import("../generation/generation-plan.mjs").ColumnGenerationPlan} column */
export function toColumnViewModel(column) {
  const inference = column.inference;
  const semanticMapping = column.semanticMapping;
  const isSelectedSemantic = semanticMapping.selected && column.rule.kind.startsWith("semantic:");
  const rejectedMapping = ["invalid", "incompatible"].includes(semanticMapping.status)
    && ["explicit_user_semantic_override", "confirmed_semantic_mapping"].includes(semanticMapping.source);
  const mappingStatus = isSelectedSemantic
    ? semanticMapping.source === "confirmed_semantic_mapping" ? "Confirmed" : "Override"
    : rejectedMapping
      ? `${semanticMapping.source === "confirmed_semantic_mapping" ? "Confirmed mapping" : "Override"} incompatible · fallback active`
      : inference.status === "candidate" ? "Needs confirmation · fallback active"
        : inference.status === "ambiguous" ? "Ambiguous · fallback"
          : inference.status === "incompatible" ? "Incompatible · fallback"
            : "Fallback";
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
    selectedMapping: isSelectedSemantic || rejectedMapping ? title(semanticMapping.semanticType) : title(column.rule.kind),
    mappingStatus,
    mappingValue: isSelectedSemantic || rejectedMapping ? semanticMapping.semanticType : "auto",
    canConfirm: !isSelectedSemantic && inference.status === "candidate" && SEMANTIC_TYPES.has(inference.semanticType),
    rule: { kind: column.rule.kind, source: column.rule.source },
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
