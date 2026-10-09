/**
 * Page-local advanced-settings draft helpers. Rules and constraints stay in the
 * controller's existing JSON-compatible contracts; this module only clones
 * and compares editor state.
 */
export function createSettingsDraft(rules, constraints, contextKey) {
  const baseline = cloneConfiguration({ rules, constraints });
  const current = cloneConfiguration(baseline);
  return {
    contextKey,
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
  return stableSerialize(left?.rules ?? {}) === stableSerialize(right?.rules ?? {})
    && stableSerialize(left?.constraints ?? []) === stableSerialize(right?.constraints ?? []);
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
