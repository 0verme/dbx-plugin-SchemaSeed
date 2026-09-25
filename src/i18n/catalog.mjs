import { EN_US_DIAGNOSTICS, EN_US_MESSAGES } from "./en-US.mjs";
import { ZH_CN_DIAGNOSTICS, ZH_CN_MESSAGES } from "./zh-CN.mjs";

/**
 * Flatten one localized diagnostic table into message keys so that the
 * diagnostic copy is resolved through exactly the same lookup as UI copy:
 *
 *   diagnostic.<code>.title
 *   diagnostic.<code>.description
 *   diagnostic.<code>.action
 *   diagnostic.<code>.level
 *
 * `level` is a machine value pointing at `diagnostics.level.<value>`; it is
 * never user copy. Diagnostic codes themselves are protocol identifiers and
 * are never translated.
 *
 * @param {Record<string, { title: string, description: string, action?: string, level?: string }>} diagnostics
 */
export function flattenDiagnostics(diagnostics) {
  const messages = {};
  for (const [code, entry] of Object.entries(diagnostics)) {
    messages[`diagnostic.${code}.title`] = entry.title;
    messages[`diagnostic.${code}.description`] = entry.description;
    if (typeof entry.action === "string") messages[`diagnostic.${code}.action`] = entry.action;
    if (typeof entry.level === "string") messages[`diagnostic.${code}.level`] = entry.level;
  }
  return Object.freeze(messages);
}

/** @type {Readonly<Record<string, Readonly<Record<string, string>>>>} */
export const MESSAGE_CATALOGS = Object.freeze({
  "en-US": Object.freeze({ ...flattenDiagnostics(EN_US_DIAGNOSTICS), ...EN_US_MESSAGES }),
  "zh-CN": Object.freeze({ ...flattenDiagnostics(ZH_CN_DIAGNOSTICS), ...ZH_CN_MESSAGES }),
});

export const EN_US_MESSAGE_CATALOG = MESSAGE_CATALOGS["en-US"];
