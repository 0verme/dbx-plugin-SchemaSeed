import { diagnosticLevel } from "../i18n/diagnostics.mjs";

/**
 * Workbench section disclosure model.
 *
 * The production Workbench keeps the result surfaces first: the table context
 * and the data preview stay visible, while the advanced configuration
 * (columns / generation strategy, generation constraints, diagnostics) starts
 * collapsed. This module owns the parts of that disclosure behavior that can
 * be decided without a DOM:
 *
 *  - the localized one-line summary of a collapsed section,
 *  - the default expansion for the first render,
 *  - whether a newly appeared blocking error must force diagnostics open.
 *
 * It derives everything from the controller view model. It never changes
 * generation state, plan or dataset, and it never exposes raw Core enums.
 */

/** @typedef {"none" | "info" | "warning" | "error"} SectionSummarySeverity */

/** @type {Readonly<Record<string, boolean>>} */
export const WORKBENCH_SECTION_DEFAULTS = Object.freeze({
  columns: false,
  constraints: false,
  diagnostics: false,
  preview: true,
});

/**
 * True when one Core / provider diagnostic must block generation. The
 * presentation level comes from `src/i18n/diagnostics.mjs`, so a catalog
 * override (for example `semantic_confirmation_required` → needs confirmation)
 * is honored while the machine `blocking` flag stays authoritative.
 * @param {Record<string, unknown>} diagnostic
 * @param {import("../i18n/index.mjs").Translator} t
 */
export function isBlockingDiagnostic(diagnostic, t) {
  return diagnosticLevel(diagnostic, t) === "blocking";
}

/**
 * Describe current plan impact without inferring it from severity. The Core
 * `blocking` flag remains authoritative; preview/export availability comes
 * from the current view model, and SQL export never executes a database write.
 * @param {Record<string, unknown>} diagnostic
 * @param {Record<string, any>} viewModel
 * @param {import("../i18n/index.mjs").Translator} t
 */
export function diagnosticImpactMessage(diagnostic, viewModel, t) {
  if (diagnostic?.blocking === true) return t("diagnostics.impact.blocking");
  if (viewModel?.status === "blocked" || viewModel?.status === "error" || viewModel?.plan?.status === "blocked") {
    return t("diagnostics.impact.otherBlocker");
  }
  if (viewModel?.export?.enabled === true && viewModel?.draftChanged !== true
    && viewModel?.lastSuccessfulParametersCurrent !== false) {
    return t("diagnostics.impact.available");
  }
  return t("diagnostics.impact.pending");
}

/**
 * User-facing table context. DBX Connection IDs and internal tableIdentity are
 * deliberately omitted; callers render the returned label as plain text.
 * @param {unknown} context
 */
