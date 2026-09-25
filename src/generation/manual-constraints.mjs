import { sha256Hex } from "./sha256.mjs";
import { makeDiagnostic, planStatus } from "../diagnostics.mjs";
import { randomUnit } from "./generation-identity.mjs";
import { describeConstraintDomain } from "./constraint-domain.mjs";

const KINDS = new Set(["unique", "composite_unique", "required_unique"]);
const FIELDS = Object.freeze({
  unique: ["id", "kind", "column"],
  composite_unique: ["id", "kind", "columns"],
  required_unique: ["id", "kind", "column"],
});

/** Strict Core parser for one explicitly configured SchemaSeed generation constraint. */
export function validateManualConstraint(schema, input) {
  const diagnostics = [];
  const table = schema?.tableIdentity ?? "<unknown-table>";
  const issue = (code, reason, column = null, id = null) => diagnostics.push(makeDiagnostic({
    severity: "error", code, table, column, rule: typeof id === "string" ? `constraint:${id}` : "manual-constraint", reason,
  }));
  if (!isPlainRecord(input)) {
    issue("invalid_constraint_config", "Constraint must be a plain object");
    return { valid: false, constraint: null, diagnostics };
  }
  if (typeof input.kind !== "string" || !KINDS.has(input.kind)) {
    issue("invalid_constraint_kind", `Constraint kind must be one of ${[...KINDS].join(", ")}`, null, input.id);
    return { valid: false, constraint: null, diagnostics };
  }
  const allowed = new Set(FIELDS[input.kind]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  const missing = FIELDS[input.kind].filter((key) => !Object.hasOwn(input, key));
  if (unexpected.length || missing.length) {
    issue("invalid_constraint_config", [
      unexpected.length ? `Unknown field(s): ${unexpected.join(", ")}` : "",
      missing.length ? `Required field(s) missing: ${missing.join(", ")}` : "",
    ].filter(Boolean).join(". "), null, input.id);
    return { valid: false, constraint: null, diagnostics };
  }
  if (typeof input.id !== "string" || input.id.trim() === "") {
    issue("invalid_constraint_config", "Constraint id must be non-empty text");
    return { valid: false, constraint: null, diagnostics };
  }
  const id = input.id.trim();
  const names = input.kind === "composite_unique" ? input.columns : [input.column];
  if (input.kind === "composite_unique") {
    if (!Array.isArray(input.columns)) {
      issue("invalid_constraint_config", "Composite Unique columns must be an ordered array of column names", null, id);
      return { valid: false, constraint: null, diagnostics };
    }
    if (input.columns.length < 2) issue("invalid_constraint_config", "Composite Unique requires at least two different columns", null, id);
  }
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name.trim() === "")) {
    issue("invalid_constraint_config", input.kind === "composite_unique"
      ? "Composite Unique columns must contain non-empty text names"
      : "Constraint column must be non-empty text", null, id);
    return { valid: false, constraint: null, diagnostics };
  }
  const columns = names.map((name) => name);
  const duplicates = columns.filter((name, index) => columns.indexOf(name) !== index);
  if (duplicates.length > 0) issue("duplicate_constraint_column", `Constraint repeats column(s): ${[...new Set(duplicates)].join(", ")}`, duplicates[0], id);
  const knownColumns = new Set((schema?.columns ?? []).map((column) => column.name));
  for (const name of columns) {
    if (!knownColumns.has(name)) issue("unknown_constraint_column", `Constraint refers to unknown column ${name}`, name, id);
  }
  if (input.kind === "composite_unique" && new Set(columns).size < 2) {
    issue("invalid_constraint_config", "Composite Unique requires at least two different columns", columns[0] ?? null, id);
  }
  if (diagnostics.length > 0) return { valid: false, constraint: null, diagnostics };
  const normalized = input.kind === "composite_unique"
    ? Object.freeze({ id, kind: input.kind, columns: Object.freeze([...columns]) })
    : Object.freeze({ id, kind: input.kind, column: columns[0] });
  return { valid: true, constraint: normalized, diagnostics };
}

