import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { copyTextToClipboard } from "../ui/generation-workbench/clipboard.mjs";
import { createModalDialogController } from "../ui/generation-workbench/modal-dialog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class FakeElement {
  constructor(document, name) {
    this.ownerDocument = document;
    this.name = name;
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.attributes = new Map();
    this.focuses = 0;
  }

  focus() {
    if (!this.disabled) {
      this.ownerDocument.activeElement = this;
      this.focuses += 1;
    }
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) {
    if (selector === '[role="alertdialog"]:not([hidden])') return this.activeAlertDialog ?? null;
    return null;
  }
  querySelectorAll() { return this.focusableElements ?? []; }
  closest(selector) {
    if (selector === "[hidden]" && this.hiddenByAncestor) return {};
    if (selector === '[aria-hidden="true"]' && this.ariaHiddenByAncestor) return {};
    return null;
  }
}

function modalFixture(onRequestClose = () => true) {
  const document = {
    activeElement: null,
    body: { style: { overflow: "clip" } },
    documentElement: { style: { overflow: "auto" } },
    scrollingElement: { scrollTop: 345, scrollLeft: 0 },
    listeners: new Map(),
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    },
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); },
    dispatch(type, event) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    },
  };
  const make = (name) => new FakeElement(document, name);
  const overlay = make("overlay");
  overlay.hidden = true;
  const background = make("background");
  background.inert = false;
  background.setAttribute("aria-hidden", "false");
  const dialog = make("dialog");
  const trigger = make("preview trigger");
  const closeHeader = make("header close");
  const code = make("SQL content");
  const copy = make("copy");
  const save = make("export");
  const closeFooter = make("footer close");
  const hiddenTabControl = make("control in inactive tab");
  hiddenTabControl.hiddenByAncestor = true;
  const inactiveTab = make("inactive tab button");
  inactiveTab.setAttribute("tabindex", "-1");
  dialog.focusableElements = [closeHeader, code, copy, save, closeFooter, hiddenTabControl, inactiveTab];
  document.activeElement = trigger;
  let closed = 0;
  const controller = createModalDialogController({
    overlay,
    dialog,
    background,
    initialFocus: code,
    document,
    onRequestClose,
    onClose: () => { closed += 1; },
  });
  return { document, overlay, background, dialog, trigger, closeHeader, code, copy, save, closeFooter, hiddenTabControl, inactiveTab, controller, get closed() { return closed; } };
}

