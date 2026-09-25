import { createI18n, normalizeUiLocale, resolveUiLocale } from "./index.mjs";

/**
 * UI language resolution and persistence for the Workbench.
 *
 * This is strictly the *interface* language. The Workbench also has a
 * synthetic data language (`zh-CN` / `en`) that changes generated values; the
 * two are independent and must never be derived from each other.
 */

export const UI_LOCALE_STORAGE_KEY = "schemaseed.workbench.uiLocale";

/**
 * Read a locale the DBX Host actually exposes.
 *
 * DBX Host API ^1.3 does not publish a locale: `capabilities`, `context`,
 * `invoke`, `onContext` and `getTableMetadata` carry none. SchemaSeed therefore
 * never invents a host locale. If a future host exposes one of these fields
 * with a real string value, the locale strategy applies it with the highest
 * priority; otherwise `undefined` makes the resolver fall through to the saved
 * and browser locales.
 * @param {Record<string, any> | null | undefined} host
 */
export function readHostLocale(host) {
  for (const candidate of [host?.locale, host?.uiLocale, host?.language]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
}

/** @param {{ getItem: (key: string) => string | null } | null | undefined} storage */
export function readSavedLocale(storage) {
  try {
    const value = storage?.getItem(UI_LOCALE_STORAGE_KEY);
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** @param {{ setItem: (key: string, value: string) => unknown } | null | undefined} storage @param {string} locale */
export function saveUiLocale(storage, locale) {
  try {
    storage?.setItem(UI_LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

/** Browser storage when available; never throws in restricted WebViews. */
export function browserUiLocaleStorage(globalObject = globalThis) {
  try {
    return globalObject?.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Small state holder for the UI language. It owns nothing else: changing the
 * UI language never touches generation controls, the GenerationPlan, the
 * dataset or the diagnostics.
 *
 * @param {{ storage?: { getItem: (key: string) => string | null, setItem: (key: string, value: string) => unknown } | null, hostLocale?: unknown, navigatorLanguage?: unknown, onChange?: (translator: import("./index.mjs").Translator) => void }} [options]
 */
export function createUiLocaleStore(options = {}) {
  const storage = options.storage ?? null;
  const initial = resolveUiLocale({
    hostLocale: options.hostLocale,
    savedLocale: readSavedLocale(storage),
    navigatorLanguage: options.navigatorLanguage,
  });
  let locale = initial.locale;
  let source = initial.source;
  let translator = createI18n(locale);
  const listeners = new Set();
  if (typeof options.onChange === "function") listeners.add(options.onChange);

  function setLocale(next, persist = true) {
    const normalized = normalizeUiLocale(next);
    if (!normalized) return translator;
    if (normalized === locale) {
      if (persist) saveUiLocale(storage, normalized);
      return translator;
    }
    locale = normalized;
    source = "saved";
    translator = createI18n(locale);
    if (persist) saveUiLocale(storage, locale);
    for (const listener of listeners) listener(translator);
    return translator;
  }

  return Object.freeze({
    getLocale: () => locale,
    getSource: () => source,
    getTranslator: () => translator,
    setLocale,
    /** @param {(translator: import("./index.mjs").Translator) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
