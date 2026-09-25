/**
 * Presentation label resolvers for Workbench enum values.
 *
 * Internal enums (`mappingStatus`, generator kinds, semantic types, confidence,
 * constraint kinds) are protocol data and do not change here. This module only
 * turns those machine values into localized copy, and every resolver falls back
 * to the Core-provided label or the raw identifier when a translation is
 * missing, so an unknown future enum value cannot break a render pass.
 */

/**
 * mappingStatus tokens → message keys. The token is the stable presentation
 * contract; the copy behind it is localized.
 */
export const MAPPING_STATUS_TOKENS = Object.freeze({
  explicit: "mappingStatus.explicit",
  confirmed: "mappingStatus.confirmed",
  override: "mappingStatus.override",
  confirmedIncompatible: "mappingStatus.confirmedIncompatible",
  overrideIncompatible: "mappingStatus.overrideIncompatible",
  needsConfirmation: "mappingStatus.needsConfirmation",
  ambiguous: "mappingStatus.ambiguous",
  incompatible: "mappingStatus.incompatible",
  fallback: "mappingStatus.fallback",
});

/** @param {string} token @param {import("./index.mjs").Translator} t @param {Record<string, unknown>} [params] */
export function mappingStatusLabel(token, t, params) {
  const key = MAPPING_STATUS_TOKENS[token];
  return key ? t(key, params) : t(MAPPING_STATUS_TOKENS.fallback);
}

/** @param {unknown} confidence @param {import("./index.mjs").Translator} t */
export function confidenceLabel(confidence, t) {
  const key = `confidence.${String(confidence)}`;
  return t.has(key) ? t(key) : t("confidence.unknown");
}

/** @param {unknown} semanticType @param {import("./index.mjs").Translator} t */
export function semanticLabel(semanticType, t) {
  const key = `semantic.${String(semanticType)}`;
  // An unknown semantic type is a technical identifier; show it unchanged
  // instead of pretending the column is unidentified.
  return t.has(key) ? t(key) : String(semanticType ?? "");
}

/**
 * @param {{ detectedKey: string, detectedType: string, candidates: string[] }} detected
 * @param {import("./index.mjs").Translator} t
 */
export function detectedLabel(detected, t) {
  if (detected.detectedKey === "ambiguous") {
    return t("detected.ambiguous", {
      candidates: detected.candidates.map((candidate) => semanticLabel(candidate, t)).join(" / "),
    });
  }
  return semanticLabel(detected.detectedType, t);
}

/**
 * @param {unknown} kind
 * @param {import("./index.mjs").Translator} t
 * @param {string | null} [coreLabel] label supplied by the Generation Core
 */
export function ruleKindLabel(kind, t, coreLabel = null) {
  const key = `ruleKind.${String(kind)}`;
  if (t.has(key)) return t(key);
  if (typeof coreLabel === "string" && coreLabel !== "") return coreLabel;
  return titleCaseToken(String(kind ?? ""));
}

/**
 * Rule editor field labels depend on the rule kind for a few keys (`start` /
 * `end` mean a date for `date_range` and a timestamp for `timestamp_range`).
 * @param {{ key: string, label?: string }} field
 * @param {string} ruleKind
 * @param {import("./index.mjs").Translator} t
 */
export function ruleFieldLabel(field, ruleKind, t) {
  for (const key of [`ruleField.${ruleKind}.${field.key}`, `ruleField.${field.key}`]) {
    if (t.has(key)) return t(key);
  }
  return typeof field.label === "string" && field.label !== "" ? field.label : titleCaseToken(field.key);
}

/** @param {unknown} kind @param {import("./index.mjs").Translator} t */
export function constraintKindLabel(kind, t) {
  const key = `constraints.kind.${String(kind)}`;
  return t.has(key) ? t(key) : String(kind ?? "");
}

/** @param {import("./index.mjs").Translator} t */
export function constraintKindOptions(t) {
  return ["unique", "composite_unique", "required_unique"].map((kind) => ({ kind, label: constraintKindLabel(kind, t) }));
}

/**
 * Effective generator shown in the strategy column. `column.rule.kind` is a Core
 * machine value: a schema type family, `unsupported`, or `semantic:<type>`.
 * @param {unknown} kind
 * @param {import("./index.mjs").Translator} t
 */
export function generatorKindLabel(kind, t) {
  const value = String(kind ?? "");
  if (value.startsWith("semantic:")) return semanticLabel(value.slice("semantic:".length), t);
  for (const key of [`generatorKind.${value}`, `ruleKind.${value}`]) {
    if (t.has(key)) return t(key);
  }
  return value === "" ? "" : titleCaseToken(value);
}

/**
 * Source of the effective generation rule as reported by the Core.
 * @param {unknown} source
 * @param {import("./index.mjs").Translator} t
 */
export function ruleSourceLabel(source, t) {
  const key = `ruleSource.${String(source)}`;
  if (t.has(key)) return t(key);
  return String(source ?? "").replaceAll("_", " ");
}

/** @param {unknown} satisfiable @param {import("./index.mjs").Translator} t */
export function constraintSatisfiableLabel(satisfiable, t) {
  if (satisfiable === true) return t("constraints.satisfiable.yes");
  if (satisfiable === false) return t("constraints.satisfiable.no");
  return t("constraints.satisfiable.unknown");
}

/**
 * @param {{ capacity?: { state?: string, value?: unknown }, satisfiable?: unknown, blocking?: boolean } | null | undefined} plan
 * @param {import("./index.mjs").Translator} t
 */
export function constraintPlanLabel(plan, t) {
  if (!plan) return t("constraints.plan.pending");
  const capacity = plan.capacity?.state === "known" ? String(plan.capacity.value) : t("constraints.capacity.unknown");
  return t("constraints.plan.ready", {
    satisfiable: constraintSatisfiableLabel(plan.satisfiable, t),
    capacity,
    blocked: plan.blocking ? t("constraints.plan.blockedSuffix") : "",
  });
}

/** @param {unknown} state @param {import("./index.mjs").Translator} t */
export function schemaTypeStateLabel(state, t) {
  const key = `schemaType.state.${String(state)}`;
  return t.has(key) ? t(key) : titleCaseToken(String(state ?? ""));
}

/** Legacy Core display behavior: `random_integer` → `Random Integer`. @param {string} value */
export function titleCaseToken(value) {
  return String(value ?? "").replaceAll("_", " ").replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}