describe("SQL preview Modal keyboard and focus behavior", () => {
  it("opens once, enters focus, locks background scrolling, and restores focus and prior styles on close", () => {
    const fixture = modalFixture();
    const { controller, trigger, overlay, background, document, code } = fixture;

    assert.equal(controller.open(trigger), true);
    assert.equal(controller.isOpen, true);
    assert.equal(controller.open(trigger), false, "rapid duplicate opens do not create a second Modal");
    assert.equal(overlay.hidden, false);
    assert.equal(background.inert, true);
    assert.equal(background.getAttribute("aria-hidden"), "true");
    assert.equal(document.body.style.overflow, "hidden");
    assert.equal(document.documentElement.style.overflow, "hidden");
    assert.equal(document.activeElement, code, "focus enters the SQL content region");
    assert.equal(document.scrollingElement.scrollTop, 345, "opening does not move the Workbench scroll position");

    assert.equal(controller.close(), true);
    assert.equal(controller.isOpen, false);
    assert.equal(overlay.hidden, true);
    assert.equal(background.inert, false);
    assert.equal(background.getAttribute("aria-hidden"), "false");
    assert.equal(document.body.style.overflow, "clip");
    assert.equal(document.documentElement.style.overflow, "auto");
    assert.equal(document.scrollingElement.scrollTop, 345, "closing preserves the original scroll position");
    assert.equal(document.activeElement, trigger, "focus returns to the preview trigger");
    assert.equal(fixture.closed, 1);

    assert.equal(controller.open(trigger), true, "the dialog can reopen after closing");
    assert.equal(document.activeElement, code, "focus re-enters on reopen");
    assert.equal(controller.close(), true);
  });

  it("allows a dirty-dialog close request to be rejected until its owner confirms discard", () => {
    let canClose = false;
    const reasons = [];
    const fixture = modalFixture((reason) => {
      reasons.push(reason);
      return canClose;
    });
    fixture.controller.open(fixture.trigger);

    assert.equal(fixture.controller.requestClose("backdrop"), false);
    assert.equal(fixture.controller.isOpen, true, "a denied request leaves the dialog and its draft intact");
    assert.deepEqual(reasons, ["backdrop"]);

    let prevented = false;
    fixture.document.dispatch("keydown", {
      key: "Escape",
      preventDefault() { prevented = true; },
      stopPropagation() {},
    });
    assert.equal(prevented, true);
    assert.equal(fixture.controller.isOpen, true, "Escape is subject to the same confirmation gate");
    assert.deepEqual(reasons, ["backdrop", "escape"]);

    canClose = true;
    assert.equal(fixture.controller.requestClose("discard-confirmed"), true);
    assert.equal(fixture.controller.isOpen, false);
  });

  it("traps focus inside an active confirmation alertdialog until it closes", () => {
    const fixture = modalFixture();
    fixture.controller.open(fixture.trigger);
    const alertDialog = new FakeElement(fixture.document, "confirmation alertdialog");
    const cancel = new FakeElement(fixture.document, "confirmation cancel");
    const confirm = new FakeElement(fixture.document, "confirmation accept");
    alertDialog.focusableElements = [cancel, confirm];
    fixture.dialog.activeAlertDialog = alertDialog;
    fixture.document.activeElement = confirm;

    let prevented = false;
    fixture.document.dispatch("keydown", { key: "Tab", preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(fixture.document.activeElement, cancel, "Tab wraps inside the visible confirmation");

    prevented = false;
    fixture.document.dispatch("keydown", { key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(fixture.document.activeElement, confirm, "Shift+Tab also stays inside the confirmation");
  });

  it("closes on Escape and wraps Tab focus in both directions", () => {
    const fixture = modalFixture();
    const { controller, document, trigger, closeHeader, code, closeFooter, overlay } = fixture;
    controller.open(trigger);

    let prevented = false;
    document.activeElement = closeHeader;
    document.dispatch("keydown", { key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(document.activeElement, closeFooter, "Shift+Tab wraps to the last control");

    prevented = false;
    document.dispatch("keydown", { key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(document.activeElement, closeHeader, "Tab wraps to the first control");

    document.activeElement = closeFooter;
    prevented = false;
    document.dispatch("keydown", { key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true, "hidden panel controls and tabindex=-1 tabs are not in the dialog tab order");
    assert.equal(document.activeElement, closeHeader);

    document.activeElement = fixture.background;
    prevented = false;
    document.dispatch("keydown", { key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(document.activeElement, closeHeader, "focus outside the dialog is redirected back inside");

    let escapePrevented = false;
    document.dispatch("keydown", {
      key: "Escape",
      preventDefault() { escapePrevented = true; },
      stopPropagation() {},
    });
    assert.equal(escapePrevented, true);
    assert.equal(controller.isOpen, false);
    assert.equal(overlay.hidden, true);
    assert.equal(document.activeElement, trigger);
    assert.notEqual(document.activeElement, code);
  });
});

describe("SQL preview Clipboard adapter", () => {
  it("copies the complete input unchanged through the Clipboard API", async () => {
    const sql = "-- SQL preview\nINSERT INTO customer (note) VALUES ('it''s ready');\n";
    let copied = null;
    await copyTextToClipboard(sql, {
      clipboard: { async writeText(text) { copied = text; } },
    });
    assert.equal(copied, sql);
  });

  it("falls back to the WebView document copy command and restores focus", async () => {
    const sql = "INSERT INTO customer (note) VALUES ('中文');\n";
    let copied = null;
    let field = null;
    const trigger = { isConnected: true, focus() { document.activeElement = this; } };
    const document = {
      activeElement: trigger,
      body: { append(node) { field = node; node.isConnected = true; } },
      createElement() {
        return {
          style: {},
          value: "",
          attributes: new Map(),
          setAttribute(name, value) { this.attributes.set(name, value); },
          focus() { document.activeElement = this; },
          select() {},
          remove() { this.isConnected = false; },
        };
      },
      execCommand(command) {
        assert.equal(command, "copy");
        copied = field.value;
        return true;
      },
    };

    await copyTextToClipboard(sql, { clipboard: undefined, document });
    assert.equal(copied, sql);
    assert.equal(field.isConnected, false, "temporary copy field is removed");
    assert.equal(document.activeElement, trigger, "copy restores the prior focused control");
  });

  it("reports copy failure when both WebView clipboard paths are unavailable", async () => {
    const document = {
      activeElement: null,
      body: { append(node) { node.isConnected = true; } },
      createElement() {
        return { style: {}, setAttribute() {}, focus() {}, select() {}, remove() {} };
      },
      execCommand() { return false; },
    };
    await assert.rejects(copyTextToClipboard("SQL", { clipboard: undefined, document }), /Clipboard access is unavailable/u);
  });
});

describe("SQL preview Modal markup and layout contract", () => {
  it("keeps the preview entry, modal actions, and local scroll region without the old disclosure", async () => {
    const source = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
    const markup = /const WORKBENCH_MARKUP = `([\s\S]*?)`;/u.exec(source)?.[1] ?? "";
    assert.match(markup, /data-sswb-preview-sql/u, "the existing top-level preview entry remains");
    assert.match(markup, /id="sswb-sql-modal"[^>]*hidden/u);
    assert.equal((markup.match(/class="sswb-sql-dialog" role="dialog"/gu) ?? []).length, 1, "the SQL preview retains its existing Modal implementation");
    for (const action of ["close", "copy", "export"]) assert.match(markup, new RegExp(`data-sswb-sql-modal-${action}`));
    assert.match(markup, /data-sswb-export="sql"/u, "the existing top-level SQL export remains");
    assert.doesNotMatch(markup, /sswb-sql-details|sswb-sql-content/u);

    const css = await readFile(path.join(root, "ui/generation-workbench.css"), "utf8");
    assert.match(css, /\.sswb-sql-dialog\s*\{[^}]*width:\s*min\(80vw,/u);
    assert.match(css, /\.sswb-sql-dialog\s*\{[^}]*max-height:\s*min\(80vh,/u);
    assert.match(css, /\.sswb-sql-code-scroll\s*\{[^}]*overflow:\s*auto/u, "SQL scrolls inside the Modal");
    assert.match(css, /\.sswb-sql-code-scroll code\s*\{[^}]*width:\s*max-content/u, "long SQL lines can scroll horizontally");
    assert.match(css, /\.sswb-advanced-dialog\s*\{[^}]*width:\s*min\(1180px,/u, "advanced settings has enough responsive width for rule editing");
  });
});
