/**
 * Workbench presentation messages.
 *
 * These functions translate the Workbench view model (pure state, owned by the
 * controllers) into localized copy. Keeping them here instead of in the DOM
 * code means the wording can be tested without a browser and the UI file only
 * wires elements to messages.
 *
 * None of these helpers change state, block/allow generation, or touch the
 * dataset: they render what the controller already decided.
 */

/** @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t */
export function statusLabel(viewModel, t) {
  if (viewModel.status === "loading") {
    return viewModel.stage === "metadata" ? t("status.loading.metadata") : t("status.loading.generation");
  }
  if (viewModel.status === "dirty") return t("status.dirty");
  if (viewModel.status === "ready") return t("status.ready");
  if (viewModel.status === "warning") return t("status.warning");
  if (viewModel.status === "blocked") return t("status.blocked");
  if (viewModel.status === "empty") return t("status.empty");
  return t("status.error");
}

/** @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t */
export function stateMessage(viewModel, t) {
  if (viewModel.status === "dirty") return t("state.dirty");
  if (viewModel.status === "loading") {
    return viewModel.stage === "metadata" ? t("state.loading.metadata") : t("state.loading.generation");
  }
  if (viewModel.status === "blocked" && viewModel.diagnostics.some((entry) => entry.code === "metadata_capability_unavailable")) {
    return t("state.blocked.metadataCapability");
  }
  if (viewModel.status === "blocked") {
    return viewModel.plan ? t("state.blocked.plan") : t("state.blocked.context");
  }
  if (viewModel.status === "error") return t("state.error");
  if (viewModel.status === "warning") return t("state.warning");
  return t("state.ready");
}

/** @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t */
export function ruleEditorStateMessage(viewModel, t) {
  const state = viewModel.ruleEditor?.state;
  if (state === "loading") return t("ruleEditor.state.loading");
  if (state === "validating") return t("ruleEditor.state.validating");
  if (state === "generating") return t("ruleEditor.state.generating");
  if (state === "error") return t("ruleEditor.state.error");
  if (state === "dirty") return t("ruleEditor.state.dirty");
  if (state === "blocked") return t("ruleEditor.state.blocked");
  if (state === "warning") return t("ruleEditor.state.warning");
  return t("ruleEditor.state.ready");
}

/** @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t */
export function constraintEditorStateMessage(viewModel, t) {
  const state = viewModel.constraintEditor?.state;
  if (state === "loading") return t("constraints.state.loading");
  if (state === "validating") return t("constraints.state.validating");
  if (state === "dirty") return t("constraints.state.dirty");
  if (state === "blocked") return t("constraints.state.blocked");
  if (state === "error") return t("constraints.state.error");
  if (state === "warning") return t("constraints.state.warning");
  return t("constraints.state.ready");
}

/** @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t */
export function diagnosticsEmptyMessage(viewModel, t) {
  if (viewModel.status === "loading") return t("diagnostics.empty.loading");
  if (viewModel.status === "blocked") return t("diagnostics.empty.blocked");
  if (viewModel.status === "error") return t("diagnostics.empty.error");
  if (viewModel.status === "warning") return t("diagnostics.empty.warning");
  return t("diagnostics.empty.none");
}

/** @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t */
export function previewSummary(viewModel, t) {
  if (viewModel.plan) {
    return t("preview.summary", {
      rows: viewModel.plan.rowCount,
      seed: viewModel.plan.seed,
      // The generation locale is a data-language value, not the UI language:
      // it is shown as the raw setting so the two cannot be confused.
      locale: viewModel.plan.locale,
      profile: viewModel.plan.determinismProfile,
    });
  }
  return viewModel.context ? t("preview.caption.waitingPlan") : t("preview.caption.waitingContext");
}

/**
 * Inline message next to the export buttons.
 * @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t
 */
export function exportStatusMessage(viewModel, t) {
  if (viewModel.status === "blocked") return t("export.error.export_blocked_plan");
  if (viewModel.status === "loading" || !viewModel.export?.enabled) return t("export.unavailable");
  return t("export.ready");
}

/**
 * Tooltip explaining why the export buttons are disabled.
 * @param {Record<string, any>} viewModel @param {import("./index.mjs").Translator} t
 */
export function exportDisabledHint(viewModel, t) {
  if (viewModel.status === "blocked") return t("export.error.export_blocked_plan");
  return t("export.disabledHint");
}

/** @param {{ summary: { rowCount: number, format: string } }} descriptor @param {import("./index.mjs").Translator} t */
export function exportResultMessage(descriptor, t) {
  return t("export.done", { rows: descriptor.summary.rowCount, format: descriptor.summary.format });
}

/** @param {unknown} error @param {import("./index.mjs").Translator} t */
export function exportErrorMessage(error, t) {
  const code = typeof (/** @type {any} */ (error)?.code) === "string" ? /** @type {any} */ (error).code : "export_error";
  const localized = t.has(`export.error.${code}`) ? t(`export.error.${code}`) : t("export.error.export_error");
  return t("export.failed", { code, message: localized });
}

/**
 * Fallback for action errors raised by a controller. The Core / controller
 * message is a technical detail; the surrounding sentence is localized.
 * @param {unknown} message @param {import("./index.mjs").Translator} t
 */
export function actionErrorMessage(message, t) {
  return t("error.actionFailed", { message: String(message ?? "") });
}
