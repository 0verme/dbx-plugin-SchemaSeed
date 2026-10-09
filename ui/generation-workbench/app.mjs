import { createGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-adapter.mjs";
import { isJsonDocumentValue, serializeJsonDocumentValue } from "../src/json-document.mjs";
import { selectInitialContext } from "./context.mjs";
import { renderWorkbenchContextVisibility } from "./visibility.mjs";
import { describeDiagnostic, describeDiagnostics, diagnosticTechnicalRows } from "../src/i18n/diagnostics.mjs";
import { describeEvidence, evidenceTechnicalRows } from "../src/i18n/evidence.mjs";
import { createI18n, SUPPORTED_UI_LOCALES } from "../src/i18n/index.mjs";
import { constraintKindOptions, constraintPlanLabel, ruleFieldLabel } from "../src/i18n/labels.mjs";
import { getGenerationRuleEditorFields } from "../src/generation/generation-rules.mjs";
import { browserUiLocaleStorage, createUiLocaleStore, readHostLocale } from "../src/i18n/ui-locale.mjs";
import { createModalDialogController } from "./modal-dialog.mjs";
import { copyTextToClipboard } from "./clipboard.mjs";
import {
  actionErrorMessage,
  exportErrorMessage,
  constraintEditorStateMessage,
  diagnosticsEmptyMessage,
  exportDisabledHint,
  exportSaveMessage,
  exportStatusMessage,
  previewSummary,
  ruleEditorStateMessage,
  stateMessage,
  statusLabel,
} from "../src/i18n/workbench-messages.mjs";
import { diagnosticSummaryCounts } from "../src/workbench/workbench-sections.mjs";
import { createSettingsDraft, settingsDraftChanged } from "../src/workbench/settings-draft.mjs";
import { saveExportWithHost } from "./export-save.mjs";
import { paginatePreviewRows } from "../src/workbench/preview-pagination.mjs";
import { validateGenerationRule } from "../src/generation/generation-rules.mjs";
import {
  appendCandidateValues,
  candidateValuesEqual,
  parseCandidateJson,
  parseCandidatePaste,
  removeCandidateValue,
  shouldAddCandidateOnEnter,
  shouldRemoveLastCandidateOnBackspace,
} from "./candidate-input.mjs";

const WORKBENCH_MARKUP = `
  <div class="sswb">
    <header class="sswb-header">
      <div class="sswb-brand"><span class="sswb-mark" aria-hidden="true">S</span><div><h1>SchemaSeed <span data-i18n="app.titleSuffix"></span></h1></div></div>
      <label class="sswb-ui-locale"><span data-i18n="controls.uiLocale"></span><select id="sswb-ui-locale" name="uiLocale"></select></label>
      <span id="sswb-status" class="sswb-status" role="status" aria-live="polite"></span>
    </header>
    <main class="sswb-main">
      <section id="sswb-empty-state" class="sswb-empty-state" aria-labelledby="sswb-empty-title" hidden>
        <div class="sswb-empty-card">
          <svg class="sswb-empty-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><ellipse cx="24" cy="10" rx="15" ry="6"></ellipse><path d="M9 10v28c0 3.3 6.7 6 15 6s15-2.7 15-6V10"></path><path d="M9 19c0 3.3 6.7 6 15 6s15-2.7 15-6M9 28c0 3.3 6.7 6 15 6s15-2.7 15-6"></path></svg>
          <h2 id="sswb-empty-title" data-i18n="empty.title"></h2>
          <p class="sswb-empty-description" data-i18n="empty.description"></p>
          <p class="sswb-empty-path"><span data-i18n="empty.path"></span> <strong data-i18n="empty.menuAction"></strong></p>
          <p class="sswb-empty-helper" data-i18n="empty.helper"></p>
        </div>
      </section>
      <div id="sswb-workbench-content" class="sswb-workbench-content">
      <section class="sswb-panel" aria-labelledby="sswb-context-title">
        <div class="sswb-heading"><div><h2 id="sswb-context-title" data-i18n="context.title"></h2></div><span class="sswb-context-tag">DBX HOST</span></div>
        <div class="sswb-context-grid">
          <div><span data-i18n="context.database"></span><strong id="sswb-database">—</strong></div>
          <div><span data-i18n="context.schema"></span><strong id="sswb-schema">—</strong></div>
          <div><span data-i18n="context.table"></span><strong id="sswb-table">—</strong></div>
        </div>
        <form id="sswb-controls" class="sswb-controls">
          <label><span data-i18n="controls.rows"></span><input id="sswb-rows" name="rowCount" type="number" min="1" max="1000" step="1" value="50" required></label>
          <label><span data-i18n="controls.seed"></span><input id="sswb-seed" name="seed" type="text" value="demo" maxlength="128"></label>
          <label><span data-i18n="controls.dataLocale"></span><select id="sswb-locale" name="locale" data-i18n-title="controls.dataLocaleHelp"><option value="zh-CN">zh-CN</option><option value="en">en</option></select></label>
          <div class="sswb-actions">
            <button class="sswb-button" type="button" data-advanced-open>
              <svg class="sswb-button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 5h12M4 10h12M4 15h12"></path><circle cx="8" cy="5" r="1.5"></circle><circle cx="12" cy="10" r="1.5"></circle><circle cx="7" cy="15" r="1.5"></circle></svg>
              <span data-i18n="actions.advancedSettings"></span>
            </button>
            <button id="sswb-diagnostics-link" class="sswb-button sswb-diagnostics-link" type="button" data-advanced-diagnostics hidden></button>
            <button class="sswb-button sswb-primary" type="button" data-sswb-action="preview"></button>
          </div>
        </form>
        <p class="sswb-data-access-notice" data-i18n="controls.dataAccessNotice"></p>
        <p id="sswb-action-error" class="sswb-inline-error" role="alert" hidden></p>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-preview-title">
        <div class="sswb-heading"><div><h2 id="sswb-preview-title" data-i18n="preview.title"></h2><p id="sswb-preview-summary" class="sswb-caption"></p></div><span class="sswb-readonly" data-i18n="preview.readonly"></span></div>
        <p id="sswb-state-message" class="sswb-state-message" role="status"></p>
        <p id="sswb-preview-stale" class="sswb-preview-stale" role="status" hidden></p>
        <div class="sswb-export-row"><div><button id="sswb-export-csv" class="sswb-button" type="button" data-sswb-export="csv" data-i18n="export.csv" disabled></button><button id="sswb-export-json" class="sswb-button" type="button" data-sswb-export="json" data-i18n="export.json" disabled></button><button id="sswb-export-sql" class="sswb-button" type="button" data-sswb-export="sql" data-i18n="export.sql" disabled></button><button id="sswb-preview-sql" class="sswb-button" type="button" data-sswb-preview-sql data-i18n="actions.previewSql" disabled></button></div><span id="sswb-export-message" role="status" aria-live="polite"></span></div>
        <div id="sswb-preview-empty" class="sswb-preview-empty" hidden><strong data-i18n="preview.empty.title"></strong><p data-i18n="preview.empty.helper"></p></div>
        <div id="sswb-preview-scroll" class="sswb-scroll sswb-preview-scroll" hidden><table class="sswb-preview"><thead><tr id="sswb-preview-head"></tr></thead><tbody id="sswb-preview-body"></tbody></table></div>
        <nav id="sswb-preview-pagination" class="sswb-preview-pagination" aria-label="Preview pagination" hidden>
          <button id="sswb-preview-previous" class="sswb-button" type="button" data-preview-page="previous" data-i18n="preview.pagination.previous"></button>
          <span id="sswb-preview-page-info" aria-live="polite"></span>
          <button id="sswb-preview-next" class="sswb-button" type="button" data-preview-page="next" data-i18n="preview.pagination.next"></button>
        </nav>
      </section>

      </div>
    </main>
  </div>
  <div id="sswb-advanced-modal" class="sswb-modal" hidden>
    <section class="sswb-advanced-dialog" role="dialog" aria-modal="true" aria-labelledby="sswb-advanced-title" tabindex="-1">
      <header class="sswb-advanced-dialog-header">
        <h2 id="sswb-advanced-title" data-i18n="advanced.title"></h2>
        <button class="sswb-icon-button" type="button" data-advanced-close data-i18n-aria-label="advanced.close" data-i18n-title="advanced.close"><span aria-hidden="true">×</span></button>
      </header>
      <nav class="sswb-advanced-tabs" role="tablist" data-i18n-aria-label="advanced.tabs.label">
        <button id="sswb-advanced-tab-columns" class="sswb-advanced-tab" type="button" role="tab" aria-controls="sswb-advanced-panel-columns" aria-selected="true" tabindex="0" data-advanced-tab="columns" data-i18n="advanced.tab.columns"></button>
        <button id="sswb-advanced-tab-constraints" class="sswb-advanced-tab" type="button" role="tab" aria-controls="sswb-advanced-panel-constraints" aria-selected="false" tabindex="-1" data-advanced-tab="constraints" data-i18n="advanced.tab.constraints"></button>
        <button id="sswb-advanced-tab-diagnostics" class="sswb-advanced-tab" type="button" role="tab" aria-controls="sswb-advanced-panel-diagnostics" aria-selected="false" tabindex="-1" data-advanced-tab="diagnostics" data-i18n="advanced.tab.diagnostics"></button>
      </nav>
      <div class="sswb-advanced-content">
        <section id="sswb-advanced-panel-columns" class="sswb-advanced-panel" role="tabpanel" aria-labelledby="sswb-advanced-tab-columns">
          <div class="sswb-advanced-toolbar">
            <div><h3 data-i18n="columns.title"></h3><p id="sswb-sample-hint" class="sswb-caption"></p></div>
            <label class="sswb-column-search"><span data-i18n="advanced.search.label"></span><input id="sswb-column-search-input" type="search" data-i18n-placeholder="advanced.search.placeholder"></label>
          </div>
          <p id="sswb-column-search-empty" class="sswb-caption sswb-search-empty" data-i18n="advanced.search.empty" hidden></p>
          <div class="sswb-scroll"><table class="sswb-mapping"><thead><tr><th data-i18n="columns.header.column"></th><th data-i18n="columns.header.schemaType"></th><th data-i18n="columns.header.strategy"></th><th data-i18n="columns.header.mappingStatus"></th><th data-i18n="columns.header.rules"></th></tr></thead><tbody id="sswb-columns"></tbody></table></div>
          <div id="sswb-rule-state" class="sswb-rule-slot" role="status"></div>
        </section>
        <section id="sswb-advanced-panel-constraints" class="sswb-advanced-panel" role="tabpanel" aria-labelledby="sswb-advanced-tab-constraints" hidden>
          <div class="sswb-heading"><div><h3 data-i18n="constraints.title"></h3><p class="sswb-caption" data-i18n="constraints.caption"></p></div><button class="sswb-button" type="button" data-constraint-add data-i18n="constraints.add"></button></div>
          <div class="sswb-scroll"><table class="sswb-constraints"><thead><tr><th data-i18n="constraints.header.kind"></th><th data-i18n="constraints.header.columns"></th><th data-i18n="constraints.header.plan"></th><th data-i18n="constraints.header.actions"></th></tr></thead><tbody id="sswb-constraints-body"></tbody></table></div>
          <div id="sswb-constraint-state" class="sswb-rule-slot" role="status"></div>
        </section>
        <section id="sswb-advanced-panel-diagnostics" class="sswb-advanced-panel" role="tabpanel" aria-labelledby="sswb-advanced-tab-diagnostics" hidden>
          <h3 data-i18n="diagnostics.title"></h3>
          <p class="sswb-caption" data-i18n="diagnostics.caption"></p>
          <div id="sswb-diagnostics" class="sswb-diagnostics"></div>
        </section>
      </div>
      <div id="sswb-advanced-confirm" class="sswb-advanced-confirm" role="alertdialog" aria-labelledby="sswb-advanced-confirm-title" hidden>
        <div><strong id="sswb-advanced-confirm-title" data-i18n="advanced.confirm.title"></strong><p data-i18n="advanced.confirm.message"></p></div>
        <div><button class="sswb-button" type="button" data-advanced-discard data-i18n="advanced.confirm.discard"></button><button class="sswb-button" type="button" data-advanced-continue data-i18n="advanced.confirm.continue"></button></div>
      </div>
      <footer class="sswb-advanced-dialog-footer">
        <p id="sswb-advanced-status" role="status" aria-live="polite"></p>
        <div><button class="sswb-button" type="button" data-advanced-cancel data-i18n="advanced.cancel"></button><button class="sswb-button sswb-primary" type="button" data-advanced-save data-i18n="advanced.save"></button></div>
      </footer>
    </section>
  </div>
  <div id="sswb-sql-modal" class="sswb-modal" hidden>
    <section class="sswb-sql-dialog" role="dialog" aria-modal="true" aria-labelledby="sswb-sql-modal-title" aria-describedby="sswb-sql-modal-meta">
      <header class="sswb-sql-dialog-header">
        <div><h2 id="sswb-sql-modal-title" data-i18n="preview.sqlTitle"></h2><p id="sswb-sql-modal-meta" class="sswb-caption"></p></div>
        <button class="sswb-icon-button" type="button" data-sswb-sql-modal-close data-i18n-aria-label="preview.sqlClose" data-i18n-title="preview.sqlClose"><span aria-hidden="true">×</span></button>
      </header>
      <div class="sswb-sql-modal-content">
        <h3 id="sswb-sql-code-label" data-i18n="preview.sqlCodeLabel"></h3>
        <p id="sswb-sql-modal-error" class="sswb-sql-modal-error" role="alert" hidden></p>
        <pre id="sswb-sql-code-scroll" class="sswb-sql-code-scroll" tabindex="0" aria-labelledby="sswb-sql-code-label"><code id="sswb-sql-code"></code></pre>
      </div>
      <footer class="sswb-sql-dialog-footer">
        <p id="sswb-sql-modal-status" class="sswb-sql-modal-status" role="status" aria-live="polite"></p>
        <div>
          <button class="sswb-button" type="button" data-sswb-sql-modal-copy data-i18n="preview.sqlCopy" disabled></button>
          <button class="sswb-button sswb-primary" type="button" data-sswb-sql-modal-export data-i18n="preview.sqlExport" disabled></button>
          <button class="sswb-button" type="button" data-sswb-sql-modal-close data-i18n="preview.sqlClose"></button>
        </div>
      </footer>
    </section>
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
  const controller = createGenerationWorkbenchController(host, localeStore.getTranslator());
  const unsubscribeRender = controller.subscribe(render);
  // Last Host save state (saving / waiting / saved / cancelled / failed). It
  // keeps the inline message attached to a real save result, and is cleared by
  // any action that starts a new dataset so a stale success cannot mislead.
  let exportSaveState = null;
  let sqlPreviewDescriptor = null;
  let sqlPreviewError = null;
  let sqlCopyStatus = null;
  let sqlCopyInProgress = false;
  let previewPage = 0;
  const enumEditorStates = new Map();
  let enumContextKey = null;
  let enumDraftGateActive = false;
  let settingsDraft = null;
  let activeAdvancedTab = "columns";
  let advancedSaving = false;
  let advancedValidationDiagnostics = null;
  let advancedSaveErrorKey = null;
  const sqlDialog = createModalDialogController({
    overlay: element("sswb-sql-modal"),
    dialog: element("sswb-sql-modal").querySelector(".sswb-sql-dialog"),
    background: root.querySelector(".sswb"),
    initialFocus: () => element("sswb-sql-modal").querySelector("[data-sswb-sql-modal-close]"),
    onClose: () => {
      sqlPreviewDescriptor = null;
      sqlPreviewError = null;
      sqlCopyStatus = null;
      sqlCopyInProgress = false;
      element("sswb-sql-code").replaceChildren();
      renderSqlPreviewModal(controller.getViewModel(), localeStore.getTranslator());
    },
  });
  const advancedDialog = createModalDialogController({
    overlay: element("sswb-advanced-modal"),
    dialog: element("sswb-advanced-modal").querySelector(".sswb-advanced-dialog"),
    background: root.querySelector(".sswb"),
    initialFocus: () => element("sswb-advanced-modal").querySelector("[data-advanced-close]"),
    onRequestClose: () => requestAdvancedClose(),
    onClose: () => {
      const hadPendingEnumDraft = enumDraftPending();
      settingsDraft = null;
      enumEditorStates.clear();
      enumDraftGateActive = false;
      advancedSaving = false;
      advancedValidationDiagnostics = null;
      advancedSaveErrorKey = null;
      element("sswb-advanced-confirm").hidden = true;
      if (hadPendingEnumDraft) render(controller.getViewModel());
    },
  });
  const unsubscribeContext = host.onContext((context) => {
    // A table switch discards the old table's in-memory draft before loading the new table.
    if (advancedDialog.isOpen && settingsDraft
      && tableContextKey(context) !== settingsDraft.contextKey) advancedDialog.close();
    exportSaveState = null;
    previewPage = 0;
    const nextKey = enumContextIdentity(context);
    if (nextKey !== enumContextKey) {
      enumEditorStates.clear();
      enumContextKey = nextKey;
    }
    void controller.setContext(context);
  });
  root.addEventListener("change", onControlsChange);
  root.addEventListener("input", onInput);
  root.addEventListener("input", onEnumInput);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("keydown", onEnumKeydown);
  root.addEventListener("paste", onEnumPaste);
  root.addEventListener("click", onClick);
  applyStaticMessages();
  const selectedContext = selectInitialContext(host, initialContext);
  enumContextKey = enumContextIdentity(selectedContext);
  await controller.setContext(selectedContext);
  render(controller.getViewModel());

  /**
   * Re-render every static label from the active locale dictionary. Called at
   * mount time and whenever the user switches the interface language.
   */
  function applyStaticMessages() {
    const t = localeStore.getTranslator();
    for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of root.querySelectorAll("[data-i18n-title]")) node.title = t(node.dataset.i18nTitle);
    for (const node of root.querySelectorAll("[data-i18n-aria-label]")) node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
    for (const node of root.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
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

  function enumBaseValues(column) {
    const rule = settingsDraft?.rules[column.column] ?? column.generationRule;
    return Array.isArray(rule?.values) ? rule.values : [];
  }

  function enumEditorState(column) {
    let state = enumEditorStates.get(column.column);
    if (state) return state;
    const values = enumBaseValues(column);
    const validation = values ? validateEnumCandidates(column, values) : { ok: false, errorKey: "enumInput.invalid" };
    const canUseTags = column.schemaFamily === "varchar" && values?.every((value) => typeof value === "string") === true;
    state = {
      mode: canUseTags ? "tags" : "json",
      tagDraft: "",
      jsonDraft: canUseTags ? null : JSON.stringify(values, null, 2),
      draftValues: null,
      errorKey: validation.ok ? null : validation.errorKey,
      pasteOptions: null,
      confirmClear: false,
      pending: false,
    };
    enumEditorStates.set(column.column, state);
    return state;
  }

  function validateEnumCandidates(column, values) {
    const schemaColumn = controller.schema?.columns.find((entry) => entry.name === column.column);
    if (!schemaColumn) return { ok: false, errorKey: "enumInput.invalid" };
    const validation = validateGenerationRule(schemaColumn, { kind: "enum", values }, {
      tableIdentity: controller.schema.tableIdentity,
      rowCount: controller.controls.rowCount,
      temporalPrecision: controller.temporalPrecisionMetadata?.[column.column],
    });
    if (validation.valid) return { ok: true, values: validation.rule.values };
    const diagnostic = validation.diagnostics[0];
    if (diagnostic?.code === "generation_rule_incompatible") return { ok: false, errorKey: "enumInput.incompatible", diagnostic };
    if (diagnostic?.code === "generation_rule_invalid" && /at least one candidate/iu.test(diagnostic.reason)) {
      return { ok: false, errorKey: "enumInput.empty", diagnostic };
    }
    if (diagnostic?.code === "generation_rule_invalid" && /must be unique/iu.test(diagnostic.reason)) {
      return { ok: false, errorKey: "enumInput.duplicate", diagnostic };
    }
    return { ok: false, errorKey: "enumInput.invalid", diagnostic };
  }

  function enumValuesFor(column, state) {
    if (Array.isArray(state.draftValues)) return state.draftValues;
    return enumBaseValues(column);
  }

  function enumDraftPending() {
    return [...enumEditorStates.values()].some((state) => state.pending);
  }

  function enumEditorDirty() {
    return [...enumEditorStates.values()].some((state) => state.pending || state.tagDraft.length > 0);
  }

  function updateEnumEditorFeedback(target, column, state) {
    const editor = target.closest(".sswb-enum-editor");
    if (!editor) return;
    const t = localeStore.getTranslator();
    const values = enumValuesFor(column, state);
    const count = editor.querySelector("[data-enum-count]");
    if (count) count.textContent = t("enumInput.count", { count: values.length });
    const error = editor.querySelector("[data-enum-error]");
    if (error) {
      error.textContent = state.errorKey ? t(state.errorKey)
        : state.pending ? t("enumInput.previewInvalid") : "";
      error.hidden = !state.errorKey && !state.pending;
      error.dataset.severity = state.errorKey ? "error" : "info";
    }
    const choices = editor.querySelector("[data-enum-paste-choices]");
    if (choices) choices.hidden = state.pasteOptions === null;
  }

  function applyEnumDraftGate() {
    const pending = enumDraftPending();
    if (pending === enumDraftGateActive) return;
    enumDraftGateActive = pending;
    if (!pending) {
      render(controller.getViewModel());
      return;
    }
    sqlPreviewDescriptor = null;
    sqlPreviewError = null;
    if (sqlDialog.isOpen) sqlDialog.close();
    const t = localeStore.getTranslator();
    const preview = root.querySelector('[data-sswb-action="preview"]');
    preview.disabled = true;
    preview.title = t("enumInput.fixFirst");
    for (const id of ["sswb-export-csv", "sswb-export-json", "sswb-export-sql", "sswb-preview-sql"]) {
      element(id).disabled = true;
      element(id).title = t("enumInput.fixFirst");
    }
    element("sswb-state-message").textContent = t("enumInput.fixFirst");
    element("sswb-state-message").dataset.status = "dirty";
    element("sswb-state-message").hidden = false;
    element("sswb-export-message").textContent = t("enumInput.previewInvalid");
    element("sswb-preview-summary").textContent = t("enumInput.previewInvalid");
    element("sswb-preview-scroll").hidden = true;
    element("sswb-preview-pagination").hidden = true;
    element("sswb-preview-empty").hidden = false;
    element("sswb-preview-empty").querySelector("strong").textContent = t("enumInput.fixFirst");
    element("sswb-preview-empty").querySelector("p").textContent = t("enumInput.previewInvalid");
  }

  function onEnumInput(event) {
    const target = event.target;
    if (target.matches("[data-enum-tag-input]")) {
      const column = viewColumn(target.dataset.ruleColumn, controller);
      if (!column) return;
      const state = enumEditorState(column);
      state.tagDraft = target.value;
      const values = enumValuesFor(column, state);
      const validation = validateEnumCandidates(column, target.value.length > 0
        ? appendCandidateValues(values, [target.value]) : values);
      const draftBaseChanged = Array.isArray(state.draftValues)
        && !candidateValuesEqual(state.draftValues, enumBaseValues(column));
      state.errorKey = validation.ok ? null : validation.errorKey;
      state.pending = draftBaseChanged || (target.value.length > 0 && !validation.ok);
      updateEnumEditorFeedback(target, column, state);
      applyEnumDraftGate();
      renderAdvancedStatus(controller.getViewModel(), localeStore.getTranslator());
      return;
    }
    if (!target.matches("[data-enum-json]")) return;
    const column = viewColumn(target.dataset.ruleColumn, controller);
    if (!column) return;
    const state = enumEditorState(column);
    state.jsonDraft = target.value;
    const parsed = parseCandidateJson(target.value);
    if (!parsed.ok) {
      state.draftValues = null;
      state.errorKey = "enumInput.invalidJson";
      state.pending = true;
    } else {
      state.draftValues = parsed.values;
      const validation = validateEnumCandidates(column, parsed.values);
      state.errorKey = validation.ok ? null : validation.errorKey;
      state.pending = !validation.ok || !candidateValuesEqual(parsed.values, enumBaseValues(column));
    }
    updateEnumEditorFeedback(target, column, state);
    applyEnumDraftGate();
    renderAdvancedStatus(controller.getViewModel(), localeStore.getTranslator());
  }

  async function commitEnumValues(column, state, values, options = {}) {
    const validation = validateEnumCandidates(column, values);
    state.draftValues = [...values];
    state.errorKey = validation.ok ? null : validation.errorKey;
    state.pending = !validation.ok;
    state.pasteOptions = null;
    state.confirmClear = false;
    if (!validation.ok || !settingsDraft) {
      render(controller.getViewModel());
      focusEnumTagInput(column, state, options.focusTagInput === true);
      return false;
    }

    settingsDraft.rules[column.column] = { kind: "enum", values: structuredClone(validation.values ?? values) };
    clearAdvancedValidation();
    state.draftValues = null;
    state.jsonDraft = null;
    if (options.clearTagDraft) state.tagDraft = "";
    state.errorKey = null;
    state.pending = false;
    state.pasteOptions = null;
    render(controller.getViewModel());
    focusEnumTagInput(column, state, options.focusTagInput === true);
    return true;
  }

  function focusEnumTagInput(column, state, shouldFocus) {
    if (!shouldFocus || state.mode !== "tags") return;
    const input = [...root.querySelectorAll("[data-enum-tag-input]")]
      .find((entry) => entry.dataset.ruleColumn === column.column);
    input?.focus();
  }

  async function commitEnumJsonDraft(column, state) {
    if (typeof state.jsonDraft !== "string") return;
    const parsed = parseCandidateJson(state.jsonDraft);
    if (!parsed.ok) {
      state.errorKey = "enumInput.invalidJson";
      state.pending = true;
      render(controller.getViewModel());
      return;
    }
    const validation = validateEnumCandidates(column, parsed.values);
    state.draftValues = parsed.values;
    state.errorKey = validation.ok ? null : validation.errorKey;
    state.pending = !validation.ok || !candidateValuesEqual(parsed.values, enumBaseValues(column));
    if (!validation.ok) {
      render(controller.getViewModel());
      return;
    }
    await commitEnumValues(column, state, parsed.values);
  }

  function onEnumKeydown(event) {
    const target = event.target;
    if (!target.matches("[data-enum-tag-input]")) return;
    const column = viewColumn(target.dataset.ruleColumn, controller);
    if (!column) return;
    const state = enumEditorState(column);
    const values = enumValuesFor(column, state);
    if (shouldAddCandidateOnEnter(event)) {
      event.preventDefault();
      if (target.value.length === 0) return;
      state.tagDraft = target.value;
      const candidate = target.value;
      if (values.includes(candidate)) {
        state.errorKey = "enumInput.duplicate";
        state.pending = true;
        updateEnumEditorFeedback(target, column, state);
        applyEnumDraftGate();
        return;
      }
      state.tagDraft = "";
      void commitEnumValues(column, state, appendCandidateValues(values, [candidate]), { focusTagInput: true, clearTagDraft: true });
      return;
    }
    if (shouldRemoveLastCandidateOnBackspace({
      key: event.key,
      value: target.value,
      isComposing: event.isComposing,
      keyCode: event.keyCode,
    }, values.length)) {
      event.preventDefault();
      void commitEnumValues(column, state, removeCandidateValue(values, values.length - 1), { focusTagInput: true });
    }
  }

  function onEnumPaste(event) {
    const target = event.target;
    if (!target.matches("[data-enum-tag-input]")) return;
    const column = viewColumn(target.dataset.ruleColumn, controller);
    if (!column) return;
    const text = event.clipboardData?.getData("text");
    if (typeof text !== "string") return;
    event.preventDefault();
    const start = Number.isSafeInteger(target.selectionStart) ? target.selectionStart : target.value.length;
    const end = Number.isSafeInteger(target.selectionEnd) ? target.selectionEnd : start;
    const pasteText = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
    const state = enumEditorState(column);
    const parsed = parseCandidatePaste(pasteText);
    if (parsed.kind === "empty") return;
    if (parsed.kind === "error") {
      state.tagDraft = pasteText;
      state.errorKey = "enumInput.invalidJson";
      state.pending = true;
      state.pasteOptions = null;
      render(controller.getViewModel());
      focusEnumTagInput(column, state, true);
      return;
    }
    if (parsed.kind === "ambiguous") {
      state.tagDraft = pasteText;
      state.errorKey = "enumInput.ambiguousPaste";
      state.pending = true;
      state.pasteOptions = { splitValues: parsed.splitValues, singleValue: parsed.singleValue };
      render(controller.getViewModel());
      focusEnumTagInput(column, state, true);
      return;
    }
    const values = enumValuesFor(column, state);
    state.tagDraft = "";
    void commitEnumValues(column, state, appendCandidateValues(values, parsed.values), { focusTagInput: true, clearTagDraft: true });
  }

  function onControlsChange(event) {
    const target = event.target;
    if (target.matches("#sswb-ui-locale")) {
      // Interface language is presentation-only; it never changes the draft or generation settings.
      const translator = localeStore.setLocale(target.value);
      applyStaticMessages();
      controller.setTranslator(translator);
      render(controller.getViewModel());
      return;
    }
    exportSaveState = null;
    previewPage = 0;
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
    if (target.matches("[data-enum-json]")) {
      if (document.activeElement?.matches("[data-enum-mode]")) return;
      const column = viewColumn(target.dataset.ruleColumn, controller);
      if (column) void commitEnumJsonDraft(column, enumEditorState(column));
      return;
    }
    if (target.matches("[data-rule-selector]")) {
      const column = viewColumn(target.dataset.ruleColumn, controller);
      const choice = column?.ruleChoices.find((entry) => entry.kind === target.value);
      if (column && choice && settingsDraft) {
        enumEditorStates.delete(column.column);
        settingsDraft.rules[column.column] = structuredClone(choice.draft);
        clearAdvancedValidation();
        renderAdvancedSettings(controller.getViewModel(), localeStore.getTranslator());
      }
      return;
    }
    if (target.matches("[data-rule-field]")) {
      const column = viewColumn(target.dataset.ruleColumn, controller);
      if (!column || !settingsDraft) return;
      const rule = structuredClone(settingsDraft.rules[column.column] ?? editableRule(column.generationRule));
      rule[target.dataset.ruleField] = readRuleField(target);
      settingsDraft.rules[column.column] = rule;
      clearAdvancedValidation();
      renderAdvancedStatus(controller.getViewModel(), localeStore.getTranslator());
      return;
    }
    if (target.matches("[data-constraint-kind], [data-constraint-column], [data-constraint-columns]")) {
      if (!settingsDraft) return;
      const constraint = settingsDraft.constraints.find((entry) => entry.id === target.dataset.constraintId);
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
      settingsDraft.constraints = settingsDraft.constraints.map((entry) => entry.id === updated.id ? updated : entry);
      clearAdvancedValidation();
      renderAdvancedSettings(controller.getViewModel(), localeStore.getTranslator());
      return;
    }
  }

  function onInput(event) {
    if (event.target.matches("#sswb-column-search-input")) filterColumnRows();
  }

  function onKeyDown(event) {
    if (!event.target.matches('[role="tab"][data-advanced-tab]')) return;
    const tabs = [...element("sswb-advanced-modal").querySelectorAll('[role="tab"][data-advanced-tab]')];
    const index = tabs.indexOf(event.target);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setAdvancedTab(tabs[next].dataset.advancedTab);
    tabs[next].focus();
  }

  function onClick(event) {
    if (event.target === element("sswb-advanced-modal")) {
      advancedDialog.requestClose("backdrop");
      return;
    }
    const target = event.target.closest("[data-enum-mode], [data-enum-remove], [data-enum-clear], [data-enum-clear-confirm], [data-enum-clear-cancel], [data-enum-paste-choice], [data-sswb-action], [data-sswb-export], [data-sswb-preview-sql], [data-sswb-sql-modal-close], [data-sswb-sql-modal-copy], [data-sswb-sql-modal-export], [data-constraint-add], [data-constraint-delete], [data-preview-page], [data-advanced-open], [data-advanced-diagnostics], [data-advanced-close], [data-advanced-cancel], [data-advanced-save], [data-advanced-discard], [data-advanced-continue], [data-advanced-tab]");
    if (!target) return;
    if (target.matches("[data-enum-mode], [data-enum-remove], [data-enum-clear], [data-enum-clear-confirm], [data-enum-clear-cancel], [data-enum-paste-choice]")) {
      void onEnumEditorClick(target);
      return;
    }
    if (target.matches("[data-advanced-open]")) {
      openAdvancedSettings(target, "columns");
      return;
    }
    if (target.matches("[data-advanced-diagnostics]")) {
      openAdvancedSettings(target, "diagnostics");
      return;
    }
    if (target.matches("[data-advanced-tab]")) {
      setAdvancedTab(target.dataset.advancedTab);
      return;
    }
    if (target.matches("[data-advanced-close]")) {
      advancedDialog.requestClose("close-button");
      return;
    }
    if (target.matches("[data-advanced-cancel]")) {
      advancedDialog.requestClose("cancel-button");
      return;
    }
    if (target.matches("[data-advanced-save]")) {
      void saveAdvancedSettings();
      return;
    }
    if (target.matches("[data-advanced-discard]")) {
      advancedDialog.close();
      return;
    }
    if (target.matches("[data-advanced-continue]")) {
      element("sswb-advanced-confirm").hidden = true;
      element("sswb-advanced-modal").querySelector("[data-advanced-close]").focus();
      return;
    }
    if (target.dataset.previewPage) {
      previewPage += target.dataset.previewPage === "next" ? 1 : -1;
      render(controller.getViewModel());
      return;
    }
    if (target.matches("[data-sswb-sql-modal-close]")) {
      sqlDialog.close();
      return;
    }
    if (target.matches("[data-sswb-sql-modal-copy]")) {
      void copyPreviewSql();
      return;
    }
    if (target.matches("[data-sswb-sql-modal-export]")) {
      if (sqlPreviewDescriptor) void saveExport("sql", sqlPreviewDescriptor);
      return;
    }
    if (target.dataset.sswbExport) {
      void saveExport(target.dataset.sswbExport);
      return;
    }
    if (target.matches("[data-sswb-preview-sql]")) {
      openSqlPreview(target);
      return;
    }
    // Any non-export action may invalidate the dataset, so it also clears a
    // previously displayed save result.
    exportSaveState = null;
    previewPage = 0;
    if (target.matches("[data-constraint-add]")) {
      addDraftConstraint(controller.getViewModel());
      return;
    }
    if (target.matches("[data-constraint-delete]")) {
      if (!settingsDraft) return;
      settingsDraft.constraints = settingsDraft.constraints.filter((entry) => entry.id !== target.dataset.constraintId);
      clearAdvancedValidation();
      renderAdvancedSettings(controller.getViewModel(), localeStore.getTranslator());
      return;
    }
    if (target.dataset.sswbAction === "preview") {
      const action = controller.getViewModel().previewAction;
      if (!enumDraftPending() && !action.disabled) void controller.dispatch({ type: action.action });
      return;
    }
    void controller.dispatch({ type: target.dataset.sswbAction });
  }

  async function onEnumEditorClick(target) {
    const column = viewColumn(target.dataset.ruleColumn, controller);
    if (!column) return;
    const state = enumEditorState(column);
    const values = enumValuesFor(column, state);
    if (target.matches("[data-enum-remove]")) {
      const index = Number(target.dataset.enumIndex);
      void commitEnumValues(column, state, removeCandidateValue(values, index), { focusTagInput: true });
      return;
    }
    if (target.matches("[data-enum-clear]")) {
      state.confirmClear = true;
      render(controller.getViewModel());
      const confirm = [...root.querySelectorAll("[data-enum-clear-confirm]")]
        .find((entry) => entry.dataset.ruleColumn === column.column);
      confirm?.focus();
      return;
    }
    if (target.matches("[data-enum-clear-cancel]")) {
      state.confirmClear = false;
      render(controller.getViewModel());
      const clear = [...root.querySelectorAll("[data-enum-clear]")]
        .find((entry) => entry.dataset.ruleColumn === column.column);
      clear?.focus();
      return;
    }
    if (target.matches("[data-enum-clear-confirm]")) {
      void commitEnumValues(column, state, [], { focusTagInput: true });
      return;
    }
    if (target.matches("[data-enum-paste-choice]")) {
      const choice = target.dataset.enumPasteChoice;
      const additions = choice === "split" ? state.pasteOptions?.splitValues
        : choice === "single" ? [state.pasteOptions?.singleValue] : null;
      if (!Array.isArray(additions)) return;
      state.tagDraft = "";
      void commitEnumValues(column, state, appendCandidateValues(values, additions), { focusTagInput: true, clearTagDraft: true });
      return;
    }
    if (target.dataset.enumMode === "json") {
      state.mode = "json";
      state.jsonDraft = JSON.stringify(values, null, 2);
      render(controller.getViewModel());
      const input = [...root.querySelectorAll("[data-enum-json]")]
        .find((entry) => entry.dataset.ruleColumn === column.column);
      input?.focus();
      return;
    }
    if (target.dataset.enumMode === "tags") {
      const parsed = typeof state.jsonDraft === "string" ? parseCandidateJson(state.jsonDraft) : null;
      const returnValues = parsed ? (parsed.ok ? parsed.values : null) : values;
      if (!Array.isArray(returnValues) || !returnValues.every((value) => typeof value === "string")) {
        state.errorKey = "enumInput.returnNotLossless";
        state.pending = true;
        render(controller.getViewModel());
        return;
      }
      state.mode = "tags";
      state.draftValues = returnValues;
      const validation = validateEnumCandidates(column, returnValues);
      state.errorKey = validation.ok ? null : validation.errorKey;
      state.pending = !validation.ok || !candidateValuesEqual(returnValues, enumBaseValues(column));
      if (!validation.ok) {
        render(controller.getViewModel());
        focusEnumTagInput(column, state, true);
        return;
      }
      await commitEnumValues(column, state, returnValues, { focusTagInput: true });
    }
  }

  function openAdvancedSettings(trigger, tab) {
    const viewModel = controller.getViewModel();
    if (!viewModel.context || !controller.schema) return;
    settingsDraft = createSettingsDraft(controller.rules, controller.constraints, tableContextKey(viewModel.context));
    activeAdvancedTab = tab;
    advancedSaving = false;
    advancedValidationDiagnostics = null;
    advancedSaveErrorKey = null;
    element("sswb-column-search-input").value = "";
    setAdvancedTab(tab);
    if (advancedDialog.open(trigger)) renderAdvancedSettings(viewModel, localeStore.getTranslator());
  }

  function requestAdvancedClose() {
    if (advancedSaving) return false;
    if (enumEditorDirty() || (settingsDraft && settingsDraftChanged(settingsDraft))) {
      element("sswb-advanced-confirm").hidden = false;
      element("sswb-advanced-modal").querySelector("[data-advanced-discard]").focus();
      return false;
    }
    return true;
  }

  async function saveAdvancedSettings() {
    if (!settingsDraft || advancedSaving || enumEditorDirty()) return;
    const submittedDraft = settingsDraft;
    advancedSaving = true;
    advancedValidationDiagnostics = null;
    advancedSaveErrorKey = null;
    exportSaveState = null;
    previewPage = 0;
    renderAdvancedSettings(controller.getViewModel(), localeStore.getTranslator());
    const result = await controller.dispatch({
      type: "save-settings",
      contextKey: submittedDraft.contextKey,
      rules: structuredClone(submittedDraft.rules),
      constraints: structuredClone(submittedDraft.constraints),
    });
    if (!advancedDialog.isOpen || settingsDraft !== submittedDraft) return;
    advancedSaving = false;
    const saveResult = result.settingsSaveResult;
    if (saveResult?.ok) {
      advancedDialog.close();
      return;
    }
    advancedValidationDiagnostics = saveResult?.diagnostics ?? [];
    advancedSaveErrorKey = result.actionError ? "advanced.draft.saveFailed" : "advanced.draft.validationFailed";
    renderAdvancedSettings(result, localeStore.getTranslator());
  }

  function clearAdvancedValidation() {
    advancedValidationDiagnostics = null;
    advancedSaveErrorKey = null;
  }

  function setAdvancedTab(tab) {
    if (!["columns", "constraints", "diagnostics"].includes(tab)) return;
    activeAdvancedTab = tab;
    const modal = element("sswb-advanced-modal");
    for (const button of modal.querySelectorAll("[data-advanced-tab]")) {
      const selected = button.dataset.advancedTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of modal.querySelectorAll("[role=tabpanel]")) {
      panel.hidden = panel.id !== `sswb-advanced-panel-${tab}`;
    }
  }

  function renderAdvancedSettings(viewModel, t) {
    if (!settingsDraft) return;
    const modal = element("sswb-advanced-modal");
    const focusState = captureAdvancedEditorFocus();
    setAdvancedTab(activeAdvancedTab);
    const changed = settingsDraftChanged(settingsDraft);
    const settingsViewModel = {
      ...viewModel,
      constraints: structuredClone(settingsDraft.constraints),
      constraintPlan: changed ? null : viewModel.constraintPlan,
      diagnostics: advancedValidationDiagnostics ?? viewModel.diagnostics,
    };
    const sampleState = viewModel.sampleStatus?.state
      ?? (viewModel.sampleUsed === true ? "sampled" : "not_attempted");
    const sampleHintKey = `columns.sampleHint.${sampleState}`;
    element("sswb-sample-hint").textContent = t(t.has(sampleHintKey) ? sampleHintKey : "columns.sampleHint.unknown");
    renderColumns(settingsViewModel, t);
    renderConstraints(settingsViewModel, t);
    renderDiagnostics(settingsViewModel, t);
    element("sswb-rule-state").textContent = changed ? t("advanced.draft.changed") : ruleEditorStateMessage(viewModel, t);
    element("sswb-constraint-state").textContent = changed ? t("advanced.draft.changed") : constraintEditorStateMessage(viewModel, t);
    const editingDisabled = !controller.schema || advancedSaving || viewModel.status === "loading";
    for (const control of modal.querySelectorAll("[data-rule-selector], [data-rule-field], [data-constraint-kind], [data-constraint-column], [data-constraint-columns], [data-constraint-add], [data-constraint-delete], [data-enum-tag-input], [data-enum-json], [data-enum-remove], [data-enum-clear], [data-enum-clear-confirm], [data-enum-clear-cancel], [data-enum-mode], [data-enum-paste-choice], #sswb-column-search-input")) {
      control.disabled = editingDisabled;
    }
    renderAdvancedStatus(viewModel, t);
    restoreAdvancedEditorFocus(focusState);
  }

  function renderAdvancedStatus(viewModel, t) {
    const changed = (settingsDraft && settingsDraftChanged(settingsDraft)) || enumEditorDirty();
    const status = element("sswb-advanced-status");
    status.textContent = advancedSaving ? t("advanced.draft.saving")
      : advancedSaveErrorKey ? t(advancedSaveErrorKey)
        : changed ? t("advanced.draft.changed") : "";
    if (advancedSaveErrorKey) status.dataset.state = "error";
    else delete status.dataset.state;
    const unavailable = !controller.schema || !viewModel.context;
    element("sswb-advanced-modal").querySelector("[data-advanced-save]").disabled = advancedSaving || unavailable || enumEditorDirty() || viewModel.status === "loading";
    element("sswb-advanced-modal").querySelector("[data-advanced-cancel]").disabled = advancedSaving;
  }

  function addDraftConstraint(viewModel) {
    if (!settingsDraft || !controller.schema) return;
    let suffix = 1;
    while (settingsDraft.constraints.some((entry) => entry.id === `manual-${suffix}`)) suffix += 1;
    const firstColumn = viewModel.columns[0]?.column ?? "";
    settingsDraft.constraints.push({ id: `manual-${suffix}`, kind: "unique", column: firstColumn });
    clearAdvancedValidation();
    renderAdvancedSettings(viewModel, localeStore.getTranslator());
  }

  function captureAdvancedEditorFocus() {
    const active = document.activeElement;
    if (!active || !element("sswb-advanced-modal").contains(active)) return null;
    for (const [selector, keys] of [
      ["[data-rule-selector]", ["ruleColumn"]],
      ["[data-rule-field]", ["ruleColumn", "ruleField"]],
      ["[data-constraint-kind]", ["constraintId"]],
      ["[data-constraint-column]", ["constraintId"]],
      ["[data-constraint-columns]", ["constraintId"]],
    ]) {
      if (active.matches(selector)) return { selector, values: Object.fromEntries(keys.map((key) => [key, active.dataset[key]])) };
    }
    return null;
  }

  function restoreAdvancedEditorFocus(state) {
    if (!state) return;
    const match = [...element("sswb-advanced-modal").querySelectorAll(state.selector)].find((node) =>
      Object.entries(state.values).every(([key, value]) => node.dataset[key] === value));
    match?.focus();
  }

  function filterColumnRows() {
    const query = element("sswb-column-search-input").value.trim().toLocaleLowerCase();
    const rows = [...element("sswb-columns").querySelectorAll("tr[data-column-search]")];
    let visible = 0;
    for (const row of rows) {
      const matches = !query || row.dataset.columnSearch.includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    }
    element("sswb-column-search-empty").hidden = query === "" || visible > 0;
  }

  function tableContextKey(context) {
    if (!context || typeof context !== "object" || Array.isArray(context)) return `invalid:${String(context)}`;
    const normalized = { connectionId: typeof context.connectionId === "string" ? context.connectionId.trim() : "" };
    for (const key of ["database", "schema"]) {
      if (typeof context[key] === "string" && context[key].trim()) normalized[key] = context[key].trim();
    }
    normalized.table = typeof context.table === "string" ? context.table.trim() : "";
    return JSON.stringify(normalized);
  }

  /**
   * Export through the DBX Host native save path. The controller keeps
   * owning filename / MIME / serialized content; this function only encodes
   * the descriptor to UTF-8, hands it to `window.dbxPlugin.saveFile` and
   * renders the real saved / cancelled / failed outcome. The success state is
   * never set from the click itself.
   * @param {string} format
   */
  async function saveExport(format, preparedDescriptor = null) {
    if (enumDraftPending() || exportSaveState?.status === "saving" || exportSaveState?.status === "waiting") return;
    let descriptor = preparedDescriptor;
    try {
      if (!descriptor) descriptor = controller.prepareExport(format);
    } catch (error) {
      exportSaveState = { status: "prepare_failed", code: typeof error?.code === "string" ? error.code : "export_error" };
      render(controller.getViewModel());
      return;
    }
    exportSaveState = { status: "saving", descriptor };
    render(controller.getViewModel());
    exportSaveState = { status: "waiting", descriptor };
    render(controller.getViewModel());

    let result;
    try {
      const saveFile = typeof host?.saveFile === "function" ? host.saveFile.bind(host) : undefined;
      result = await saveExportWithHost(saveFile, descriptor);
    } catch {
      result = { status: "failed", code: "export_host_save_failed" };
    }
    exportSaveState = { ...result, descriptor };
    render(controller.getViewModel());
  }

  function render(viewModel) {
    const t = localeStore.getTranslator();
    const context = viewModel.context;
    const pendingEnumDraft = enumDraftPending();
    enumDraftGateActive = pendingEnumDraft;
    if ((viewModel.status === "empty" || pendingEnumDraft) && sqlDialog.isOpen) sqlDialog.close();
    if (pendingEnumDraft) {
      sqlPreviewDescriptor = null;
      sqlPreviewError = null;
    }
    renderWorkbenchContextVisibility(root, viewModel.status);
    element("sswb-database").textContent = context?.database ?? "—";
    element("sswb-schema").textContent = context?.schema ?? "—";
    element("sswb-table").textContent = context?.table ?? "—";
    element("sswb-status").textContent = statusLabel(pendingEnumDraft ? { ...viewModel, status: "dirty" } : viewModel, t);
    element("sswb-status").dataset.status = pendingEnumDraft ? "dirty" : viewModel.status;
    element("sswb-state-message").textContent = pendingEnumDraft ? t("enumInput.fixFirst") : stateMessage(viewModel, t);
    element("sswb-state-message").dataset.status = pendingEnumDraft ? "dirty" : viewModel.status;
    element("sswb-state-message").hidden = !pendingEnumDraft && Boolean(viewModel.context && viewModel.plan
      && ["idle", "dirty"].includes(viewModel.status));
    const previewIsStale = viewModel.preview.rows.length > 0 && !viewModel.lastSuccessfulParametersCurrent;
    element("sswb-preview-stale").textContent = previewIsStale ? t("advanced.previewStale") : "";
    element("sswb-preview-stale").hidden = !previewIsStale;
    const diagnosticCounts = diagnosticSummaryCounts(viewModel, t);
    const diagnosticCount = diagnosticCounts.blocking + diagnosticCounts.pending + diagnosticCounts.issues;
    const diagnosticLink = element("sswb-diagnostics-link");
    diagnosticLink.hidden = diagnosticCount === 0;
    diagnosticLink.textContent = diagnosticCount > 0 ? t("actions.diagnosticsLink", { count: diagnosticCount }) : "";
    element("sswb-action-error").textContent = viewModel.actionError ? actionErrorMessage(viewModel.actionError, t) : "";
    element("sswb-action-error").hidden = !viewModel.actionError;
    const rowInput = element("sswb-rows");
    const seedInput = element("sswb-seed");
    const localeInput = element("sswb-locale");
    if (document.activeElement !== rowInput) rowInput.value = String(viewModel.controls.rowCount);
    if (document.activeElement !== seedInput) seedInput.value = viewModel.controls.seed;
    if (document.activeElement !== localeInput) localeInput.value = viewModel.controls.locale;
    const previewButton = root.querySelector('[data-sswb-action="preview"]');
    previewButton.textContent = t(viewModel.previewAction.labelKey);
    previewButton.disabled = pendingEnumDraft || viewModel.previewAction.disabled;
    previewButton.dataset.previewState = viewModel.previewAction.state.toLowerCase();
    if (viewModel.previewAction.busy) previewButton.setAttribute("aria-busy", "true");
    else previewButton.removeAttribute("aria-busy");
    for (const control of root.querySelector(".sswb").querySelectorAll("button, input, select, textarea")) {
      if (control.id === "sswb-ui-locale") continue;
      control.disabled = viewModel.status === "loading";
    }
    renderPreview(viewModel, t, pendingEnumDraft);
    renderSqlPreview(viewModel, t, pendingEnumDraft);
    renderAdvancedSettings(viewModel, t);
    const exportBusy = exportSaveState?.status === "saving" || exportSaveState?.status === "waiting";
    const exportDisabled = pendingEnumDraft || !viewModel.export.enabled || viewModel.status === "loading" || exportBusy;
    const exportHint = pendingEnumDraft ? t("enumInput.fixFirst")
      : exportDisabled && !exportBusy ? exportDisabledHint(viewModel, t) : "";
    for (const id of ["sswb-export-csv", "sswb-export-json", "sswb-export-sql"]) {
      element(id).disabled = exportDisabled;
      element(id).title = exportHint;
    }
    const exportMessage = pendingEnumDraft ? t("enumInput.previewInvalid")
      : exportSaveState ? exportSaveMessage(exportSaveState, t) : exportStatusMessage(viewModel, t);
    element("sswb-export-message").textContent = exportMessage ?? "";
  }

  function renderColumns(viewModel, t) {
    const body = element("sswb-columns");
    body.replaceChildren();
    const columns = viewModel.columns.map((column) => draftColumnViewModel(column, t));
    if (columns.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = viewModel.status === "loading" ? t("columns.empty.loading") : t("columns.empty.none");
      row.append(cell);
      body.append(row);
      return;
    }
    for (const column of columns) {
      const row = document.createElement("tr");
      row.dataset.columnSearch = `${column.column} ${column.schemaType}`.toLocaleLowerCase();
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
      if (column.recommendation) {
        const recommendation = document.createElement("small");
        recommendation.className = "sswb-recommendation";
        recommendation.textContent = t("columns.recommendation", { rule: column.recommendation.label });
        strategy.append(recommendation);
      }
      strategy.append(renderRuleEditor(column, t, column.generationRule.kind === "enum" ? enumEditorState(column) : null));
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
      const fieldStatus = viewModel.sampleStatus?.fields?.find((entry) => entry.column === column.column);
      const needsSemanticConfirmation = column.ruleDiagnostics.some((entry) => entry.code === "semantic_confirmation_required");
      if (fieldStatus && (fieldStatus.state !== "skipped" || needsSemanticConfirmation)) {
        const sampleNote = document.createElement("small");
        sampleNote.className = "sswb-sample-status";
        sampleNote.textContent = sampleFieldStatusText(fieldStatus, t);
        detailsCell.append(sampleNote);
      }
      row.append(detailsCell);
      body.append(row);
    }
    filterColumnRows();
  }

  function draftColumnViewModel(column, t) {
    if (!settingsDraft) return column;
    const rule = editableRule(settingsDraft.rules[column.column] ?? column.generationRule);
    const schemaColumn = controller.schema?.columns.find((entry) => entry.name === column.column);
    const fields = schemaColumn
      ? getGenerationRuleEditorFields(schemaColumn, rule).map((field) => ({ ...field, label: ruleFieldLabel(field, rule.kind, t) }))
      : column.ruleFields;
    const selectedMapping = rule.kind === "auto" ? column.selectedMapping
      : rule.kind === "semantic"
        ? (t.has(`semantic.${rule.semanticType}`) ? t(`semantic.${rule.semanticType}`) : String(rule.semanticType ?? ""))
        : (t.has(`ruleKind.${rule.kind}`) ? t(`ruleKind.${rule.kind}`) : rule.kind);
    return { ...column, generationRule: rule, ruleFields: fields, selectedMapping };
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
      empty.textContent = ["loading", "blocked", "error"].includes(viewModel.status)
        ? diagnosticsEmptyMessage(viewModel, t) : t("advanced.diagnostics.none");
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

  function sampleFieldStatusText(status, t) {
    if (!status || typeof status.state !== "string") return t("columns.sampleFieldStatus.unknown");
    const params = {
      sampleCount: Number.isSafeInteger(status.sampleCount) ? status.sampleCount : 0,
      matchedCount: Number.isSafeInteger(status.matchedCount) ? status.matchedCount : 0,
    };
    if (status.state === "skipped") {
      return t(status.reason === "high_confidence_semantic"
        ? "columns.sampleFieldStatus.skippedSemantic" : "columns.sampleFieldStatus.skipped");
    }
    if (status.state === "used" && status.summaryKind === "chinese_name_pattern") {
      return t("columns.sampleFieldStatus.namePatternUsed", params);
    }
    if (status.state === "used" && status.summaryKind === "chinese_name_pattern_rejected") {
      return t("columns.sampleFieldStatus.namePatternRejected", params);
    }
    if (status.state === "insufficient" && status.summaryKind === "chinese_name_pattern") {
      return t("columns.sampleFieldStatus.namePatternInsufficient", params);
    }
    const key = `columns.sampleFieldStatus.${status.state}`;
    return t(t.has(key) ? key : "columns.sampleFieldStatus.unknown", params);
  }

  function openSqlPreview(trigger) {
    if (enumDraftPending() || !sqlDialog.open(trigger)) return;
    exportSaveState = null;
    sqlPreviewDescriptor = null;
    sqlPreviewError = null;
    sqlCopyStatus = null;
    sqlCopyInProgress = false;
    const viewModel = controller.getViewModel();
    const codeScroll = element("sswb-sql-code-scroll");
    codeScroll.scrollTop = 0;
    codeScroll.scrollLeft = 0;
    renderSqlPreviewModal(viewModel, localeStore.getTranslator());
    try {
      const descriptor = controller.prepareExport("sql");
      if (typeof descriptor?.content !== "string") throw new TypeError("SQL export did not return text");
      if (descriptor.content.length === 0) sqlPreviewError = localeStore.getTranslator()("preview.sqlEmpty");
      else sqlPreviewDescriptor = descriptor;
    } catch (error) {
      sqlPreviewError = error?.code ? exportErrorMessage(error, localeStore.getTranslator()) : localeStore.getTranslator()("preview.sqlError");
    }
    renderSqlPreviewModal(controller.getViewModel(), localeStore.getTranslator());
  }

  async function copyPreviewSql() {
    if (!sqlPreviewDescriptor || sqlCopyInProgress) return;
    sqlCopyInProgress = true;
    sqlCopyStatus = "copying";
    renderSqlPreviewModal(controller.getViewModel(), localeStore.getTranslator());
    try {
      await copyTextToClipboard(sqlPreviewDescriptor.content);
      sqlCopyStatus = "copied";
    } catch {
      sqlCopyStatus = "failed";
    } finally {
      sqlCopyInProgress = false;
      renderSqlPreviewModal(controller.getViewModel(), localeStore.getTranslator());
    }
  }

  function renderSqlPreview(viewModel, t, pendingEnumDraft = false) {
    const button = element("sswb-preview-sql");
    button.disabled = pendingEnumDraft || !viewModel.export.enabled;
    button.title = pendingEnumDraft ? t("enumInput.fixFirst")
      : button.disabled ? exportDisabledHint(viewModel, t) : "";
    if (pendingEnumDraft || !viewModel.export.enabled) {
      sqlPreviewDescriptor = null;
      sqlPreviewError = null;
      sqlCopyStatus = null;
      if (sqlDialog.isOpen) sqlDialog.close();
    }
    renderSqlPreviewModal(viewModel, t);
  }

  function renderSqlPreviewModal(viewModel, t) {
    const descriptor = sqlPreviewDescriptor;
    const target = viewModel.table;
    const qualifier = target?.schema ?? target?.database;
    const tableName = target?.table
      ? [qualifier, target.table].filter(Boolean).join(".")
      : "—";
    const rowCount = descriptor?.summary?.rowCount ?? viewModel.export?.rowCount ?? 0;
    element("sswb-sql-modal-meta").textContent = t("preview.sqlMeta", { rows: rowCount, table: tableName });

    const error = element("sswb-sql-modal-error");
    error.hidden = !sqlPreviewError;
    error.textContent = sqlPreviewError ?? "";
    const codeScroll = element("sswb-sql-code-scroll");
    const code = element("sswb-sql-code");
    codeScroll.hidden = descriptor === null;
    if (descriptor && code.textContent !== descriptor.content) renderSqlCode(code, descriptor.content);

    const copyButton = element("sswb-sql-modal").querySelector("[data-sswb-sql-modal-copy]");
    const exportButton = element("sswb-sql-modal").querySelector("[data-sswb-sql-modal-export]");
    const exportBusy = exportSaveState?.status === "saving" || exportSaveState?.status === "waiting";
    copyButton.disabled = descriptor === null || sqlCopyInProgress;
    exportButton.disabled = descriptor === null || exportBusy;

    const status = element("sswb-sql-modal-status");
    const modalExportState = descriptor && exportSaveState?.descriptor === descriptor ? exportSaveState : null;
    let statusMessage = "";
    if (sqlCopyStatus === "copying") statusMessage = t("preview.sqlCopying");
    else if (sqlCopyStatus === "copied") statusMessage = t("preview.sqlCopied");
    else if (sqlCopyStatus === "failed") statusMessage = t("preview.sqlCopyFailed");
    else if (modalExportState) statusMessage = exportSaveMessage(modalExportState, t) ?? "";
    status.textContent = statusMessage;
    if (sqlCopyStatus === "failed" || modalExportState?.status === "failed" || modalExportState?.status === "prepare_failed") status.dataset.state = "error";
    else if (sqlCopyStatus === "copied" || modalExportState?.status === "saved") status.dataset.state = "success";
    else delete status.dataset.state;
  }

  function renderSqlCode(code, sql) {
    const tokens = /(--[^\r\n]*|'(?:''|[^'])*'|\b(?:INSERT|INTO|VALUES)\b|\b(?:NULL|TRUE|FALSE)\b)/giu;
    const content = document.createDocumentFragment();
    let offset = 0;
    for (const match of sql.matchAll(tokens)) {
      const [token] = match;
      const start = match.index ?? 0;
      if (start > offset) content.append(document.createTextNode(sql.slice(offset, start)));
      const part = document.createElement("span");
      part.className = token.startsWith("--") ? "sswb-sql-token-comment"
        : token.startsWith("'") ? "sswb-sql-token-string"
          : /^(?:NULL|TRUE|FALSE)$/iu.test(token) ? "sswb-sql-token-value" : "sswb-sql-token-keyword";
      part.textContent = token;
      content.append(part);
      offset = start + token.length;
    }
    if (offset < sql.length) content.append(document.createTextNode(sql.slice(offset)));
    code.replaceChildren(content);
  }

  function renderPreview(viewModel, t, pendingEnumDraft = false) {
    const header = element("sswb-preview-head");
    const body = element("sswb-preview-body");
    const rows = pendingEnumDraft ? [] : viewModel.preview.rows;
    const hasRows = rows.length > 0;
    const hasPreparedPlan = Boolean(viewModel.plan);
    const showEmptyState = pendingEnumDraft || Boolean(viewModel.context && hasPreparedPlan && !hasRows
      && ["idle", "dirty", "error"].includes(viewModel.status));
    const empty = element("sswb-preview-empty");
    empty.hidden = !showEmptyState;
    if (pendingEnumDraft) {
      empty.querySelector("strong").textContent = t("enumInput.fixFirst");
      empty.querySelector("p").textContent = t("enumInput.previewInvalid");
    } else {
      empty.querySelector("strong").textContent = t("preview.empty.title");
      empty.querySelector("p").textContent = t("preview.empty.helper");
    }
    element("sswb-preview-scroll").hidden = !hasRows;
    header.replaceChildren();
    body.replaceChildren();
    element("sswb-preview-summary").textContent = pendingEnumDraft ? t("enumInput.previewInvalid") : previewSummary(viewModel, t);
    const pagination = paginatePreviewRows(rows, previewPage);
    previewPage = pagination.page;
    const paginationNav = element("sswb-preview-pagination");
    paginationNav.hidden = pendingEnumDraft || pagination.pageCount <= 1;
    paginationNav.setAttribute("aria-label", t("preview.pagination.ariaLabel"));
    element("sswb-preview-previous").disabled = pagination.page === 0;
    element("sswb-preview-next").disabled = pagination.page >= pagination.pageCount - 1;
    element("sswb-preview-page-info").textContent = pagination.pageCount > 1
      ? t("preview.pagination.info", {
        start: pagination.startRow,
        end: pagination.endRow,
        total: pagination.totalRows,
        page: pagination.page + 1,
        pages: pagination.pageCount,
      })
      : "";
    for (const column of viewModel.preview.columns) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column;
      header.append(cell);
    }
    for (const previewRow of pagination.rows) {
      const row = document.createElement("tr");
      for (const column of viewModel.preview.columns) {
        const cell = document.createElement("td");
        const value = previewRow[column];
        cell.textContent = value === null ? t("preview.null")
          : isJsonDocumentValue(value) ? serializeJsonDocumentValue(value)
            : typeof value === "string" ? value : JSON.stringify(value);
        if (value === null) cell.className = "sswb-null";
        row.append(cell);
      }
      body.append(row);
    }
  }

  return () => {
    if (advancedDialog.isOpen) advancedDialog.close();
    if (sqlDialog.isOpen) sqlDialog.close();
    unsubscribeRender();
    unsubscribeContext();
    root.removeEventListener("change", onControlsChange);
    root.removeEventListener("input", onInput);
    root.removeEventListener("input", onEnumInput);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("keydown", onEnumKeydown);
    root.removeEventListener("paste", onEnumPaste);
    root.removeEventListener("click", onClick);
  };
}

function renderRuleEditor(column, t, enumState) {
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
    if (field.key === "values" && column.generationRule.kind === "enum") {
      fields.append(renderEnumEditor(column, enumState, t));
      continue;
    }
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
      input.rows = 1;
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

function renderEnumEditor(column, state, t) {
  const editor = document.createElement("div");
  editor.className = "sswb-enum-editor";
  editor.dataset.enumColumn = column.column;
  const values = Array.isArray(state.draftValues) ? state.draftValues
    : Array.isArray(column.generationRule.values) ? column.generationRule.values : [];
  const heading = document.createElement("label");
  heading.className = "sswb-enum-label";
  heading.textContent = state.mode === "tags" ? t("enumInput.label") : t("enumInput.jsonLabel");
  editor.append(heading);

  if (state.mode === "tags") {
    const surface = document.createElement("div");
    surface.className = "sswb-enum-surface";
    const tags = document.createElement("div");
    tags.className = "sswb-enum-tags";
    tags.setAttribute("role", "list");
    tags.setAttribute("aria-label", t("enumInput.label"));
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const tag = document.createElement("span");
      tag.className = "sswb-enum-tag";
      tag.setAttribute("role", "listitem");
      const text = document.createElement("span");
      text.className = "sswb-enum-tag-text";
      text.textContent = typeof value === "string" ? (value === "" ? '""' : value) : JSON.stringify(value);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "sswb-enum-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", t("enumInput.remove", { candidate: typeof value === "string" ? value : JSON.stringify(value) }));
      remove.dataset.enumRemove = "true";
      remove.dataset.enumIndex = String(index);
      remove.dataset.ruleColumn = column.column;
      tag.append(text, remove);
      tags.append(tag);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.value = state.tagDraft ?? "";
    input.placeholder = t("enumInput.placeholder");
    input.setAttribute("aria-label", t("enumInput.ariaInput"));
    input.setAttribute("autocomplete", "off");
    input.dataset.enumTagInput = "true";
    input.dataset.ruleColumn = column.column;
    surface.append(tags, input);
    editor.append(surface);
  } else {
    const input = document.createElement("textarea");
    input.rows = 5;
    input.value = state.jsonDraft ?? JSON.stringify(values, null, 2);
    input.setAttribute("aria-label", t("enumInput.ariaJson"));
    input.dataset.enumJson = "true";
    input.dataset.ruleColumn = column.column;
    editor.append(input);
  }

  const footer = document.createElement("div");
  footer.className = "sswb-enum-footer";
  const count = document.createElement("span");
  count.className = "sswb-enum-count";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  count.dataset.enumCount = "true";
  count.textContent = t("enumInput.count", { count: values.length });
  footer.append(count);

  if (state.mode === "tags") {
    const advanced = document.createElement("button");
    advanced.type = "button";
    advanced.className = "sswb-enum-link";
    advanced.textContent = t("enumInput.advanced");
    advanced.dataset.enumMode = "json";
    advanced.dataset.ruleColumn = column.column;
    footer.append(advanced);

    if (state.confirmClear) {
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "sswb-button sswb-enum-clear-confirm";
      confirm.textContent = t("enumInput.clearConfirm");
      confirm.dataset.enumClearConfirm = "true";
      confirm.dataset.ruleColumn = column.column;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "sswb-enum-link";
      cancel.textContent = t("enumInput.clearCancel");
      cancel.dataset.enumClearCancel = "true";
      cancel.dataset.ruleColumn = column.column;
      footer.append(confirm, cancel);
    } else {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "sswb-enum-link";
      clear.textContent = t("enumInput.clear");
      clear.disabled = values.length === 0;
      clear.dataset.enumClear = "true";
      clear.dataset.ruleColumn = column.column;
      footer.append(clear);
    }
  } else if (column.schemaFamily === "varchar") {
    const parsed = typeof state.jsonDraft === "string" ? parseCandidateJson(state.jsonDraft) : null;
    const returnValues = parsed ? (parsed.ok ? parsed.values : null) : values;
    const canReturn = Array.isArray(returnValues) && returnValues.every((value) => typeof value === "string");
    const back = document.createElement("button");
    back.type = "button";
    back.className = "sswb-enum-link";
    back.textContent = t("enumInput.backToTags");
    back.disabled = !canReturn;
    back.title = canReturn ? "" : t("enumInput.returnNotLossless");
    back.dataset.enumMode = "tags";
    back.dataset.ruleColumn = column.column;
    footer.append(back);
    if (!canReturn) {
      const lossless = document.createElement("span");
      lossless.className = "sswb-enum-lossless-hint";
      lossless.textContent = t("enumInput.returnNotLossless");
      editor.append(lossless);
    }
  }
  editor.append(footer);

  if (state.mode === "tags" && state.pasteOptions) {
    const choices = document.createElement("div");
    choices.className = "sswb-enum-paste-choices";
    choices.dataset.enumPasteChoices = "true";
    const split = document.createElement("button");
    split.type = "button";
    split.className = "sswb-button";
    split.textContent = t("enumInput.pasteSplitComma");
    split.dataset.enumPasteChoice = "split";
    split.dataset.ruleColumn = column.column;
    const single = document.createElement("button");
    single.type = "button";
    single.className = "sswb-button";
    single.textContent = t("enumInput.pasteAsOne");
    single.dataset.enumPasteChoice = "single";
    single.dataset.ruleColumn = column.column;
    choices.append(split, single);
    editor.append(choices);
  }

  const feedback = document.createElement("p");
  feedback.className = "sswb-enum-error";
  feedback.setAttribute("role", "alert");
  feedback.setAttribute("aria-live", "polite");
  feedback.dataset.enumError = "true";
  feedback.textContent = state.errorKey ? t(state.errorKey)
    : state.pending ? t("enumInput.previewInvalid") : "";
  feedback.hidden = !state.errorKey && !state.pending;
  feedback.dataset.severity = state.errorKey ? "error" : "info";
  editor.append(feedback);
  return editor;
}

function enumContextIdentity(context) {
  if (context === null || context === undefined) return "empty";
  try {
    return JSON.stringify([context.connectionId, context.database ?? null, context.schema ?? null, context.table ?? null]);
  } catch {
    return `invalid:${String(context)}`;
  }
}

function viewColumn(name, controller) {
  return controller.getViewModel().columns.find((column) => column.column === name);
}

function editableRule(rule) {
  const editable = structuredClone(rule ?? { kind: "auto" });
  delete editable.identity;
  return editable;
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