/** Create an inspectable plan; unknown/cannot-prove capacities always block execution. */
export function buildConstraintPlan(schema, columnPlans, options = {}) {
  const diagnostics = [];
  const constraints = [];
  const raw = options.constraints === undefined ? [] : options.constraints;
  if (!Array.isArray(raw)) {
    diagnostics.push(makeDiagnostic({
      severity: "error", code: "invalid_constraint_config", table: schema.tableIdentity,
      rule: "manual-constraints", reason: "Manual constraints must be an array",
    }));
    return freezePlan(schema, options, constraints, [], diagnostics);
  }
  const columnByName = new Map(columnPlans.map((column) => [column.schema.name, column]));
  const seenIds = new Map();
  const seenConfigs = new Map();
  const parsed = [];

  for (const input of raw) {
    const result = validateManualConstraint(schema, input);
    if (!result.valid) {
      diagnostics.push(...result.diagnostics);
      constraints.push(invalidPlanEntry(input, result.diagnostics));
      continue;
    }
    const config = result.constraint;
    const identity = manualConstraintIdentity(config);
    const planDiagnostics = [];
    const duplicateKey = `${config.kind}:${[...(config.columns ?? [config.column])].sort().join("\u0000")}`;
    const previousId = seenIds.get(config.id) ?? null;
    if (previousId) {
      const diagnostic = constraintDiagnostic(schema, config, "duplicate_constraint", `Constraint id ${config.id} is used more than once`);
      planDiagnostics.push(diagnostic);
      previousId.pendingDiagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
    }
    if (seenConfigs.has(duplicateKey)) {
      const previous = parsed[seenConfigs.get(duplicateKey)];
      const diagnostic = constraintDiagnostic(schema, config, "duplicate_constraint", `Constraint duplicates ${previous.config.kind} on ${columnsOf(previous.config).join(" + ")}`);
      planDiagnostics.push(diagnostic);
      previous.planDiagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
    } else seenConfigs.set(duplicateKey, parsed.length);

    const columnNames = columnsOf(config);
    const domains = columnNames.map((name) => describeConstraintDomain(columnByName.get(name), options.rowCount ?? 0));
    const capacityKnown = domains.every((domain) => domain?.state === "known");
    const capacityValue = capacityKnown ? domains.reduce((value, domain) => value * domain.capacity, 1n) : null;
    const activeRowCount = config.kind === "required_unique"
      ? (options.rowCount ?? 0)
      : countActiveRows(config, columnByName, options);
    const requirements = requirednessProvenance(schema, config);
    const planEntry = {
      id: config.id,
      identity,
      kind: config.kind,
      columns: Object.freeze([...columnNames]),
      normalizedConfiguration: config,
      capacity: capacityKnown
        ? Object.freeze({ state: "known", value: capacityValue.toString() })
        : Object.freeze({ state: "cannot_prove", reason: domains.find((domain) => domain?.state !== "known")?.reason ?? "A finite collision-free domain cannot be proved" }),
      satisfiable: capacityKnown ? activeRowCount <= capacityValue : null,
      activeRowCount,
      requirednessProvenance: Object.freeze(requirements),
      allocationStrategy: capacityKnown ? "planned_index_allocation" : "unsupported",
      blocking: false,
      diagnostics: planDiagnostics,
    };
    const parsedEntry = { config, identity, domains, capacityKnown, capacityValue, activeRowCount, planDiagnostics, planEntry, pendingDiagnostics: [] };
    if (!previousId) seenIds.set(config.id, parsedEntry);
    constraints.push(planEntry);
    parsed.push(parsedEntry);

    if (config.kind === "required_unique") {
      const columnPlan = columnByName.get(config.column);
      if (columnPlan?.generationRule?.kind === "null_ratio" && columnPlan.generationRule.ratio > 0) {
        const diagnostic = constraintDiagnostic(schema, config, "required_rule_conflict",
          `Required + Unique on ${config.column} conflicts with explicit Null Ratio ${columnPlan.generationRule.ratio}; change the rule instead of silently overriding it`, config.column);
        planDiagnostics.push(diagnostic);
        diagnostics.push(diagnostic);
      }
    }

    if (!capacityKnown) {
      const unknownDomain = domains.find((domain) => domain?.state !== "known");
      const unsupportedRule = columnByName.get(columnNames[domains.indexOf(unknownDomain)])?.rule?.kind;
      const code = typeof unsupportedRule === "string" && unsupportedRule.startsWith("semantic:")
        ? "constraint_strategy_unsupported" : "constraint_capacity_unknown";
      const diagnostic = constraintDiagnostic(schema, config, code,
        unknownDomain?.reason ?? "Generation strategy cannot prove a stable enumerable collision-free domain", columnNames[domains.indexOf(unknownDomain)], "unsupported");
      planDiagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
    } else if (activeRowCount > capacityValue) {
      const diagnostic = constraintDiagnostic(schema, config, "constraint_capacity_insufficient",
        `Constraint needs ${activeRowCount} comparable value(s), but its planned domain capacity is ${capacityValue}`, columnNames[0]);
      planDiagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
    }
  }

  for (const entry of parsed) {
    entry.planDiagnostics.push(...entry.pendingDiagnostics);
  }
  const valid = parsed.filter((entry) => !entry.planDiagnostics.some((diagnostic) => diagnostic.blocking));
  const conflictPairs = findIncomparableOverlaps(valid);
  for (const [left, right] of conflictPairs) {
    const reason = `Overlapping constraints ${left.config.id} and ${right.config.id} cannot be jointly allocated with a proven order-independent strategy`;
    for (const entry of [left, right]) {
      const diagnostic = constraintDiagnostic(schema, entry.config, "constraint_conflict", reason, columnsOf(entry.config)[0]);
      entry.planDiagnostics.push(diagnostic);
      entry.planEntry.allocationStrategy = "blocked";
      diagnostics.push(diagnostic);
    }
  }

  const allocations = buildAllocations(parsed, columnByName, options, schema, diagnostics);
  for (const entry of parsed) {
    entry.planEntry.blocking = entry.planDiagnostics.some((diagnostic) => diagnostic.blocking);
    entry.planEntry.diagnostics = Object.freeze([...entry.planDiagnostics]);
  }
  return freezePlan(schema, options, constraints, allocations, diagnostics);
}

