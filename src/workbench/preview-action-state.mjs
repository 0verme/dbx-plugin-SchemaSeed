export const PREVIEW_ACTION_STATES = Object.freeze({
  EMPTY: "EMPTY",
  GENERATING: "GENERATING",
  READY: "READY",
  DIRTY: "DIRTY",
  ERROR: "ERROR",
});

/**
 * Derive the user-facing preview lifecycle from the controller's current
 * context and committed dataset. Validation plans alone are not READY data.
 * @param {{ status: string, stage: string, context: object | null, canGenerate: boolean, hasCurrentDataset: boolean }} state
 * @returns {keyof typeof PREVIEW_ACTION_STATES}
 */
export function previewState(state) {
  if (state.status === "loading" && state.stage === "generation") return PREVIEW_ACTION_STATES.GENERATING;
  if (state.status === "error") return PREVIEW_ACTION_STATES.ERROR;
  if (!state.context || state.status === "empty" || !state.canGenerate) return PREVIEW_ACTION_STATES.EMPTY;
  if (state.hasCurrentDataset && ["ready", "warning"].includes(state.status)) return PREVIEW_ACTION_STATES.READY;
  if (["dirty", "blocked"].includes(state.status)) return PREVIEW_ACTION_STATES.DIRTY;
  return PREVIEW_ACTION_STATES.EMPTY;
}

/**
 * Keep the single primary action's label and behavior derived from one state.
 * @param {{ status: string, stage: string, context: object | null, canGenerate: boolean, hasCurrentDataset: boolean }} state
 * @returns {{ state: string, action: string, labelKey: string, disabled: boolean, busy: boolean }}
 */
export function previewPrimaryAction(state) {
  const currentState = previewState(state);
  if (currentState === PREVIEW_ACTION_STATES.GENERATING) {
    return { state: currentState, action: "generate", labelKey: "actions.generatingPreview", disabled: true, busy: true };
  }
  if (currentState === PREVIEW_ACTION_STATES.READY) {
    return { state: currentState, action: "generate-new-data", labelKey: "actions.generateNewData", disabled: false, busy: false };
  }
  if (currentState === PREVIEW_ACTION_STATES.DIRTY) {
    return { state: currentState, action: "generate", labelKey: "actions.regeneratePreview", disabled: !state.canGenerate, busy: false };
  }
  if (currentState === PREVIEW_ACTION_STATES.ERROR) {
    const metadataRetry = state.stage === "metadata" && Boolean(state.context);
    return {
      state: currentState,
      action: metadataRetry ? "retry" : "generate",
      labelKey: metadataRetry ? "actions.retry" : "actions.retryGeneration",
      disabled: metadataRetry ? false : !state.canGenerate,
      busy: false,
    };
  }
  return {
    state: currentState,
    action: "generate",
    labelKey: "actions.generate",
    disabled: !state.canGenerate || state.status === "loading",
    busy: false,
  };
}
