import { semanticLabel } from "./labels.mjs";

/**
 * Diagnostic presentation layer.
 *
 * The Generation Core, the Host metadata provider and the Workbench
 * controllers emit machine-readable diagnostics:
 *
 *   { code, severity, blocking, table, column, rule, reason }
 *
 * Core never builds final user copy. This module keeps those fields untouched
 * and derives a localized, human-readable presentation from `code`, so the
 * protocol stays stable while the Workbench can explain *what happened* and
 * *what to do next* in the current UI language.
 */

export const DIAGNOSTIC_LEVELS = Object.freeze(["blocking", "warning", "error", "info", "unsupported", "needs_confirmation"]);

const SEVERITY_LEVELS = Object.freeze({ warning: "warning", error: "error", info: "info", unsupported: "unsupported" });

/**
 * Which word heads the localized diagnostic. A Core blocking flag always wins;
 * a catalog may refine only a non-blocking presentation (for example a warning
 * that is really a confirmation request) and can neither add nor erase blocking.
 * @param {Record<string, unknown>} diagnostic
 * @param {import("./index.mjs").Translator} t
 */
export function diagnosticLevel(diagnostic, t) {
  if (diagnostic?.blocking === true) return "blocking";
  const severity = String(diagnostic?.severity ?? "");
  if (severity !== "warning") return SEVERITY_LEVELS[severity] ?? "error";
  const code = typeof diagnostic?.code === "string" ? diagnostic.code : "unknown";
  const override = t(`diagnostic.${code}.level`);
  return override === "needs_confirmation" && DIAGNOSTIC_LEVELS.includes(override) ? override : "warning";
}

/**
 * Parse the semantic type out of a Core diagnostic rule identity such as
 * `semantic:name:v1`. Returns `null` when the rule is not a semantic rule.
 * @param {unknown} rule
 */
export function semanticTypeFromRule(rule) {
  if (typeof rule !== "string") return null;
  const match = /^semantic:([a-z_]+):/.exec(rule);
  return match ? match[1] : null;
}

/**
 * Localized presentation of one Core diagnostic. Everything the machine
 * contract owns (`code`, `severity`, `blocking`, location, raw `reason`) is
 * preserved verbatim under `technical`.
 * @param {Record<string, unknown>} diagnostic
 * @param {import("./index.mjs").Translator} t
 */
export function describeDiagnostic(diagnostic, t) {
  const code = typeof diagnostic?.code === "string" && diagnostic.code !== "" ? diagnostic.code : "unknown";
  const level = diagnosticLevel(diagnostic, t);
  const semanticType = semanticTypeFromRule(diagnostic?.rule);
  const params = {
    code,
    column: typeof diagnostic?.column === "string" && diagnostic.column !== "" ? diagnostic.column : t("diagnostics.genericColumn"),
    table: typeof diagnostic?.table === "string" ? diagnostic.table : "",
    semantic: semanticType === null ? t("diagnostics.genericSemantic") : semanticLabel(semanticType, t),
    reason: typeof diagnostic?.reason === "string" ? diagnostic.reason : "",
  };
  const copy = diagnosticCopy(code, t, params);
  return Object.freeze({
    code,
    severity: diagnostic?.severity ?? null,
    blocking: diagnostic?.blocking === true,
    level,
    levelLabel: t(`diagnostics.level.${level}`),
    title: copy.title,
    description: copy.description,
    action: copy.action,
    headline: t("diagnostics.headline", { level: t(`diagnostics.level.${level}`), title: copy.title }),
    location: {
      table: typeof diagnostic?.table === "string" ? diagnostic.table : null,
      column: typeof diagnostic?.column === "string" ? diagnostic.column : null,
      rule: typeof diagnostic?.rule === "string" ? diagnostic.rule : null,
    },
    technical: Object.freeze({
      code,
      severity: diagnostic?.severity ?? null,
      blocking: diagnostic?.blocking === true,
      table: typeof diagnostic?.table === "string" ? diagnostic.table : null,
      column: typeof diagnostic?.column === "string" ? diagnostic.column : null,
      rule: typeof diagnostic?.rule === "string" ? diagnostic.rule : null,
      reason: typeof diagnostic?.reason === "string" ? diagnostic.reason : "",
    }),
  });
}

/** @param {Record<string, unknown>[]} diagnostics @param {import("./index.mjs").Translator} t */
export function describeDiagnostics(diagnostics, t) {
  return (Array.isArray(diagnostics) ? diagnostics : []).map((diagnostic) => describeDiagnostic(diagnostic, t));
}

/**
 * Group only diagnostics that have a concrete table and field and share the
 * same code, raw cause, localized suggestion, severity and blocking decision.
 * Each group retains every original diagnostic and its full presentation.
 * @param {Record<string, unknown>[]} diagnostics
 * @param {import("./index.mjs").Translator} t
 */