/** Independent final-dataset validator. It never repairs or filters rows. */
export function validateDatasetConstraints(rows, constraintPlan) {
  const diagnostics = [];
  if (!Array.isArray(rows) || !constraintPlan || !Array.isArray(constraintPlan.constraints)) {
    const diagnostic = makeDiagnostic({
      severity: "error", code: "constraint_validation_invalid_input", rule: "constraint-validator",
      reason: "Rows and a ConstraintPlan are required for independent validation",
    });
    return { valid: false, diagnostics: [diagnostic], status: "blocked" };
  }
  for (const constraint of constraintPlan.constraints) {
    if (!constraint.normalizedConfiguration || constraint.blocking) continue;
    const config = constraint.normalizedConfiguration;
    const columns = columnsOf(config);
    const seen = new Map();
    for (const [rowIndex, row] of rows.entries()) {
      const values = columns.map((column) => row && Object.hasOwn(row, column) ? row[column] : undefined);
      if (config.kind === "required_unique" && values.some((value) => value === null || value === undefined)) {
        diagnostics.push(makeDiagnostic({
          severity: "error", code: "constraint_required_violation", table: constraintPlan.tableIdentity,
          column: config.column, rule: `constraint:${config.id}`,
          reason: `Row ${rowIndex + 1} is missing a non-null value required by SchemaSeed Required + Unique`,
        }));
        continue;
      }
      if (values.some((value) => value === undefined)) {
        const missingIndex = values.indexOf(undefined);
        diagnostics.push(makeDiagnostic({
          severity: "error",
          code: config.kind === "composite_unique" ? "constraint_composite_unique_violation" : "constraint_unique_violation",
          table: constraintPlan.tableIdentity, column: columns[missingIndex],
          rule: `constraint:${config.id}`, reason: `Row ${rowIndex + 1} is missing a constrained value`,
        }));
        continue;
      }
      if (values.some((value) => value === null)) continue;
      const identity = JSON.stringify(values.map(typedCanonicalIdentity));
      if (seen.has(identity)) {
        diagnostics.push(makeDiagnostic({
          severity: "error",
          code: config.kind === "composite_unique" ? "constraint_composite_unique_violation" :
            config.kind === "required_unique" ? "constraint_unique_violation" : "constraint_unique_violation",
          table: constraintPlan.tableIdentity,
          column: columns[0],
          rule: `constraint:${config.id}`,
          reason: `Rows ${seen.get(identity) + 1} and ${rowIndex + 1} have the same typed ${config.kind === "composite_unique" ? "ordered tuple" : "value"}`,
        }));
      } else seen.set(identity, rowIndex);
    }
  }
  return { valid: diagnostics.length === 0, diagnostics, status: diagnostics.length ? "blocked" : planStatus([]) };
}

