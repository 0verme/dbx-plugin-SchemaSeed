import { browserUiLocaleStorage, createUiLocaleStore, readHostLocale } from "./src/i18n/ui-locale.mjs";
import { showFatalBootError } from "./src/bootstrap-error-state.mjs";

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
    generationRoot: document.getElementById("generation-workbench-root"),
  };
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
    stage = "Generation module import";
    const { mountGenerationWorkbench } = await import("./generation-workbench/app.mjs");
    elements.generationRoot.hidden = false;
    stage = "Generation workbench mount";
    await mountGenerationWorkbench(elements.generationRoot, host, host.context ?? latestInit?.context);
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
  elements.generationRoot.hidden = true;
}

document.getElementById("boot-retry").addEventListener("click", () => void start());
void start();
