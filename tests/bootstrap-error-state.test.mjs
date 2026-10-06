import assert from "node:assert/strict";
import { test } from "node:test";
import { showFatalBootError } from "../src/bootstrap-error-state.mjs";

function element() {
  return {
    hidden: true,
    textContent: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

test("bootstrap failure restores a visible safe error state and hides an unmounted Workbench", () => {
  const nodes = {
    boot: element(),
    bootMessage: element(),
    fatal: element(),
    title: element(),
    description: element(),
    detail: element(),
    retryButton: element(),
    phase0Root: element(),
    generationRoot: element(),
  };
  nodes.boot.hidden = true;
  nodes.generationRoot.hidden = false;
  nodes.phase0Root.hidden = false;
  nodes.bootMessage.hidden = false;
  const diagnostics = [];
  const originalConsoleError = console.error;
  console.error = (...args) => diagnostics.push(args);

  try {
    showFatalBootError({
      ...nodes,
      titleText: "SchemaSeed 加载失败",
      descriptionText: "生成测试数据工作台未能启动。",
      errorLabel: "错误：",
      retryText: "重试",
      redactedText: "[已隐藏]",
      stage: "Generation module import",
      error: new TypeError("Module name './generation-workbench/app.mjs' does not resolve to a valid URL; password=top-secret"),
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(nodes.boot.hidden, false);
  assert.equal(nodes.boot.attributes.role, "alert");
  assert.equal(nodes.fatal.hidden, false);
  assert.equal(nodes.generationRoot.hidden, true);
  assert.equal(nodes.phase0Root.hidden, true);
  assert.equal(nodes.detail.hidden, false);
  assert.match(nodes.title.textContent, /SchemaSeed/);
  assert.match(nodes.detail.textContent, /Module name '\.\/generation-workbench\/app\.mjs'/);
  assert.match(nodes.detail.textContent, /password=\[已隐藏\]/);
  assert.doesNotMatch(nodes.detail.textContent, /top-secret/);
  assert.equal(nodes.retryButton.hidden, false);
  assert.equal(nodes.retryButton.textContent, "重试");
  assert.equal(diagnostics[0][0], "[SchemaSeed] bootstrap failed");
  assert.deepEqual(diagnostics[0][1], {
    stage: "Generation module import",
    name: "TypeError",
    message: "Module name './generation-workbench/app.mjs' does not resolve to a valid URL; password=[已隐藏]",
  });
});

test("fatal error summary removes JDBC connection strings and never includes stacks", () => {
  const nodes = Object.fromEntries([
    "boot", "bootMessage", "fatal", "title", "description", "detail", "retryButton", "phase0Root", "generationRoot",
  ].map((name) => [name, element()]));
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    showFatalBootError({
      ...nodes,
      titleText: "Failed",
      descriptionText: "Workbench unavailable.",
      errorLabel: "Error: ",
      retryText: "Retry",
      redactedText: "[redacted]",
      stage: "Host initialization",
      error: new Error("Could not open jdbc:postgresql://alice:secret@db.example/app?password=pwd-value; password=\"two words secret\"; Authorization: Bearer abc-token"),
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.match(nodes.detail.textContent, /Could not open \[redacted\]/);
  assert.doesNotMatch(nodes.detail.textContent, /alice|secret|pwd-value|abc-token/);
  assert.doesNotMatch(nodes.detail.textContent, /\n\s+at /);
});
