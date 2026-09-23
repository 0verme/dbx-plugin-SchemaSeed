const SEVERITIES = new Set(["warning", "error", "unsupported"]);

/**
 * @typedef {Object} GenerationDiagnostic
 * @property {"warning" | "error" | "unsupported"} severity
 * @property {string} code
 * @property {string} table
 * @property {string | null} column
 * @property {string | null} rule
 * @property {string} reason
 * @property {boolean} blocking
 */

/** @param {Partial<GenerationDiagnostic> & { severity: string, code: string, reason: string }} input */
export function makeDiagnostic(input) {
  const severity = SEVERITIES.has(input.severity) ? input.severity : "error";
  return Object.freeze({
    severity,
    code: input.code,
    table: input.table || "<unknown-table>",
    column: input.column ?? null,
    rule: input.rule ?? null,
    reason: input.reason,
    blocking: input.blocking ?? severity !== "warning",
  });
}

/** @param {GenerationDiagnostic[]} diagnostics */
export function planStatus(diagnostics) {
  if (diagnostics.some((entry) => entry.blocking)) return "blocked";
  if (diagnostics.length > 0) return "ready_with_warnings";
  return "ready";
}
