import { GENERATION_PREVIEW_METHOD } from "../src/generation/generation-runtime-contract.mjs";
import { describeDiagnostic, describeDiagnostics, diagnosticTechnicalRows } from "../src/i18n/diagnostics.mjs";
import { describeEvidence, evidenceTechnicalRows } from "../src/i18n/evidence.mjs";
import { createI18n, SUPPORTED_UI_LOCALES } from "../src/i18n/index.mjs";
import { constraintKindOptions, constraintPlanLabel } from "../src/i18n/labels.mjs";
import { browserUiLocaleStorage, createUiLocaleStore, readHostLocale } from "../src/i18n/ui-locale.mjs";
import {
  actionErrorMessage,
  constraintEditorStateMessage,
  diagnosticsEmptyMessage,
  exportDisabledHint,
  exportErrorMessage,
  exportResultMessage,
  exportStatusMessage,
  previewSummary,
  ruleEditorStateMessage,
  stateMessage,
  statusLabel,
} from "../src/i18n/workbench-messages.mjs";
import { DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";

const WORKBENCH_MARKUP = `
  <div class="sswb">
    <header class="sswb-header">
      <div class="sswb-brand"><span class="sswb-mark" aria-hidden="true">S</span><div><h1>SchemaSeed <span data-i18n="app.titleSuffix"></span></h1><p data-i18n="app.subtitle"></p></div></div>
      <label class="sswb-ui-locale"><span data-i18n="controls.uiLocale"></span><select id="sswb-ui-locale" name="uiLocale"></select></label>
      <span id="sswb-status" class="sswb-status" role="status" aria-live="polite"></span>
    </header>
    <main class="sswb-main">
      <section class="sswb-panel" aria-labelledby="sswb-context-title">
        <div class="sswb-heading"><div><h2 id="sswb-context-title" data-i18n="context.title"></h2><p class="sswb-caption" data-i18n="context.caption"></p></div><span class="sswb-context-tag">DBX HOST</span></div>
        <div class="sswb-context-grid">
          <div><span data-i18n="context.database"></span><strong id="sswb-database">—</strong></div>
          <div><span data-i18n="context.schema"></span><strong id="sswb-schema">—</strong></div>
          <div><span data-i18n="context.table"></span><strong id="sswb-table">—</strong></div>
        </div>
        <form id="sswb-controls" class="sswb-controls">
          <label><span data-i18n="controls.rows"></span> <small data-i18n="controls.rowsRange"></small><input id="sswb-rows" name="rowCount" type="number" min="1" max="100" value="20" required></label>
          <label><span data-i18n="controls.seed"></span><input id="sswb-seed" name="seed" type="text" value="demo" maxlength="128"></label>
          <label><span data-i18n="controls.dataLocale"></span><select id="sswb-locale" name="locale"><option value="zh-CN">zh-CN</option><option value="en">en</option></select></label>
          <div class="sswb-actions"><button class="sswb-button sswb-primary" type="button" data-sswb-action="generate" data-i18n="actions.generate"></button><button class="sswb-button" type="button" data-sswb-action="regenerate-same-seed" data-i18n="actions.regenerateSameSeed"></button><button class="sswb-button" type="button" data-sswb-action="new-seed" data-i18n="actions.newSeed"></button></div>
        </form>
        <p class="sswb-locale-note" data-i18n="controls.localeNote"></p>
        <p id="sswb-action-error" class="sswb-inline-error" role="alert" hidden></p>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-columns-title">
        <div class="sswb-heading"><div><h2 id="sswb-columns-title" data-i18n="columns.title"></h2><p class="sswb-caption" data-i18n="columns.caption"></p></div></div>
        <div class="sswb-scroll"><table class="sswb-mapping"><thead><tr><th data-i18n="columns.header.column"></th><th data-i18n="columns.header.schemaType"></th><th data-i18n="columns.header.strategy"></th><th data-i18n="columns.header.mappingStatus"></th><th data-i18n="columns.header.rules"></th></tr></thead><tbody id="sswb-columns"></tbody></table></div>
        <div id="sswb-rule-state" class="sswb-rule-slot" role="status"></div>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-constraints-title">
        <div class="sswb-heading"><div><h2 id="sswb-constraints-title" data-i18n="constraints.title"></h2><p class="sswb-caption" data-i18n="constraints.caption"></p></div><button class="sswb-button" type="button" data-constraint-add data-i18n="constraints.add"></button></div>
        <div class="sswb-scroll"><table class="sswb-constraints"><thead><tr><th data-i18n="constraints.header.kind"></th><th data-i18n="constraints.header.columns"></th><th data-i18n="constraints.header.plan"></th><th></th></tr></thead><tbody id="sswb-constraints-body"></tbody></table></div>
        <div id="sswb-constraint-state" class="sswb-rule-slot" role="status"></div>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-diagnostics-title">
        <div class="sswb-heading"><div><h2 id="sswb-diagnostics-title" data-i18n="diagnostics.title"></h2><p class="sswb-caption" data-i18n="diagnostics.caption"></p></div></div>
        <div id="sswb-diagnostics" class="sswb-diagnostics"></div>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-preview-title">
        <div class="sswb-heading"><div><h2 id="sswb-preview-title" data-i18n="preview.title"></h2><p id="sswb-preview-summary" class="sswb-caption"></p></div><span class="sswb-readonly" data-i18n="preview.readonly"></span></div>
        <p id="sswb-state-message" class="sswb-state-message" role="status"></p>
        <p id="sswb-safe-notice" class="sswb-safe-notice"></p>
        <div class="sswb-export-row"><div><button id="sswb-export-csv" class="sswb-button" type="button" data-sswb-export="csv" data-i18n="export.csv" disabled></button><button id="sswb-export-json" class="sswb-button" type="button" data-sswb-export="json" data-i18n="export.json" disabled></button><button id="sswb-export-sql" class="sswb-button" type="button" data-sswb-export="sql" data-i18n="export.sql" disabled></button></div><span id="sswb-export-message" role="status" aria-live="polite"></span></div>
        <div class="sswb-scroll sswb-preview-scroll"><table class="sswb-preview"><thead><tr id="sswb-preview-head"></tr></thead><tbody id="sswb-preview-body"></tbody></table></div>
      </section>
      <footer data-i18n="footer.statement"></footer>
    </main>
  </div>`;

/**
 * @param {HTMLElement} root
 * @param {object} host
 * @param {unknown} initialContext
 * @param {{ localeStore?: ReturnType<typeof createUiLocaleStore> }} [options]
 */
export async function mountGenerationWorkbench(root, host, initialContext, options = {}) {
  root.innerHTML = WORKBENCH_MARKUP;
  const localeStore = options.localeStore ?? createUiLocaleStore({
    storage: browserUiLocaleStorage(),
    hostLocale: readHostLocale(host),
    navigatorLanguage: globalThis.navigator?.language,
  });
  const controller = new DbxGenerationWorkbenchController({
    provider: new DbxHostSchemaMetadataProvider({
      capabilities: host.capabilities,
      getTableMetadata: (tableContext) => host.getTableMetadata(tableContext),
    }),
    preview: (schema, options_) => host.invoke(
      GENERATION_PREVIEW_METHOD,
      { schema, options: options_ },
      { timeoutMs: 30_000 },
    ),
    translator: localeStore.getTranslator(),
  });
  const unsubscribeRender = controller.subscribe(render);
  const unsubscribeContext = host.onContext((context) => {
    void controller.setContext(context);
  });
  root.addEventListener("change", onControlsChange);
  root.addEventListener("click", onClick);
  applyStaticMessages();
  await controller.setContext(host.context ?? initialContext);
  render(controller.getViewModel());

  /**
   * Re-render every static label from the active locale dictionary. Called at
   * mount time and whenever the user switches the interface language.
   */
  function applyStaticMessages() {
    const t = localeStore.getTranslator();
    for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of root.querySelectorAll("[data-i18n-title]")) node.title = t(node.dataset.i18nTitle);
    document.documentElement.lang = t.locale;
    renderUiLocaleOptions();
  }

  /** Each language is offered in its own language, independent of the active locale. */
  function renderUiLocaleOptions() {
    const select = element("sswb-ui-locale");
    select.replaceChildren();
    for (const locale of SUPPORTED_UI_LOCALES) {
      const option = document.createElement("option");
      option.value = locale;
      option.textContent = createI18n(locale)(`uiLocale.${locale}`);
      select.append(option);
    }
    select.value = localeStore.getLocale();
  }

  function onControlsChange(event) {
    const target = event.target;
    if (target.matches("#sswb-ui-locale")) {
      // Interface language only: this branch never dispatches a controller
      // action, so it cannot change the generation locale, the plan or the
      // dataset.
      const translator = localeStore.setLocale(target.value);
      applyStaticMessages();
      controller.setTranslator(translator);
      render(controller.getViewModel());
      return;
    }
    if (target.matches("#sswb-rows, #sswb-seed, #sswb-locale")) {
      void controller.dispatch({
        type: "update-controls",
        controls: {
          rowCount: Number(element("sswb-rows").value),
          seed: element("sswb-seed").value,
          locale: element("sswb-locale").value,
        },
      });
      return;
    }
    if (target.matches("[data-rule-selector]")) {
      const column = viewColumn(target.dataset.ruleColumn, controller);
      const choice = column?.ruleChoices.find((entry) => entry.kind === target.value);
      if (column && choice) void controller.dispatch({ type: "update-rule", column: column.column, rule: choice.draft });
      return;
    }
    if (target.matches("[data-rule-field]")) {
      const column = viewColumn(target.dataset.ruleColumn, controller);
      if (!column) return;
      const rule = structuredClone(column.generationRule);
      rule[target.dataset.ruleField] = readRuleField(target);
      void controller.dispatch({ type: "update-rule", column: column.column, rule });
      return;
    }
    if (target.matches("[data-constraint-kind], [data-constraint-column], [data-constraint-columns]")) {
      const constraint = controller.constraints.find((entry) => entry.id === target.dataset.constraintId);
      if (!constraint) return;
      const updated = structuredClone(constraint);
      if (target.matches("[data-constraint-kind]")) {
        const rawColumns = updated.kind === "composite_unique" ? updated.columns : [updated.column];
        const oldColumns = Array.isArray(rawColumns) ? rawColumns : typeof rawColumns === "string" ? [rawColumns] : [];
        updated.kind = target.value;
        delete updated.column;
        delete updated.columns;
        if (updated.kind === "composite_unique") updated.columns = oldColumns.filter(Boolean).slice(0, 2);
        else updated.column = oldColumns[0] ?? "";
      } else if (target.matches("[data-constraint-column]")) {
        updated.column = target.value;
      } else {
        try { updated.columns = JSON.parse(target.value); } catch { updated.columns = target.value; }
      }
      void controller.dispatch({ type: "update-constraint", constraint: updated });
    }
  }

  function onClick(event) {
    const target = event.target.closest("[data-sswb-action], [data-sswb-export], [data-constraint-add], [data-constraint-delete]");
    if (!target) return;
    const t = localeStore.getTranslator();
    if (target.matches("[data-constraint-add]")) {
      void controller.dispatch({ type: "add-constraint", kind: "unique" });
      return;
    }
    if (target.matches("[data-constraint-delete]")) {
      void controller.dispatch({ type: "delete-constraint", id: target.dataset.constraintId });
      return;
    }
    if (target.dataset.sswbExport) {
      try {
        const descriptor = controller.prepareExport(target.dataset.sswbExport);
        const objectUrl = URL.createObjectURL(new Blob([descriptor.content], { type: descriptor.mimeType }));
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = descriptor.filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        element("sswb-export-message").textContent = exportResultMessage(descriptor, t);
      } catch (error) {
        element("sswb-export-message").textContent = exportErrorMessage(error, t);
      }
      return;
    }
    void controller.dispatch({ type: target.dataset.sswbAction });
  }

  function render(viewModel) {
    const t = localeStore.getTranslator();
    const context = viewModel.context;
    element("sswb-database").textContent = context?.database ?? "—";
    element("sswb-schema").textContent = context?.schema ?? "—";
    element("sswb-table").textContent = context?.table ?? "—";
    element("sswb-status").textContent = statusLabel(viewModel, t);
    element("sswb-status").dataset.status = viewModel.status;
    element("sswb-state-message").textContent = stateMessage(viewModel, t);
    element("sswb-state-message").dataset.status = viewModel.status;
    element("sswb-action-error").textContent = viewModel.actionError ? actionErrorMessage(viewModel.actionError, t) : "";
    element("sswb-action-error").hidden = !viewModel.actionError;
    const noticeKey = viewModel.safeSyntheticNoticeKey ?? "safety.notice";
    element("sswb-safe-notice").textContent = viewModel.plan ? t(noticeKey) : "";
    const rowInput = element("sswb-rows");
    const seedInput = element("sswb-seed");
    const localeInput = element("sswb-locale");
    if (document.activeElement !== rowInput) rowInput.value = String(viewModel.controls.rowCount);
    if (document.activeElement !== seedInput) seedInput.value = viewModel.controls.seed;
    if (document.activeElement !== localeInput) localeInput.value = viewModel.controls.locale;
    for (const control of root.querySelectorAll("button, input, select, textarea")) {
      if (control.id !== "sswb-ui-locale") control.disabled = viewModel.status === "loading";
    }
    for (const control of root.querySelectorAll('[data-sswb-action="generate"], [data-sswb-action="regenerate-same-seed"], [data-sswb-action="new-seed"]')) {
      control.disabled = viewModel.status === "loading" || viewModel.status === "blocked";
    }
    element("sswb-rule-state").textContent = ruleEditorStateMessage(viewModel, t);
    element("sswb-constraint-state").textContent = constraintEditorStateMessage(viewModel, t);
    renderColumns(viewModel.columns, viewModel.status, t);
    renderConstraints(viewModel, t);
    renderDiagnostics(viewModel, t);
    renderPreview(viewModel, t);
    const exportDisabled = !viewModel.export.enabled || viewModel.status === "loading";
    const exportHint = exportDisabled ? exportDisabledHint(viewModel, t) : "";
    for (const id of ["sswb-export-csv", "sswb-export-json", "sswb-export-sql"]) {
      element(id).disabled = exportDisabled;
      element(id).title = exportHint;
    }
    const exportMessage = exportStatusMessage(viewModel, t);
    if (exportMessage !== null) element("sswb-export-message").textContent = exportMessage;
  }

  function renderColumns(columns, status, t) {
    const body = element("sswb-columns");
    body.replaceChildren();
    if (columns.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = status === "loading" ? t("columns.empty.loading") : t("columns.empty.none");
      row.append(cell);
      body.append(row);
      return;
    }
    for (const column of columns) {
      const row = document.createElement("tr");
      row.append(textCell(column.column, "sswb-column-name"));
      row.append(textCell(column.schemaType, "sswb-mono"));
      const strategy = document.createElement("td");
      const generator = document.createElement("strong");
      generator.textContent = column.selectedMapping;
      const detail = document.createElement("small");
      detail.textContent = t("columns.strategyDetail", {
        source: column.rule.sourceLabel,
        detected: column.detected,
        confidence: column.confidence,
      });
      strategy.append(generator, detail);
      strategy.append(renderRuleEditor(column, t));
      row.append(strategy);
      const mappingStatus = textCell(column.mappingStatus, "sswb-mapping-status");
      mappingStatus.dataset.mappingStatus = column.mappingStatusToken;
      row.append(mappingStatus);
      const detailsCell = document.createElement("td");
      if (column.ruleDiagnostics.length > 0) {
        const diagnostics = document.createElement("ul");
        diagnostics.className = "sswb-rule-diagnostics";
        for (const entry of column.ruleDiagnostics) {
          const description = describeDiagnostic(entry, t);
          const item = document.createElement("li");
          item.dataset.severity = entry.severity;
          item.textContent = t("columns.ruleDiagnostic", { title: description.headline });
          diagnostics.append(item);
        }
        detailsCell.append(diagnostics);
      }
      if (column.evidence.length > 0) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = t("columns.evidenceSummary", { count: column.evidence.length });
        const list = document.createElement("ul");
        for (const entry of column.evidence) list.append(renderEvidence(entry, t));
        details.append(summary, list);
        detailsCell.append(details);
      } else if (column.ruleDiagnostics.length === 0) detailsCell.append(document.createTextNode(t("columns.none")));
      row.append(detailsCell);
      body.append(row);
    }
  }

  function renderConstraints(viewModel, t) {
    const body = element("sswb-constraints-body");
    body.replaceChildren();
    if (viewModel.constraints.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = viewModel.context ? t("constraints.empty.none") : t("constraints.empty.noTable");
      row.append(cell);
      body.append(row);
      return;
    }
    for (const constraint of viewModel.constraints) {
      const row = document.createElement("tr");
      const kindCell = document.createElement("td");
      const kind = document.createElement("select");
      kind.dataset.constraintKind = "true";
      kind.dataset.constraintId = constraint.id;
      for (const option of constraintKindOptions(t)) {
        const element_ = document.createElement("option");
        element_.value = option.kind;
        element_.textContent = option.label;
        kind.append(element_);
      }
      kind.value = constraint.kind;
      kindCell.append(kind);
      row.append(kindCell);

      const columnsCell = document.createElement("td");
      if (constraint.kind === "composite_unique") {
        const ordered = document.createElement("textarea");
        ordered.rows = 2;
        ordered.value = Array.isArray(constraint.columns) ? JSON.stringify(constraint.columns) : String(constraint.columns ?? "");
        ordered.setAttribute("aria-label", t("constraints.columnsAriaLabel", { id: constraint.id }));
        ordered.dataset.constraintColumns = "true";
        ordered.dataset.constraintId = constraint.id;
        columnsCell.append(ordered);
      } else {
        const select = document.createElement("select");
        select.dataset.constraintColumn = "true";
        select.dataset.constraintId = constraint.id;
        for (const column of viewModel.columns) {
          const option = document.createElement("option");
          option.value = column.column;
          option.textContent = column.column;
          select.append(option);
        }
        select.value = constraint.column ?? "";
        columnsCell.append(select);
      }
      row.append(columnsCell);

      const planCell = document.createElement("td");
      const planned = viewModel.constraintPlan?.constraints.find((entry) => entry.id === constraint.id);
      planCell.textContent = constraintPlanLabel(planned ?? null, t);
      row.append(planCell);

      const actionCell = document.createElement("td");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "sswb-button";
      remove.textContent = t("constraints.delete");
      remove.dataset.constraintDelete = "true";
      remove.dataset.constraintId = constraint.id;
      actionCell.append(remove);
      row.append(actionCell);
      body.append(row);
    }
  }

  function renderDiagnostics(viewModel, t) {
    const container = element("sswb-diagnostics");
    container.replaceChildren();
    if (viewModel.diagnostics.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = diagnosticsEmptyMessage(viewModel, t);
      container.append(empty);
      return;
    }
    for (const description of describeDiagnostics(viewModel.diagnostics, t)) {
      container.append(renderDiagnostic(description, t));
    }
  }

  /**
   * Progressive disclosure: severity + localized headline first, then the plain
   * explanation and suggested action, with the raw Core message, codes and ids
   * behind "technical details".
   */
  function renderDiagnostic(description, t) {
    const item = document.createElement("article");
    item.className = "sswb-diagnostic";
    item.dataset.severity = description.severity ?? "error";
    item.setAttribute("aria-label", description.headline);
    const level = document.createElement("strong");
    level.textContent = description.levelLabel;
    const body = document.createElement("div");
    body.className = "sswb-diagnostic-body";
    const title = document.createElement("p");
    title.className = "sswb-diagnostic-title";
    title.textContent = description.title;
    const text = document.createElement("p");
    text.className = "sswb-diagnostic-description";
    text.textContent = description.description;
    body.append(title, text);
    if (description.action) {
      const action = document.createElement("p");
      action.className = "sswb-diagnostic-action";
      const label = document.createElement("span");
      label.className = "sswb-diagnostic-action-label";
      label.textContent = t("diagnostics.actionLabel");
      const value = document.createElement("span");
      value.textContent = description.action;
      action.append(label, value);
      body.append(action);
    }
    const rows = diagnosticTechnicalRows(description, t);
    if (rows.length > 0) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = t("diagnostics.technicalSummary");
      const list = document.createElement("dl");
      for (const [rowLabel, rowValue] of rows) {
        const term = document.createElement("dt");
        term.textContent = rowLabel;
        const definition = document.createElement("dd");
        definition.textContent = rowValue;
        list.append(term, definition);
      }
      details.append(summary, list);
      body.append(details);
    }
    item.append(level, body);
    return item;
  }

  /**
   * Evidence uses the same progressive disclosure as diagnostics: the
   * localized, user-facing observation first, then the raw Core kind / source /
   * observation / explanation behind "raw evidence". An unknown future kind
   * degrades to the safe fallback copy instead of leaking Core wording.
   */
  function renderEvidence(entry, t) {
    const description = describeEvidence(entry, t);
    const item = document.createElement("li");
    const line = document.createElement("p");
    line.className = "sswb-evidence-line";
    line.textContent = t("columns.evidenceItem", {
      source: description.sourceLabel,
      observation: description.observation,
      explanation: description.explanation,
    });
    item.append(line);
    const rows = evidenceTechnicalRows(description, t);
    if (rows.length > 0) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = t("evidence.technicalSummary");
      const list = document.createElement("dl");
      for (const [rowLabel, rowValue] of rows) {
        const term = document.createElement("dt");
        term.textContent = rowLabel;
        const definition = document.createElement("dd");
        definition.textContent = rowValue;
        list.append(term, definition);
      }
      details.append(summary, list);
      item.append(details);
    }
    return item;
  }

  function renderPreview(viewModel, t) {
    const header = element("sswb-preview-head");
    const body = element("sswb-preview-body");
    header.replaceChildren();
    body.replaceChildren();
    element("sswb-preview-summary").textContent = previewSummary(viewModel, t);
    for (const column of viewModel.preview.columns) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column;
      header.append(cell);
    }
    for (const previewRow of viewModel.preview.rows) {
      const row = document.createElement("tr");
      for (const column of viewModel.preview.columns) {
        const cell = document.createElement("td");
        const value = previewRow[column];
        cell.textContent = value === null ? t("preview.null") : typeof value === "string" ? value : JSON.stringify(value);
        if (value === null) cell.className = "sswb-null";
        row.append(cell);
      }
      body.append(row);
    }
  }

  return () => {
    unsubscribeRender();
    unsubscribeContext();
    root.removeEventListener("change", onControlsChange);
    root.removeEventListener("click", onClick);
  };
}

