import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureSchemaMetadataProvider } from "../src/providers/fixture-schema-metadata-provider.mjs";
import { WorkbenchController, WORKBENCH_MAX_ROW_COUNT } from "../src/workbench/workbench-controller.mjs";

const fixtures = new FixtureSchemaMetadataProvider();

function controller(options = {}) {
  return new WorkbenchController({ provider: fixtures, ...options });
}

async function loadFixture(workbench, fixture) {
  await workbench.initialize();
  return workbench.dispatch({ type: "select-fixture", fixture });
}

function planColumn(viewModel, name) {
  return viewModel.plan.columns.find((column) => column.column === name);
}

function diagnostic(viewModel, code) {
  return viewModel.diagnostics.find((entry) => entry.code === code);
}

class InlineFixtureProvider {
  constructor(definitions) {
    this.definitions = definitions;
  }

  async listTableIdentities() {
    return Object.keys(this.definitions).sort();
  }

  async getTableMetadata({ tableIdentity }) {
    const fixture = this.definitions[tableIdentity];
    if (!fixture) throw new Error(`Missing fixture ${tableIdentity}`);
    return structuredClone(fixture);
  }
}

describe("Fixture-driven WorkbenchController", () => {
  it("loads a fixture, builds a plan and generates the default preview", async () => {
    const workbench = controller();
    const initial = await workbench.initialize();

    assert.equal(initial.selectedFixture, "simple_customer");
    assert.equal(initial.controls.rowCount, 20);
    assert.equal(initial.controls.seed, "demo");
    assert.equal(initial.controls.locale, "zh-CN");
    assert.equal(initial.plan.rowCount, 20);
    assert.equal(initial.plan.seed, "demo");
    assert.equal(initial.preview.rows.length, 20);
    assert.equal(initial.plan.determinismProfile, "sha256-addressed-v1");
    assert.equal(initial.plan.mode, "safe_synthetic");
    assert.equal(initial.information[0].code, "safe_synthetic_mode");
    assert.equal(initial.tableContext.tableIdentity, "simple_customer");
    assert.equal(initial.status, "ready_with_warnings");
    assert.equal(initial.export.enabled, true);
    assert.equal(workbench.prepareExport("csv").summary.format, "CSV");
    assert.equal(workbench.prepareExport("json").summary.format, "JSON");
  });

  it("enables both downloads for a warning-free ready plan", async () => {
    const provider = new InlineFixtureProvider({
      simple_id: { tableIdentity: "simple_id", columns: [{ name: "id", dataType: "INTEGER", nullable: false }] },
    });
    const workbench = new WorkbenchController({ provider });
    const state = await workbench.initialize();

    assert.equal(state.status, "ready");
    assert.equal(state.export.enabled, true);
    assert.match(workbench.prepareExport("csv").filename, /\.csv$/);
    assert.match(workbench.prepareExport("json").filename, /\.json$/);
  });

  it("keeps inferred candidates unconfirmed until the user acts", async () => {
    const workbench = controller();
    const viewModel = await loadFixture(workbench, "person_basic");
    const detected = planColumn(viewModel, "customer_name");

    assert.equal(detected.semanticMapping.selected, false);
    assert.equal(detected.rule.source, "schema_type_fallback");
    const display = viewModel.columns.find((column) => column.column === "customer_name");
    assert.equal(display.schemaType, "VARCHAR(64)");
    assert.equal(display.detected, "Name");
    assert.equal(display.confidence, "High");
    assert.ok(display.evidence.some((entry) => entry.source === "column_name"));
    assert.equal(display.mappingStatus, "Needs confirmation · fallback active");
    assert.equal(viewModel.personGroups.length, 0);
    assert.ok(diagnostic(viewModel, "semantic_confirmation_required"));
  });

  it("confirms a detected semantic and rebuilds the GenerationPlan", async () => {
    const workbench = controller();
    await loadFixture(workbench, "person_basic");
    const viewModel = await workbench.dispatch({ type: "confirm-detected", column: "customer_name" });
    const selected = planColumn(viewModel, "customer_name");

    assert.equal(selected.semanticMapping.source, "confirmed_semantic_mapping");
    assert.equal(selected.semanticMapping.selected, true);
    assert.equal(selected.rule.kind, "semantic:name");
    assert.equal(viewModel.columns.find((column) => column.column === "customer_name").mappingStatus, "Confirmed");
    assert.match(viewModel.preview.rows[0].customer_name, /^测试用户/);
    assert.equal(viewModel.personGroups.length, 1);
    assert.equal(viewModel.personGroups[0].identity, "person:default");
  });

  it("applies explicit semantic override and retains unrelated column values", async () => {
    const workbench = controller();
    let viewModel = await loadFixture(workbench, "person_basic");
    viewModel = await workbench.dispatch({ type: "confirm-detected", column: "customer_name" });
    const before = viewModel.preview.rows;
    viewModel = await workbench.dispatch({ type: "set-mapping", column: "customer_name", semanticType: "email" });

    assert.equal(planColumn(viewModel, "customer_name").semanticMapping.source, "explicit_user_semantic_override");
    assert.equal(planColumn(viewModel, "customer_name").rule.kind, "semantic:email");
    assert.equal(viewModel.columns.find((column) => column.column === "customer_name").mappingStatus, "Override");
    assert.match(viewModel.preview.rows[0].customer_name, /@example\.com$/);
    assert.deepEqual(viewModel.preview.rows.map((row) => row.customer_id), before.map((row) => row.customer_id));
  });

  it("returns to schema fallback when Auto / Fallback is selected", async () => {
    const workbench = controller();
    await loadFixture(workbench, "person_basic");
    await workbench.dispatch({ type: "confirm-detected", column: "customer_name" });
    const viewModel = await workbench.dispatch({ type: "set-mapping", column: "customer_name", semanticType: "auto" });

    assert.equal(planColumn(viewModel, "customer_name").semanticMapping.selected, false);
    assert.equal(planColumn(viewModel, "customer_name").rule.source, "schema_type_fallback");
    assert.equal(viewModel.columns.find((column) => column.column === "customer_name").mappingValue, "auto");
  });

  it("regenerates the same preview and export dataset with the same plan and seed", async () => {
    const workbench = controller();
    const initial = await loadFixture(workbench, "simple_customer");
    const initialExport = workbench.prepareExport("json").content;
    const regenerated = await workbench.dispatch({ type: "regenerate" });

    assert.equal(regenerated.plan.seed, initial.plan.seed);
    assert.deepEqual(regenerated.preview.rows, initial.preview.rows);
    assert.deepEqual(regenerated.preview.rows, workbench.currentDataset.rows);
    assert.equal(workbench.prepareExport("json").content, initialExport);
  });

  it("uses a new seed and changes the preview", async () => {
    let sequence = 0;
    const workbench = controller({ seedFactory: () => `new-seed-${++sequence}` });
    const initial = await loadFixture(workbench, "simple_customer");
    const changed = await workbench.dispatch({ type: "new-seed" });

    assert.equal(changed.controls.seed, "new-seed-1");
    assert.notEqual(changed.plan.seed, initial.plan.seed);
    assert.notDeepEqual(changed.preview.rows, initial.preview.rows);
    assert.notEqual(workbench.prepareExport("json").content, JSON.stringify(initial.preview.rows, initial.tableContext.columns, 2));
    assert.deepEqual(JSON.parse(workbench.prepareExport("json").content), changed.preview.rows);
  });

  it("applies supported locale changes through the Core plan", async () => {
    const workbench = controller();
    await loadFixture(workbench, "person_basic");
    const confirmed = await workbench.dispatch({ type: "confirm-detected", column: "customer_name" });
    const english = await workbench.dispatch({ type: "update-controls", controls: { locale: "en" } });

    assert.equal(english.plan.locale, "en");
    assert.match(english.preview.rows[0].customer_name, /^TestUser/);
    assert.notEqual(english.preview.rows[0].customer_name, confirmed.preview.rows[0].customer_name);
  });

  it("rejects Workbench row counts outside 1–100 without changing the prior preview", async () => {
    const workbench = controller();
    const initial = await workbench.initialize();
    assert.equal(WORKBENCH_MAX_ROW_COUNT, 100);
    const invalid = await workbench.dispatch({ type: "update-controls", controls: { rowCount: 101 } });

    assert.equal(invalid.controls.rowCount, initial.controls.rowCount);
    assert.equal(invalid.preview.rows.length, initial.preview.rows.length);
    assert.match(invalid.actionError, /1 to 100/);
  });

  it("blocks an incompatible override and keeps preview rows empty", async () => {
    const provider = new InlineFixtureProvider({
      invalid_birthday: {
        tableIdentity: "invalid_birthday",
        columns: [{ name: "birthday", dataType: "INTEGER", nullable: false }],
      },
    });
    const workbench = new WorkbenchController({ provider });
    await workbench.initialize();
    const blocked = await workbench.dispatch({ type: "set-mapping", column: "birthday", semanticType: "birthday" });

    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.plan.status, "blocked");
    assert.deepEqual(blocked.preview.rows, []);
    assert.equal(blocked.export.enabled, false);
    assert.throws(() => workbench.prepareExport("csv"), (error) => error.code === "export_blocked_plan");
    assert.equal(diagnostic(blocked, "semantic_schema_incompatible").blocking, true);
    const mapping = blocked.columns.find((column) => column.column === "birthday");
    assert.equal(mapping.selectedMapping, "Birthday");
    assert.match(mapping.mappingStatus, /incompatible/);
  });

  it("uses the same generated dataset for preview and JSON after mapping changes", async () => {
    const workbench = controller();
    const initial = await loadFixture(workbench, "person_basic");
    assert.equal(initial.export.enabled, true);
    const before = workbench.prepareExport("json");
    assert.deepEqual(JSON.parse(before.content), initial.preview.rows);

    const mapped = await workbench.dispatch({ type: "set-mapping", column: "customer_name", semanticType: "email" });
    const after = workbench.prepareExport("json");
    assert.notDeepEqual(mapped.preview.rows, initial.preview.rows);
    assert.deepEqual(JSON.parse(after.content), mapped.preview.rows);
    assert.deepEqual(workbench.currentDataset.rows, mapped.preview.rows);
  });

  it("shows a partial Person group warning while keeping preview usable", async () => {
    const workbench = controller();
    await loadFixture(workbench, "person_partial");
    await workbench.dispatch({ type: "confirm-detected", column: "person_name" });
    const partial = await workbench.dispatch({ type: "confirm-detected", column: "person_email" });

    assert.equal(partial.status, "ready_with_warnings");
    assert.equal(partial.personGroups[0].status, "partial");
    assert.ok(diagnostic(partial, "person_group_partial"));
    assert.equal(partial.preview.rows.length, 20);
    assert.equal("person_gender" in partial.preview.rows[0], false);
  });

  it("shows only fixture-declared multiple Person groups", async () => {
    const workbench = controller();
    await loadFixture(workbench, "person_two_groups");
    for (const column of ["customer_name", "customer_mobile", "contact_name", "contact_mobile"]) {
      await workbench.dispatch({ type: "confirm-detected", column });
    }
    const viewModel = workbench.getViewModel();

    assert.deepEqual(viewModel.personGroups.map((group) => group.identity), ["person:customer", "person:contact"]);
    assert.ok(viewModel.personGroups.every((group) => group.status === "partial"));
    assert.equal(viewModel.status, "ready_with_warnings");
  });

  it("uses schema fallback for unknown semantics", async () => {
    const workbench = controller();
    const viewModel = await loadFixture(workbench, "person_ambiguous");
    const remark = viewModel.columns.find((column) => column.column === "remark");

    assert.equal(remark.detected, "Unknown");
    assert.equal(remark.mappingStatus, "Fallback");
    assert.equal(planColumn(viewModel, "remark").rule.source, "schema_type_fallback");
    assert.equal(typeof viewModel.preview.rows[0].remark, "string");
  });

  it("preserves explicit NULL values in the preview ViewModel", async () => {
    const workbench = controller();
    const viewModel = await loadFixture(workbench, "mixed_nullable");

    assert.ok(viewModel.preview.rows.some((row) => row.optional_text === null));
    assert.ok(viewModel.preview.rows.every((row) => "optional_text" in row));
  });

  it("represents an empty fixture source and provider failures without metadata states", async () => {
    const empty = new WorkbenchController({ provider: new InlineFixtureProvider({}) });
    assert.equal((await empty.initialize()).status, "empty");

    const failedProvider = {
      async listTableIdentities() { return ["broken"]; },
      async getTableMetadata() { throw new Error("fixture read failed"); },
    };
    const failed = new WorkbenchController({ provider: failedProvider });
    const result = await failed.initialize();
    assert.equal(result.status, "preview_error");
    assert.match(result.error, /fixture read failed/);
    assert.equal(result.plan, null);
    assert.deepEqual(result.preview.rows, []);
    assert.equal(result.export.enabled, false);
    assert.throws(() => failed.prepareExport("json"), (error) => error.code === "export_no_dataset");
  });
});
