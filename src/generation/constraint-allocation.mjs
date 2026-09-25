import { describeConstraintDomain } from "./constraint-domain.mjs";
import { randomBigIntBelow, randomUnit } from "./generation-identity.mjs";

/**
 * Materialize planned, collision-free value allocation only for constrained
 * columns. Unrelated columns continue through the ordinary cell generator.
 */
export function allocateConstraintRows(plan) {
  const output = new Map();
  const columns = new Map(plan.columns.map((column) => [column.schema.name, column]));
  for (const allocation of plan.constraintPlan.allocations) {
    const columnPlans = allocation.columns.map((name) => columns.get(name));
    const domains = columnPlans.map((column) => describeConstraintDomain(column, plan.rowCount));
    const capacity = domains.reduce((value, domain) => value * domain.capacity, 1n);
    const activeRows = [];
    for (let rowIndex = 0; rowIndex < plan.rowCount; rowIndex += 1) {
      if (allocation.required || columnPlans.every((column) => !plannedNullAt(plan, column, rowIndex))) activeRows.push(rowIndex);
    }
    if (activeRows.length !== allocation.activeRowCount) {
      throw new Error(`Constraint allocation ${allocation.constraintId} no longer matches its planned comparable row count`);
    }
    if (activeRows.length === 0) continue;
    if (capacity < BigInt(activeRows.length)) throw new Error(`Constraint allocation ${allocation.constraintId} exceeded its planned capacity`);
    const offset = capacity === 1n ? 0n : randomBigIntBelow(capacity, [
      "manual-constraint-allocation", plan.seed, plan.table.tableIdentity, allocation.identity,
    ]);
    for (let rank = 0; rank < activeRows.length; rank += 1) {
      const tupleIndex = (offset + BigInt(rank)) % capacity;
      const indices = decomposeMixedRadix(tupleIndex, domains);
      const rowIndex = activeRows[rank];
      let values = output.get(rowIndex);
      if (!values) {
        values = new Map();
        output.set(rowIndex, values);
      }
      for (let index = 0; index < columnPlans.length; index += 1) {
        values.set(columnPlans[index].schema.name, domains[index].decode(indices[index]));
      }
    }
  }
  return output;
}

function decomposeMixedRadix(value, domains) {
  const indices = Array(domains.length).fill(0n);
  let remaining = value;
  for (let index = domains.length - 1; index >= 0; index -= 1) {
    const radix = domains[index].capacity;
    if (radix <= 0n) throw new Error("A tuple domain with zero capacity cannot allocate non-null rows");
    indices[index] = remaining % radix;
    remaining /= radix;
  }
  if (remaining !== 0n) throw new Error("Tuple allocation index exceeded its planned mixed-radix capacity");
  return indices;
}

function plannedNullAt(plan, columnPlan, rowIndex) {
  if (!columnPlan || columnPlan.nullProbability <= 0) return false;
  const identity = [plan.seed, plan.table.tableIdentity, columnPlan.schema.name, String(rowIndex), columnPlan.rule.identity];
  return randomUnit([...identity, "nullable"]) < columnPlan.nullProbability;
}