function renderRuleEditor(column, t) {
  const editor = document.createElement("div");
  editor.className = "sswb-rule-editor";
  const selector = document.createElement("select");
  selector.setAttribute("aria-label", t("columns.ruleSelectLabel", { column: column.column }));
  selector.dataset.ruleSelector = "true";
  selector.dataset.ruleColumn = column.column;
  for (const choice of column.ruleChoices) {
    const option = document.createElement("option");
    option.value = choice.kind;
    option.textContent = choice.label;
    selector.append(option);
  }
  selector.value = column.generationRule.kind;
  editor.append(selector);

  const fields = document.createElement("div");
  fields.className = "sswb-rule-fields";
  for (const field of column.ruleFields) {
    const label = document.createElement("label");
    label.textContent = field.label;
    let input;
    if (field.editor === "semantic") {
      input = document.createElement("select");
      const values = [...column.semanticTypes];
      if (field.value && !values.includes(field.value)) values.unshift(field.value);
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        input.append(option);
      }
      input.value = String(field.value ?? "");
    } else if (field.editor === "json") {
      input = document.createElement("textarea");
      input.rows = field.key === "values" ? 2 : 1;
      input.value = field.value === undefined ? "" : JSON.stringify(field.value);
    } else {
      input = document.createElement("input");
      input.type = field.editor === "integer" || field.editor === "ratio" ? "number" : "text";
      if (field.editor === "integer") input.step = "1";
      if (field.editor === "ratio") {
        input.min = "0";
        input.max = "1";
        input.step = "any";
      }
      if (field.editor === "decimal") input.inputMode = "decimal";
      input.value = field.value === undefined || field.value === null ? "" : String(field.value);
    }
    input.dataset.ruleField = field.key;
    input.dataset.ruleEditor = field.editor;
    input.dataset.ruleColumn = column.column;
    label.append(input);
    fields.append(label);
  }
  editor.append(fields);
  return editor;
}

function viewColumn(name, controller) {
  return controller.getViewModel().columns.find((column) => column.column === name);
}

function readRuleField(input) {
  if (input.dataset.ruleEditor === "integer" || input.dataset.ruleEditor === "ratio") {
    return input.value.trim() === "" ? null : Number(input.value);
  }
  if (input.dataset.ruleEditor === "json") {
    try {
      return JSON.parse(input.value);
    } catch {
      return input.value;
    }
  }
  return input.value;
}

function textCell(text, className) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing Workbench UI element: ${id}`);
  return found;
}
