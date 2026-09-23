import { makeDiagnostic } from "../diagnostics.mjs";

const PERSON_SEMANTICS = Object.freeze(["name", "gender", "birthday", "mobile", "email", "address"]);

/**
 * Resolve selected semantic columns into one default Person group or explicit
 * fixture/user groups. No name-based clustering is performed here.
 * @param {Array<Record<string, any>>} columns
 * @param {unknown} requestedGroups
 * @param {string} tableIdentity
 * @param {import("../diagnostics.mjs").GenerationDiagnostic[]} diagnostics
 * @returns {{ columns: Array<Record<string, any>>, groups: Array<Record<string, any>> }}
 */
export function resolvePersonGroups(columns, requestedGroups, tableIdentity, diagnostics) {
  const semanticColumns = columns.filter((column) => column.semanticMapping.selected
    && column.rule.kind.startsWith("semantic:"));
  const assignments = new Map();
  const groups = [];

  if (requestedGroups === undefined) {
    if (semanticColumns.length > 0) {
      groups.push(makeGroup("person:default", semanticColumns, tableIdentity, diagnostics));
      for (const column of semanticColumns) assignments.set(column.schema.name, "person:default");
    }
  } else if (!Array.isArray(requestedGroups)) {
    diagnostics.push(groupDiagnostic(tableIdentity, "person_group_conflict", null, "person:groups",
      "personGroups must be an array of { id, columns } declarations"));
  } else {
    const declaredIdentities = new Set();
    for (const requested of requestedGroups) {
      if (!isRecord(requested) || typeof requested.id !== "string" || requested.id.trim() === ""
        || !Array.isArray(requested.columns) || requested.columns.length === 0
        || requested.columns.some((name) => typeof name !== "string" || name.trim() === "")) {
        diagnostics.push(groupDiagnostic(tableIdentity, "person_group_conflict", null, "person:groups",
          "Each Person group needs a non-empty id and a non-empty array of column names"));
        continue;
      }

      const groupIdentity = `person:${requested.id.trim()}`;
      if (declaredIdentities.has(groupIdentity)) {
        diagnostics.push(groupDiagnostic(tableIdentity, "person_group_conflict", null, groupIdentity,
          "Person group identities must be unique"));
        continue;
      }
      declaredIdentities.add(groupIdentity);

      const selected = [];
      for (const columnName of requested.columns) {
        const column = columns.find((entry) => entry.schema.name === columnName);
        if (!column || !column.semanticMapping.selected || !column.rule.kind.startsWith("semantic:")) {
          diagnostics.push(groupDiagnostic(tableIdentity, "person_group_conflict", columnName, groupIdentity,
            "Person group member must reference a column with a selected, compatible Person semantic mapping"));
          continue;
        }
        if (assignments.has(columnName)) {
          diagnostics.push(groupDiagnostic(tableIdentity, "person_group_conflict", columnName, groupIdentity,
            `Column is already assigned to ${assignments.get(columnName)}`));
          continue;
        }
        assignments.set(columnName, groupIdentity);
        selected.push(column);
      }
      if (selected.length > 0) groups.push(makeGroup(groupIdentity, selected, tableIdentity, diagnostics));
    }

    for (const column of semanticColumns) {
      if (!assignments.has(column.schema.name)) {
        diagnostics.push(groupDiagnostic(tableIdentity, "person_group_conflict", column.schema.name, "person:groups",
          "Selected Person semantic column is not assigned to an explicit Person group"));
      }
    }
  }

  const resultColumns = columns.map((column) => {
    const groupIdentity = assignments.get(column.schema.name) ?? null;
    if (groupIdentity === null || !column.semanticMapping.selected || !column.rule.kind.startsWith("semantic:")) {
      return { ...column, personGroupIdentity: groupIdentity };
    }
    return { ...column, personGroupIdentity: groupIdentity };
  });
  return { columns: resultColumns, groups };
}

function makeGroup(groupIdentity, members, tableIdentity, diagnostics) {
  const groupDiagnostics = [];
  const seenRoles = new Set();
  let conflicted = false;
  for (const column of members) {
    const role = column.semanticMapping.semanticType;
    if (seenRoles.has(role)) {
      const diagnostic = groupDiagnostic(tableIdentity, "person_group_conflict", column.schema.name, groupIdentity,
        `A Person group cannot contain more than one ${role} field without an explicit disambiguation rule`);
      diagnostics.push(diagnostic);
      groupDiagnostics.push(diagnostic);
      conflicted = true;
    }
    seenRoles.add(role);
  }

  const missing = PERSON_SEMANTICS.filter((semanticType) => !seenRoles.has(semanticType));
  if (missing.length > 0) {
    const diagnostic = groupDiagnostic(tableIdentity, "person_group_partial", null, groupIdentity,
      `Partial Person group; absent fields are not generated: ${missing.join(", ")}`, false);
    diagnostics.push(diagnostic);
    groupDiagnostics.push(diagnostic);
  }

  return Object.freeze({
    groupIdentity,
    kind: "Person",
    status: conflicted ? "conflicted" : missing.length > 0 ? "partial" : "ready",
    members: Object.freeze(members.map((column) => Object.freeze({
      columnIdentity: column.schema.name,
      role: column.semanticMapping.semanticType,
      semanticType: column.semanticMapping.semanticType,
      evidence: column.semanticMapping.evidence,
    }))),
    diagnostics: Object.freeze(groupDiagnostics),
  });
}

function groupDiagnostic(tableIdentity, code, column, rule, reason, blocking = code === "person_group_conflict") {
  return makeDiagnostic({
    severity: blocking ? "error" : "warning",
    code,
    table: tableIdentity,
    column,
    rule,
    reason,
    blocking,
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