export function manualConstraintIdentity(config) {
  const canonical = canonicalSerialize(config);
  const digest = sha256Hex(`SchemaSeed.ManualConstraint.v1\0${canonical}`);
  return `constraint:${config.kind}:v1:${digest.slice(0, 24)}`;
}

function buildAllocations(parsed, columnByName, options, schema, diagnostics) {
  const usable = parsed.filter((entry) => !entry.planDiagnostics.some((diagnostic) => diagnostic.blocking));
  const components = connectedComponents(usable);
  const allocations = [];
  for (const component of components) {
    if (component.some((entry) => entry.planDiagnostics.some((diagnostic) => diagnostic.blocking))) continue;
    const orderedComponent = [...component].sort((left, right) => left.identity.localeCompare(right.identity));
    const minimal = orderedComponent.filter((entry) => !orderedComponent.some((other) =>
      other !== entry && isProperSubset(new Set(columnsOf(other.config)), new Set(columnsOf(entry.config)))));
    const minimalSets = [];
    for (const entry of minimal) {
      const key = [...columnsOf(entry.config)].sort().join("\u0000");
      if (!minimalSets.some((item) => item.key === key)) minimalSets.push({ key, entry });
    }
    for (const { entry } of minimalSets) {
      const names = columnsOf(entry.config);
      const domains = names.map((name) => describeConstraintDomain(columnByName.get(name), options.rowCount ?? 0));
      if (domains.some((domain) => domain?.state !== "known")) continue;
      const required = component.some((candidate) => candidate.config.kind === "required_unique"
        && sameSet(new Set(columnsOf(candidate.config)), new Set(names)));
      const intrinsic = names.some((name) => describeConstraintDomain(columnByName.get(name), options.rowCount ?? 0).intrinsicUnique);
      const strategy = intrinsic ? "existing_rule_injective" : names.length === 1 ? "single_domain_index" : "mixed_radix_tuple_index";
      for (const related of component.filter((candidate) => isSubset(new Set(names), new Set(columnsOf(candidate.config))))) {
        related.planEntry.allocationStrategy = strategy;
      }
      if (intrinsic) continue;
      allocations.push(Object.freeze({
        constraintId: entry.config.id,
        identity: entry.identity,
        kind: names.length === 1 ? "unique" : "composite_unique",
        columns: Object.freeze([...names]),
        required,
        rowCount: options.rowCount ?? 0,
        activeRowCount: countActiveRows(entry.config, columnByName, options, required),
        capacity: domains.reduce((value, domain) => value * domain.capacity, 1n).toString(),
      }));
    }
  }
  return Object.freeze(allocations);
}

function findIncomparableOverlaps(entries) {
  const pairs = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const a = new Set(columnsOf(entries[left].config));
      const b = new Set(columnsOf(entries[right].config));
      const overlap = [...a].some((column) => b.has(column));
      if (overlap && !isSubset(a, b) && !isSubset(b, a)) pairs.push([entries[left], entries[right]]);
    }
  }
  return pairs;
}

