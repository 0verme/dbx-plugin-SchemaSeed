import { EN_US_MESSAGE_CATALOG, MESSAGE_CATALOGS } from "./catalog.mjs";

/**
 * Lightweight, dependency-free i18n for the SchemaSeed Workbench packs.
 *
 * Design notes:
 * - `en-US` is the reference catalog and the fallback for every locale.
 * - A missing key never throws: lookup degrades to `en-US` and, as the last
 *   resort, to the key itself so a single missing translation cannot break a
 *   render pass.
 * - The UI locale is *not* the synthetic data locale. This module only knows
 *   about interface language; `zh-CN` / `en` generation locales stay in
 *   `generation-plan.mjs` / the Workbench generation controls.
 */

export const SUPPORTED_UI_LOCALES = Object.freeze(["zh-CN", "en-US"]);
export const DEFAULT_UI_LOCALE = "en-US";

/**
 * @typedef {Object} Translator
 * @property {"zh-CN" | "en-US"} locale
 * @property {(key: string, params?: Record<string, unknown>) => string} t
 * @property {(key: string) => boolean} has
 * @property {() => string[]} keys
 */

/** Base-language tags mapped to the supported UI locale, per the locale strategy. */
const LOCALE_BY_LANGUAGE = Object.freeze({ zh: "zh-CN", en: "en-US" });

/**
 * Normalize any browser / host / saved locale tag to a supported UI locale.
 * `zh`, `zh-CN`, `zh-SG`, `zh-Hans-CN` map to `zh-CN`; `en`, `en-US`, `en-GB`
 * map to `en-US`. Anything else returns `null` so callers can fall through.
 * @param {unknown} value
 * @returns {"zh-CN" | "en-US" | null}
 */
export function normalizeUiLocale(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-");
  if (!normalized) return null;
  const exact = SUPPORTED_UI_LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact;
  const language = normalized.split("-")[0].toLowerCase();
  return LOCALE_BY_LANGUAGE[language] ?? null;
}

/**
 * Resolve the Workbench interface language.
 *
 * Priority: DBX Host locale (only when the host actually exposes one; Host API
 * ^1.3 does not) → user-saved SchemaSeed UI locale → browser locale → en-US.
 *
 * @param {{ hostLocale?: unknown, savedLocale?: unknown, navigatorLanguage?: unknown }} [sources]
 * @returns {{ locale: "zh-CN" | "en-US", source: "host" | "saved" | "browser" | "default" }}
 */
export function resolveUiLocale(sources = {}) {
  const candidates = [
    ["host", sources.hostLocale],
    ["saved", sources.savedLocale],
    ["browser", sources.navigatorLanguage],
  ];
  for (const [source, candidate] of candidates) {
    const locale = normalizeUiLocale(candidate);
    if (locale) return { locale, source: /** @type {"host" | "saved" | "browser"} */ (source) };
  }
  return { locale: DEFAULT_UI_LOCALE, source: "default" };
}

/**
 * @typedef {Object} Translator
 * A bound translate function. It is callable and also exposes the resolved
 * locale plus `has` / `keys` helpers for fallback decisions.
 * @property {(key: string, params?: Record<string, unknown>) => string} Translator
 * @property {"zh-CN" | "en-US"} locale
 * @property {(key: string) => boolean} has
 * @property {() => string[]} keys
 */

/**
 * Build a translator for one locale.
 * @param {unknown} locale
 * @returns {Translator}
 */
export function createI18n(locale) {
  return createTranslator(locale);
}

/**
 * Build a translator against an explicit catalog set. Production code uses
 * `createI18n`; tests and future locales can inject their own complete or
 * partial catalog and still get the en-US fallback chain.
 * @param {unknown} locale
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} [catalogs]
 * @returns {Translator}
 */
export function createTranslator(locale, catalogs = MESSAGE_CATALOGS) {
  const activeLocale = normalizeUiLocale(locale) ?? DEFAULT_UI_LOCALE;
  const messages = catalogs[activeLocale] ?? EN_US_MESSAGE_CATALOG;
  const fallbackCatalog = catalogs[DEFAULT_UI_LOCALE] ?? EN_US_MESSAGE_CATALOG;

  /** @param {unknown} key @returns {string | null} */
  function lookup(key) {
    if (typeof key !== "string" || key === "") return null;
    const value = messages[key];
    if (typeof value === "string") return value;
    const fallback = fallbackCatalog[key];
    return typeof fallback === "string" ? fallback : null;
  }

  /**
   * Translate a stable message key. Unknown keys return the key text instead of
   * throwing, and unknown placeholders are left untouched.
   * @param {string} key
   * @param {Record<string, unknown>} [params]
   */
  function translate(key, params) {
    const template = lookup(key);
    if (template === null) return typeof key === "string" ? key : "";
    return interpolate(template, params);
  }

  const translator = /** @type {Translator} */ (translate);
  translator.locale = activeLocale;
  translator.has = (key) => lookup(key) !== null;
  translator.keys = () => Object.keys(messages);
  return Object.freeze(translator);
}

/**
 * @param {string} template
 * @param {Record<string, unknown>} [params]
 */
export function interpolate(template, params) {
  if (!params) return template;
  return template.replaceAll(/\{(\w+)\}/g, (placeholder, name) => {
    const value = params[name];
    if (value === undefined || value === null) return placeholder;
    return typeof value === "string" ? value : String(value);
  });
}

/**
 * Keys missing from a locale compared with the reference catalog. Used by the
 * catalog parity test; a non-empty result means a translation was forgotten.
 * @param {"zh-CN" | "en-US"} locale
 */
export function missingMessageKeys(locale) {
  const activeLocale = normalizeUiLocale(locale) ?? DEFAULT_UI_LOCALE;
  const reference = Object.keys(EN_US_MESSAGE_CATALOG);
  const available = new Set(Object.keys(MESSAGE_CATALOGS[activeLocale]));
  return reference.filter((key) => !available.has(key));
}
