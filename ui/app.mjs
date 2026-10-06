import { browserUiLocaleStorage, createUiLocaleStore, readHostLocale } from "./src/i18n/ui-locale.mjs";
import { showFatalBootError } from "./src/bootstrap-error-state.mjs";

const GENERATION_WORKBENCH_SUFFIX = ".generation-workbench";
const PHASE0_WORKBENCH_SUFFIX = ".schema-metadata-probe";
let latestInit = null;

document.addEventListener("dbx-plugin-init", (event) => {
  latestInit = event.detail;
}, { once: true });

async function start() {
  const host = window.dbxPlugin;
  const elements = {
    boot: document.getElementById("boot-state"),
    bootMessage: document.getElementById("boot-message"),
    fatal: document.getElementById("boot-fatal"),
    title: document.getElementById("boot-fatal-title"),
    description: document.getElementById("boot-fatal-description"),
    detail: document.getElementById("boot-fatal-detail"),
    retryButton: document.getElementById("boot-retry"),
    phase0Root: document.getElementById("phase0-probe"),
    generationRoot: document.getElementById("generation-workbench-root"),
  };
  // The interface language is resolved before any plugin work so that even boot
  // and failure messages follow the user's language.
  const localeStore = createUiLocaleStore({
    storage: browserUiLocaleStorage(),
    hostLocale: readHostLocale(host),
    navigatorLanguage: globalThis.navigator?.language,
  });
  const t = localeStore.getTranslator();
  document.documentElement.lang = t.locale;
  resetBootState(elements, t);

  const fail = (stage, error) => showFatalBootError({
    ...elements,
    titleText: t("app.boot.errorTitle"),
    descriptionText: t("app.boot.errorDescription"),
    errorLabel: t("app.boot.errorLabel"),
    retryText: t("app.boot.retry"),
    redactedText: t("app.boot.redacted"),
    stage,
    error,
  });

  if (!host) {
    fail("Host bootstrap", new Error(t("app.boot.bridgeUnavailable")));
    return;
  }

  let stage = "Host initialization";
  try {
    await host.ready;
    stage = "contribution routing";
    const context = host.context;
    const contributionId = latestInit?.contributionId;
    const isGenerationWorkbench = typeof contributionId === "string" && contributionId.endsWith(GENERATION_WORKBENCH_SUFFIX);
    const isPhase0Workbench = typeof contributionId === "string" && contributionId.endsWith(PHASE0_WORKBENCH_SUFFIX);
    if (isGenerationWorkbench || (!isPhase0Workbench && isTableContext(context))) {
      elements.phase0Root.hidden = true;
      stage = "Generation module import";
      const { mountGenerationWorkbench } = await import("./generation-workbench/app.mjs");
      elements.generationRoot.hidden = false;
      stage = "Generation workbench mount";
      await mountGenerationWorkbench(elements.generationRoot, host, context, { localeStore });
      elements.boot.hidden = true;
      return;
    }
    elements.phase0Root.hidden = false;
    stage = "Probe module import";
    await import("./probe-app.mjs");
    elements.boot.hidden = true;
  } catch (error) {
    fail(stage, error);
  }
}

function resetBootState(elements, t) {
  elements.boot.hidden = false;
  elements.boot.setAttribute("role", "status");
  elements.bootMessage.hidden = false;
  elements.bootMessage.textContent = t("app.boot.connecting");
  elements.fatal.hidden = true;
  elements.title.hidden = true;
  elements.description.hidden = true;
  elements.detail.hidden = true;
  elements.retryButton.hidden = true;
  elements.phase0Root.hidden = true;
  elements.generationRoot.hidden = true;
}

function isTableContext(value) {
  return value !== null && typeof value === "object"
    && typeof value.connectionId === "string" && typeof value.table === "string";
}

document.getElementById("boot-retry").addEventListener("click", () => void start());
void start();