function connectedComponents(entries) {
  const remaining = new Set(entries);
  const components = [];
  while (remaining.size) {
    const seed = remaining.values().next().value;
    remaining.delete(seed);
    const component = [seed];
    for (let index = 0; index < component.length; index += 1) {
      const names = new Set(columnsOf(component[index].config));
      for (const candidate of [...remaining]) {
        if (columnsOf(candidate.config).some((column) => names.has(column))) {
          remaining.delete(candidate);
          component.push(candidate);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function countActiveRows(config, columnByName, options, forcedRequired = false) {
  let count = 0;
  for (let rowIndex = 0; rowIndex < (options.rowCount ?? 0); rowIndex += 1) {
    const active = forcedRequired || config.kind === "required_unique"
      ? true
      : columnsOf(config).every((name) => !plannedNullAt(columnByName.get(name), rowIndex, options));
    if (active) count += 1;
  }
  return count;
}

function plannedNullAt(columnPlan, rowIndex, options) {
  if (!columnPlan || columnPlan.nullProbability <= 0) return false;
  const identity = [options.seed, options.tableIdentity ?? "", columnPlan.schema.name, String(rowIndex), columnPlan.rule.identity];
  return randomUnit([...identity, "nullable"]) < columnPlan.nullProbability;
}

function requirednessProvenance(schema, config) {
  const output = [];
  for (const columnName of columnsOf(config)) {
    const column = schema.columns.find((candidate) => candidate.name === columnName);
    if (column?.nullable.state === "known" && column.nullable.value === false) {
      output.push(Object.freeze({
        column: columnName,
        source: "schema_required",
        schemaFact: Object.freeze({
          state: "known", value: false,
          ...(column.nullable.provenance ? { provenance: column.nullable.provenance } : {}),
        }),
      }));
    }
    if (config.kind === "required_unique") output.push(Object.freeze({ column: columnName, source: "manual_generation_required" }));
  }
  return output;
}

function invalidPlanEntry(input, diagnostics) {
  const id = isPlainRecord(input) && typeof input.id === "string" ? input.id : null;
  const kind = isPlainRecord(input) && typeof input.kind === "string" ? input.kind : "invalid";
  const columns = isPlainRecord(input)
    ? (Array.isArray(input.columns) ? input.columns.filter((entry) => typeof entry === "string")
      : typeof input.column === "string" ? [input.column] : [])
    : [];
  return {
    id,
    identity: null,
    kind,
    columns: Object.freeze(columns),
    normalizedConfiguration: null,
    capacity: Object.freeze({ state: "unsupported", reason: "Invalid manual constraint configuration" }),
    satisfiable: false,
    activeRowCount: null,
    requirednessProvenance: Object.freeze([]),
    allocationStrategy: "blocked",
    blocking: true,
    diagnostics: Object.freeze([...diagnostics]),
  };
}

function constraintDiagnostic(schema, config, code, reason, column = columnsOf(config)[0] ?? null, severity = "error") {
  return makeDiagnostic({ severity, code, table: schema.tableIdentity, column,
    rule: `constraint:${config.id}`, reason, blocking: true });
}

function freezePlan(schema, options, constraints, allocations, diagnostics) {
  const frozenDiagnostics = Object.freeze([...diagnostics]);
  const frozenConstraints = Object.freeze(constraints.map((constraint) => Object.freeze({
    ...constraint,
    columns: Object.freeze([...(constraint.columns ?? [])]),
    requirednessProvenance: Object.freeze([...(constraint.requirednessProvenance ?? [])]),
    diagnostics: Object.freeze([...(constraint.diagnostics ?? [])]),
  })));
  return Object.freeze({
    tableIdentity: schema.tableIdentity,
    rowCount: options.rowCount ?? 0,
    constraints: frozenConstraints,
    allocations: Object.freeze([...allocations]),
    diagnostics: frozenDiagnostics,
    blocking: frozenDiagnostics.some((entry) => entry.blocking),
    status: planStatus(frozenDiagnostics),
  });
}

function columnsOf(config) {
  return config.kind === "composite_unique" ? [...config.columns] : [config.column];
}

function isSubset(left, right) {
  return [...left].every((value) => right.has(value));
}

function isProperSubset(left, right) {
  return left.size < right.size && isSubset(left, right);
}

function sameSet(left, right) {
  return left.size === right.size && isSubset(left, right);
}

function typedCanonicalIdentity(value) {
  if (value === null) return ["null", null];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "undefined") return ["undefined", null];
  if (Array.isArray(value)) return ["array", value.map(typedCanonicalIdentity)];
  if (typeof value === "object") return ["object", Object.keys(value).sort().map((key) => [key, typedCanonicalIdentity(value[key])])];
  return [typeof value, String(value)];
}

function canonicalSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`).join(",")}}`;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
