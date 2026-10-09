const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Manage a page-local modal without relying on the native <dialog> element.
 * The background is made inert (with an aria-hidden fallback), page scrolling
 * is locked without changing its position, and keyboard focus stays in the
 * dialog until it closes.
 *
 * @param {{ overlay: HTMLElement, dialog: HTMLElement, background: HTMLElement, initialFocus: HTMLElement | (() => HTMLElement), document?: Document, onClose?: () => void }} options
 */
export function createModalDialogController({ overlay, dialog, background, initialFocus, document: ownerDocument = globalThis.document, onClose = () => {} }) {
  let opened = false;
  let returnFocusTo = null;
  let previousBackgroundInert = false;
  let previousAriaHidden = null;
  let previousBodyOverflow = "";
  let previousDocumentOverflow = "";

  function open(trigger = ownerDocument.activeElement) {
    if (opened) return false;
    opened = true;
    returnFocusTo = trigger ?? ownerDocument.activeElement;
    previousBackgroundInert = Boolean(background.inert);
    previousAriaHidden = background.getAttribute("aria-hidden");
    previousBodyOverflow = ownerDocument.body?.style?.overflow ?? "";
    previousDocumentOverflow = ownerDocument.documentElement?.style?.overflow ?? "";

    overlay.hidden = false;
    background.inert = true;
    background.setAttribute("aria-hidden", "true");
    if (ownerDocument.body?.style) ownerDocument.body.style.overflow = "hidden";
    if (ownerDocument.documentElement?.style) ownerDocument.documentElement.style.overflow = "hidden";
    ownerDocument.addEventListener("keydown", onKeyDown, true);

    const focusTarget = typeof initialFocus === "function" ? initialFocus() : initialFocus;
    focusTarget?.focus();
    return true;
  }

  function close() {
    if (!opened) return false;
    opened = false;
    ownerDocument.removeEventListener("keydown", onKeyDown, true);
    overlay.hidden = true;
    background.inert = previousBackgroundInert;
    if (previousAriaHidden === null) background.removeAttribute("aria-hidden");
    else background.setAttribute("aria-hidden", previousAriaHidden);
    if (ownerDocument.body?.style) ownerDocument.body.style.overflow = previousBodyOverflow;
    if (ownerDocument.documentElement?.style) ownerDocument.documentElement.style.overflow = previousDocumentOverflow;

    const focusTarget = returnFocusTo;
    returnFocusTo = null;
    if (focusTarget && focusTarget.isConnected !== false && !focusTarget.disabled) focusTarget.focus?.();
    onClose();
    return true;
  }

  function onKeyDown(event) {
    if (!opened) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation?.();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) =>
      !element.disabled && !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus?.();
      return;
    }

    const activeIndex = focusable.indexOf(ownerDocument.activeElement);
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  }

  return Object.freeze({
    open,
    close,
    get isOpen() { return opened; },
  });
}