export function describeDiagnosticGroups(diagnostics, t) {
  const groups = new Map();
  for (const [index, diagnostic] of (Array.isArray(diagnostics) ? diagnostics : []).entries()) {
    const description = describeDiagnostic(diagnostic, t);
    const groupable = typeof diagnostic?.table === "string" && diagnostic.table !== ""
      && typeof diagnostic?.column === "string" && diagnostic.column !== ""
      && typeof diagnostic?.code === "string" && diagnostic.code !== "";
    const key = groupable
      ? JSON.stringify([
        diagnostic.table,
        description.code,
        typeof diagnostic.reason === "string" ? diagnostic.reason : null,
        diagnostic.severity ?? null,
        diagnostic.blocking === true,
        description.action,
        semanticTypeFromRule(diagnostic.rule),
      ])
      : Symbol(`single-diagnostic-${index}`);
    const entry = Object.freeze({ diagnostic, description });
    if (groups.has(key)) groups.get(key).push(entry);
    else groups.set(key, [entry]);
  }

  return [...groups.values()].map((entries) => {
    const first = entries[0].description;
    const count = entries.length;
    if (count === 1) return Object.freeze({ ...first, grouped: false, count, entries });
    const title = t("diagnostics.group.title", { count, title: first.title });
    const groupDescriptionKey = `diagnostic.${first.code}.groupDescription`;
    const description = t.has(groupDescriptionKey)
      ? t(groupDescriptionKey, { count })
      : t("diagnostics.group.description", { count });
    return Object.freeze({
      ...first,
      title,
      description,
      headline: t("diagnostics.headline", { level: first.levelLabel, title }),
      grouped: true,
      count,
      entries,
    });
  });
}

/**
 * Raw technical rows for the collapsible detail section. Values are never
 * translated; only the row labels are. `table` may replace or hide the raw
 * Core table identity when the UI has a safe TableContext label.
 * @param {ReturnType<typeof describeDiagnostic>} description
 * @param {import("./index.mjs").Translator} t
 * @param {{ table?: string | null, metadataRows?: Array<[string, string]> }} [options]
 */
export function diagnosticTechnicalRows(description, t, options = {}) {
  const technical = description.technical;
  const rows = [
    [t("diagnostics.technical.code"), technical.code],
    [t("diagnostics.technical.severity"), String(technical.severity ?? "")],
    [t("diagnostics.technical.blocking"), technical.blocking ? t("diagnostics.technical.yes") : t("diagnostics.technical.no")],
  ];
  const table = Object.hasOwn(options, "table") ? options.table : technical.table;
  if (typeof table === "string" && table !== "") rows.push([t("diagnostics.technical.table"), table]);
  if (technical.column) rows.push([t("diagnostics.technical.column"), technical.column]);
  if (technical.rule) rows.push([t("diagnostics.technical.rule"), technical.rule]);
  if (Array.isArray(options.metadataRows)) rows.push(...options.metadataRows);
  if (technical.reason) rows.push([t("diagnostics.technical.reason"), technical.reason]);
  return rows;
}

/**
 * Safe, value-minimized schema/provenance rows for one column. No sample value,
 * observed range, or generation output is read by this presenter.
 * @param {Record<string, any> | undefined} column
 * @param {import("./index.mjs").Translator} t
 */
export function diagnosticColumnTechnicalRows(column, t) {
  if (!column || typeof column !== "object") return [];
  const rows = [];
  if (column.schemaFacts?.dataType) {
    rows.push([t("diagnostics.technical.dataType"), formatFact(column.schemaFacts.dataType)]);
  }
  if (column.schemaFacts?.precision) {
    rows.push([t("diagnostics.technical.precisionFact"), formatFact(column.schemaFacts.precision)]);
  }
  if (column.temporalPrecision?.declaration) {
    rows.push([t("diagnostics.technical.precisionResolution"), formatPrecisionResolution(column.temporalPrecision.declaration)]);
  }
  if (column.temporalPrecision?.generation) {
    rows.push([t("diagnostics.technical.generationPrecision"), formatPrecisionResolution(column.temporalPrecision.generation)]);
  }
  if (typeof column.rule?.source === "string") {
    rows.push([t("diagnostics.technical.ruleSource"), column.rule.source]);
  }
  return rows;
}

/** @param {Record<string, any>} fact */
function formatFact(fact) {
  const parts = [typeof fact.state === "string" ? fact.state : "unknown"];
  if (parts[0] === "known" && ["string", "number", "boolean"].includes(typeof fact.value)) parts.push(String(fact.value));
  if (typeof fact.provenance === "string" && fact.provenance !== "") parts.push(fact.provenance);
  if (typeof fact.reason === "string" && fact.reason !== "") parts.push(fact.reason);
  return parts.join(" · ");
}

/** @param {Record<string, any>} precision */
function formatPrecisionResolution(precision) {
  const parts = [];
  if (typeof precision.state === "string") parts.push(precision.state);
  if (Number.isSafeInteger(precision.value)) parts.push(String(precision.value));
  if (typeof precision.source === "string") parts.push(precision.source);
  if (typeof precision.provenance === "string" && precision.provenance !== "") parts.push(precision.provenance);
  if (typeof precision.reason === "string" && precision.reason !== "") parts.push(precision.reason);
  return parts.join(" · ");
}

/** @param {string} code @param {import("./index.mjs").Translator} t @param {Record<string, unknown>} params */
function diagnosticCopy(code, t, params) {
  const base = `diagnostic.${code}`;
  if (!t.has(`${base}.title`)) {
    // Unknown / future code: never invent a meaning, show the raw Core message.
    return {
      title: t("diagnostics.fallback.title", params),
      description: t("diagnostics.fallback.description", params),
      action: null,
    };
  }
  return {
    title: t(`${base}.title`, params),
    description: t(`${base}.description`, params),
    action: t.has(`${base}.action`) ? t(`${base}.action`, params) : null,
  };
}
