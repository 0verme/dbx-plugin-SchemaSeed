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

export const DIAGNOSTIC_LEVELS = Object.freeze(["blocking", "warning", "error", "unsupported", "needs_confirmation"]);

const SEVERITY_LEVELS = Object.freeze({ warning: "warning", error: "error", unsupported: "unsupported" });

/**
 * Which word heads the localized diagnostic. A catalog may override the level
 * for a code (for example a non-blocking warning that is really a confirmation
 * request); otherwise the Core severity / blocking flag decides.
 * @param {Record<string, unknown>} diagnostic
 * @param {import("./index.mjs").Translator} t
 */
export function diagnosticLevel(diagnostic, t) {
  const code = typeof diagnostic?.code === "string" ? diagnostic.code : "unknown";
  const override = t(`diagnostic.${code}.level`);
  if (DIAGNOSTIC_LEVELS.includes(override)) return override;
  if (diagnostic?.blocking === true) return "blocking";
  const severity = String(diagnostic?.severity ?? "");
  return SEVERITY_LEVELS[severity] ?? "error";
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
 * Raw technical rows for the collapsible detail section. Values are never
 * translated; only the row labels are.
 * @param {ReturnType<typeof describeDiagnostic>} description
 * @param {import("./index.mjs").Translator} t
 */
export function diagnosticTechnicalRows(description, t) {
  const technical = description.technical;
  const rows = [
    [t("diagnostics.technical.code"), technical.code],
    [t("diagnostics.technical.severity"), String(technical.severity ?? "")],
    [t("diagnostics.technical.blocking"), technical.blocking ? t("diagnostics.technical.yes") : t("diagnostics.technical.no")],
  ];
  if (technical.table) rows.push([t("diagnostics.technical.table"), technical.table]);
  if (technical.column) rows.push([t("diagnostics.technical.column"), technical.column]);
  if (technical.rule) rows.push([t("diagnostics.technical.rule"), technical.rule]);
  if (technical.reason) rows.push([t("diagnostics.technical.reason"), technical.reason]);
  return rows;
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
