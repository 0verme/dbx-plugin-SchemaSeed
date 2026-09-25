import { semanticLabel } from "./labels.mjs";

/**
 * Evidence presentation layer.
 *
 * Generation Core emits machine evidence `{ kind, source, observation,
 * explanation, params }`. The raw `explanation` is an English machine fact and
 * is never treated as user copy. This module derives localized copy from the
 * stable `kind` plus the structured `params`, so the Core contract stays
 * language-independent while zh-CN / en-US users read native text.
 *
 * Unknown future kinds degrade to a safe fallback that never guesses a
 * meaning, and every raw field stays accessible for the "raw evidence"
 * disclosure.
 */

/**
 * @typedef {Object} EvidenceDescription
 * @property {string | null} kind
 * @property {string} sourceLabel
 * @property {string} observation
 * @property {string} explanation
 * @property {boolean} fallback
 * @property {{ kind: string | null, source: string | null, observation: string, explanation: string }} technical
 */

/**
 * Localized presentation of one Core evidence item.
 * @param {Record<string, unknown>} evidence
 * @param {import("./index.mjs").Translator} t
 * @returns {EvidenceDescription}
 */
export function describeEvidence(evidence, t) {
  const record = evidence && typeof evidence === "object" ? evidence : {};
  const kind = typeof record.kind === "string" && record.kind !== "" ? record.kind : null;
  const source = typeof record.source === "string" && record.source !== "" ? record.source : null;
  const params = record.params && typeof record.params === "object" ? record.params : {};
  const technical = Object.freeze({
    kind,
    source,
    observation: typeof record.observation === "string" ? record.observation : "",
    explanation: typeof record.explanation === "string" ? record.explanation : "",
  });
  const localized = kind !== null && t.has(`evidence.${kind}.explanation`);
  return Object.freeze({
    kind,
    sourceLabel: evidenceSourceLabel(source, t),
    observation: localized ? presentationObservation(params, technical.observation, t) : t("evidence.fallback.observation"),
    explanation: localized ? t(`evidence.${kind}.explanation`, presentationParams(params, t)) : t("evidence.fallback.explanation"),
    fallback: !localized,
    technical,
  });
}

/**
 * Raw technical rows for one evidence item. Values are never translated; only
 * the row labels are.
 * @param {EvidenceDescription} description
 * @param {import("./index.mjs").Translator} t
 */
export function evidenceTechnicalRows(description, t) {
  const technical = description.technical;
  const rows = [];
  if (technical.kind) rows.push([t("evidence.technical.kind"), technical.kind]);
  if (technical.source) rows.push([t("evidence.technical.source"), technical.source]);
  if (technical.observation) rows.push([t("evidence.technical.observation"), technical.observation]);
  if (technical.explanation) rows.push([t("evidence.technical.explanation"), technical.explanation]);
  return rows;
}

/**
 * Localized evidence source label. Unknown sources fall back to a neutral
 * label instead of leaking an internal token into the user view.
 * @param {string | null} source
 * @param {import("./index.mjs").Translator} t
 */
export function evidenceSourceLabel(source, t) {
  const key = `evidence.source.${String(source ?? "")}`;
  return t.has(key) ? t(key) : t("evidence.source.unknown");
}

/**
 * User-facing observation. Column names stay verbatim; a semantic alias is
 * shown with the localized semantic label.
 * @param {Record<string, unknown>} params
 * @param {string} rawObservation
 * @param {import("./index.mjs").Translator} t
 */
function presentationObservation(params, rawObservation, t) {
  if (typeof params.column === "string" && typeof params.semantic === "string") {
    return `${params.column} → ${semanticLabel(params.semantic, t)}`;
  }
  if (typeof params.semantic === "string" && rawObservation === params.semantic) {
    return semanticLabel(params.semantic, t);
  }
  return rawObservation;
}

/**
 * Structured evidence params with the semantic type localized for display.
 * Raw machine values stay in `technical`.
 * @param {Record<string, unknown>} params
 * @param {import("./index.mjs").Translator} t
 */
function presentationParams(params, t) {
  return {
    ...params,
    semantic: typeof params.semantic === "string" ? semanticLabel(params.semantic, t) : "",
  };
}