export function tableContextLabel(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const parts = [];
  for (const field of ["database", "schema", "table"]) {
    const value = context[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    const segment = value.trim();
    if (parts.at(-1) !== segment) parts.push(segment);
  }
  return parts.length > 0 ? parts.join(".") : null;
}

/**
 * Count the blocking diagnostics behind a view model. When the controller is
 * already blocked / failed but no diagnostic detail is available, the state
 * itself still counts as one blocking problem, so the collapsed header never
 * claims "no issues" for a blocked workspace.
 * @param {Record<string, any>} viewModel
 * @param {import("../i18n/index.mjs").Translator} t
 */
export function blockingDiagnosticCount(viewModel, t) {
  return diagnosticSummaryCounts(viewModel, t).blocking;
}

/**
 * Split current diagnostics into localized severity / blocking buckets for
 * the collapsed summary. Core severity / blocking flags are mapped to copy
 * only; no enum or diagnostic code is exposed here.
 * @param {Record<string, any>} viewModel
 * @param {import("../i18n/index.mjs").Translator} t
 */
export function diagnosticSummaryCounts(viewModel, t) {
  const diagnostics = Array.isArray(viewModel?.diagnostics) ? viewModel.diagnostics : [];
  const counts = { blocking: 0, pending: 0, issues: 0, info: 0 };
  for (const diagnostic of diagnostics) {
    const level = diagnosticLevel(diagnostic, t);
    if (level === "blocking") counts.blocking += 1;
    else if (level === "warning" || level === "needs_confirmation") counts.pending += 1;
    else if (level === "info") counts.info += 1;
    else counts.issues += 1;
  }
  if (diagnostics.length === 0 && (viewModel?.status === "blocked" || viewModel?.status === "error")) {
    counts.blocking = 1;
  }
  return counts;
}

/**
 * Expansion state for the first render: the three advanced sections stay
 * collapsed, Preview stays expanded, and a workspace that is already blocked
 * opens Diagnostics immediately so the blocking reason is visible.
 * @param {Record<string, any>} viewModel
 * @param {import("../i18n/index.mjs").Translator} t
 * @returns {{ columns: boolean, constraints: boolean, diagnostics: boolean, preview: boolean }}
 */
export function initialSectionExpansion(viewModel, t) {
  return {
    columns: WORKBENCH_SECTION_DEFAULTS.columns,
    constraints: WORKBENCH_SECTION_DEFAULTS.constraints,
    diagnostics: blockingDiagnosticCount(viewModel, t) > 0,
    preview: WORKBENCH_SECTION_DEFAULTS.preview,
  };
}

/**
 * A blocking error that appears during this page session opens Diagnostics
 * automatically. A warning never does, and once Diagnostics is already open /
 * blocked the user remains free to collapse it again.
 * @param {number} previousBlockingCount
 * @param {number} blockingCount
 */
export function shouldAutoExpandDiagnostics(previousBlockingCount, blockingCount) {
  return blockingCount > 0 && previousBlockingCount === 0;
}

/**
 * Localized one-line summary for every collapsible section. `severity` selects
 * the info / warning / error color; `blockingCount` drives auto-expansion.
 * @param {Record<string, any>} viewModel
 * @param {import("../i18n/index.mjs").Translator} t
 */
export function sectionSummaries(viewModel, t) {
  const counts = diagnosticSummaryCounts(viewModel, t);
  return Object.freeze({
    columns: columnsSummary(viewModel, t),
    constraints: constraintsSummary(viewModel, t),
    diagnostics: diagnosticsSummary(viewModel, counts, t),
    blockingCount: counts.blocking,
  });
}

/** @param {Record<string, any>} viewModel @param {import("../i18n/index.mjs").Translator} t @returns {{ text: string, severity: SectionSummarySeverity }} */
function columnsSummary(viewModel, t) {
  const columns = Array.isArray(viewModel?.columns) ? viewModel.columns : [];
  const pending = columns.filter((column) => column?.mappingStatusToken === "needsConfirmation" || column?.mappingStatusToken === "ambiguous").length;
  return {
    text: pending > 0
      ? t("columns.summaryPending", { count: columns.length, pending })
      : t("columns.summary", { count: columns.length }),
    severity: pending > 0 ? "warning" : "none",
  };
}

/** @param {Record<string, any>} viewModel @param {import("../i18n/index.mjs").Translator} t @returns {{ text: string, severity: SectionSummarySeverity }} */
function constraintsSummary(viewModel, t) {
  const constraints = Array.isArray(viewModel?.constraints) ? viewModel.constraints : [];
  return {
    text: constraints.length === 0
      ? t("constraints.summary.none")
      : t("constraints.summary.count", { count: constraints.length }),
    severity: viewModel?.constraintPlan?.blocking === true ? "error" : "none",
  };
}

/** @param {Record<string, any>} viewModel @param {{ blocking: number, pending: number, issues: number, info: number }} counts @param {import("../i18n/index.mjs").Translator} t @returns {{ text: string, severity: SectionSummarySeverity }} */
function diagnosticsSummary(viewModel, counts, t) {
  if (counts.blocking === 0 && counts.pending === 0 && counts.issues === 0 && counts.info === 0) {
    return {
      text: viewModel?.status === "loading" ? t("diagnostics.summary.loading") : t("diagnostics.summary.none"),
      severity: "none",
    };
  }
  const parts = [];
  if (counts.blocking > 0) parts.push(t("diagnostics.summary.errors", { count: counts.blocking }));
  if (counts.pending > 0) parts.push(t("diagnostics.summary.pending", { count: counts.pending }));
  if (counts.issues > 0) parts.push(t("diagnostics.summary.issues", { count: counts.issues }));
  if (counts.info > 0) parts.push(t("diagnostics.summary.info", { count: counts.info }));
  return {
    text: parts.join(" · "),
    severity: counts.blocking > 0 ? "error" : counts.pending > 0 || counts.issues > 0 ? "warning" : "info",
  };
}
