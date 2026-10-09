/**
 * Copy text in the DBX Workbench WebView. Prefer the secure Clipboard API, then
 * fall back to the legacy document command used by older embedded WebViews.
 * The source string is never transformed by this adapter.
 *
 * @param {string} text
 * @param {{ clipboard?: Pick<Clipboard, "writeText">, document?: Document }} [environment]
 */
export async function copyTextToClipboard(text, environment = {}) {
  if (typeof text !== "string") throw new TypeError("Clipboard content must be text");
  const clipboard = environment.clipboard ?? globalThis.navigator?.clipboard;
  const ownerDocument = environment.document ?? globalThis.document;

  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Continue to the WebView-compatible fallback below.
    }
  }

  if (!ownerDocument?.body || typeof ownerDocument.createElement !== "function"
    || typeof ownerDocument.execCommand !== "function") {
    throw new Error("Clipboard access is unavailable");
  }

  const activeElement = ownerDocument.activeElement;
  const temporaryField = ownerDocument.createElement("textarea");
  temporaryField.value = text;
  temporaryField.setAttribute("readonly", "");
  temporaryField.style.position = "fixed";
  temporaryField.style.left = "-10000px";
  temporaryField.style.top = "0";
  temporaryField.style.width = "1px";
  temporaryField.style.height = "1px";
  temporaryField.style.opacity = "0";
  ownerDocument.body.append(temporaryField);

  let copied = false;
  try {
    temporaryField.focus();
    temporaryField.select();
    copied = ownerDocument.execCommand("copy");
  } finally {
    temporaryField.remove();
    if (activeElement && activeElement.isConnected !== false) activeElement.focus?.();
  }

  if (!copied) throw new Error("Clipboard access is unavailable");
}
