/**
 * Page-local advanced-settings draft helpers. Rules and constraints stay in the
 * controller's existing JSON-compatible contracts; this module only clones
 * and compares editor state.
 */
export function createSettingsDraft(rules, constraints, contextKey, schemaKey = null, settingsRevision = null) {
  const baseline = cloneConfiguration({ rules, constraints });
  const current = cloneConfiguration(baseline);
  return {
    contextKey,
    schemaKey,
    settingsRevision,
    rules: current.rules,
    constraints: current.constraints,
    baseline,
  };
}

/** @param {{ rules: unknown, constraints: unknown }} draft */
export function settingsDraftChanged(draft) {
  return !sameSettingsConfiguration(draft, draft?.baseline);
}

/** @param {{ rules: unknown, constraints: unknown }} left @param {{ rules: unknown, constraints: unknown }} right */
export function sameSettingsConfiguration(left, right) {
  return stableSerialize(normalizeRulesForComparison(left?.rules)) === stableSerialize(normalizeRulesForComparison(right?.rules))
    && stableSerialize(left?.constraints ?? []) === stableSerialize(right?.constraints ?? []);
}

/** Count only explicit overrides for real columns in this table and manual constraints. */
export function resettableSettingsCounts(configuration, columns) {
  const rules = isRecord(configuration?.rules) ? configuration.rules : {};
  const names = new Set((Array.isArray(columns) ? columns : [])
    .map((column) => typeof column === "string" ? column : column?.name)
    .filter((name) => typeof name === "string"));
  const fields = [...names].filter((name) => Object.hasOwn(rules, name)
    && !isImplicitAutoRule(rules[name])).length;
  const constraints = Array.isArray(configuration?.constraints) ? configuration.constraints.length : 0;
  return { fields, constraints, total: fields + constraints };
}

/** Remove every current-table override from a draft and return its complete configuration snapshot. */
export function resetSettingsDraft(draft, columns) {
  const counts = resettableSettingsCounts(draft, columns);
  if (counts.total === 0) return { changed: false, counts, snapshot: null };
  const snapshot = cloneConfiguration(draft);
  draft.rules = {};
  draft.constraints = [];
  return { changed: true, counts, snapshot };
}

/** Restore the complete rule/constraint portion of a draft without altering its committed baseline. */
export function restoreSettingsDraft(draft, snapshot) {
  const restored = cloneConfiguration(snapshot);
  draft.rules = restored.rules;
  draft.constraints = restored.constraints;
  return draft;
}

/** A stable schema token binds an open draft to the exact metadata revision it edited. */
export function settingsSchemaFingerprint(schema) {
  return stableSerialize(schema ?? null);
}

function normalizeRulesForComparison(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, rule]) => !isImplicitAutoRule(rule)));
}

function isImplicitAutoRule(rule) {
  return isRecord(rule) && rule.kind === "auto" && Object.keys(rule).length === 1;
}

function cloneConfiguration(value) {
  return {
    rules: structuredClone(isRecord(value?.rules) ? value.rules : {}),
    constraints: structuredClone(Array.isArray(value?.constraints) ? value.constraints : []),
  };
}

function stableSerialize(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
