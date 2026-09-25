import { browserUiLocaleStorage, createUiLocaleStore, readHostLocale } from "../src/i18n/ui-locale.mjs";

const GENERATION_WORKBENCH_ID = "io.github.0verme.schema-seed.generation-workbench";
const PHASE0_WORKBENCH_ID = "io.github.0verme.schema-seed.schema-metadata-probe";
let latestInit = null;

document.addEventListener("dbx-plugin-init", (event) => {
  latestInit = event.detail;
}, { once: true });

async function start() {
  const host = window.dbxPlugin;
  const boot = document.getElementById("boot-state");
  // The interface language is resolved before any plugin work so that even boot
  // and failure messages follow the user's language.
  const localeStore = createUiLocaleStore({
    storage: browserUiLocaleStorage(),
    hostLocale: readHostLocale(host),
    navigatorLanguage: globalThis.navigator?.language,
  });
  const t = localeStore.getTranslator();
  document.documentElement.lang = t.locale;
  boot.textContent = t("app.boot.connecting");
  if (!host) {
    boot.textContent = t("app.boot.bridgeUnavailable");
    return;
  }
  try {
    await host.ready;
    const context = host.context;
    const contributionId = latestInit?.contributionId;
    if (contributionId === GENERATION_WORKBENCH_ID || (contributionId !== PHASE0_WORKBENCH_ID && isTableContext(context))) {
      document.getElementById("phase0-probe").hidden = true;
      const root = document.getElementById("generation-workbench-root");
      root.hidden = false;
      boot.hidden = true;
      const { mountGenerationWorkbench } = await import("./generation-workbench/app.mjs");
      await mountGenerationWorkbench(root, host, context, { localeStore });
      return;
    }
    document.getElementById("phase0-probe").hidden = false;
    boot.hidden = true;
    await import("./probe-app.mjs");
  } catch (error) {
    boot.textContent = t("app.boot.failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

function isTableContext(value) {
  return value !== null && typeof value === "object"
    && typeof value.connectionId === "string" && typeof value.table === "string";
}

void start();
