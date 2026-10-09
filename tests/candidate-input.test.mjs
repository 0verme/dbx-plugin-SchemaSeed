import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendCandidateValues,
  candidateValuesEqual,
  parseCandidateJson,
  parseCandidatePaste,
  removeCandidateValue,
  shouldAddCandidateOnEnter,
  shouldRemoveLastCandidateOnBackspace,
} from "../ui/generation-workbench/candidate-input.mjs";

describe("enum candidate input parsing", () => {
  it("parses complete JSON arrays with exact JSON values and ordering", () => {
    const values = ["张三, Jr.", "a \"quoted\" value", "😀", 1, true, null, ["nested", 2], { b: 2, a: 1 }];
    assert.deepEqual(parseCandidateJson(JSON.stringify(values)), { ok: true, values });
    assert.deepEqual(parseCandidateJson("[]"), { ok: true, values: [] });
    assert.deepEqual(parseCandidateJson("[1, 2, 3]"), { ok: true, values: [1, 2, 3] });
    assert.deepEqual(parseCandidateJson("[true, false]"), { ok: true, values: [true, false] });
    assert.deepEqual(parseCandidateJson('["A", null]'), { ok: true, values: ["A", null] });
  });

  it("rejects invalid JSON and JSON values that are not arrays", () => {
    assert.deepEqual(parseCandidateJson('["A",'), { ok: false, reason: "invalid-json" });
    assert.deepEqual(parseCandidateJson('{"value":"A"}'), { ok: false, reason: "not-array" });
    assert.deepEqual(parseCandidateJson('"A"'), { ok: false, reason: "not-array" });
    assert.deepEqual(parseCandidateJson("null"), { ok: false, reason: "not-array" });
  });

  it("prioritizes JSON arrays, multiline values, then simple comma lists", () => {
    assert.deepEqual(parseCandidatePaste('["A, B", "C"]'), {
      kind: "values", source: "json", values: ["A, B", "C"],
    });
    assert.deepEqual(parseCandidatePaste("张三\n李四\n王五\n"), {
      kind: "values", source: "lines", values: ["张三", "李四", "王五"],
    });
    assert.deepEqual(parseCandidatePaste("A\n\nB"), {
      kind: "values", source: "lines", values: ["A", "", "B"],
    });
    assert.deepEqual(parseCandidatePaste("张三,李四,王五"), {
      kind: "values", source: "comma", values: ["张三", "李四", "王五"],
    });
    assert.deepEqual(parseCandidatePaste("one,two"), {
      kind: "values", source: "comma", values: ["one", "two"],
    });
  });

  it("does not demote JSON-looking paste or split ambiguous/complex comma text", () => {
    assert.deepEqual(parseCandidatePaste('["A",'), { kind: "error", reason: "json-array" });
    assert.deepEqual(parseCandidatePaste('{"A":1}'), { kind: "error", reason: "json-array" });
    assert.deepEqual(parseCandidatePaste('"A"'), { kind: "error", reason: "json-array" });
    assert.deepEqual(parseCandidatePaste("Smith, Jr."), {
      kind: "ambiguous", text: "Smith, Jr.", splitValues: ["Smith", "Jr."], singleValue: "Smith, Jr.",
    });
    assert.deepEqual(parseCandidatePaste('A,"B,C"'), {
      kind: "ambiguous", text: 'A,"B,C"', splitValues: ["A", '"B', 'C"'], singleValue: 'A,"B,C"',
    });
    assert.deepEqual(parseCandidatePaste("a,b\nc,d"), {
      kind: "values", source: "lines", values: ["a,b", "c,d"],
    });
  });

  it("preserves single values, whitespace, and empty-paste semantics", () => {
    assert.deepEqual(parseCandidatePaste("A,B C"), { kind: "ambiguous", text: "A,B C", splitValues: ["A", "B C"], singleValue: "A,B C" });
    assert.deepEqual(parseCandidatePaste("ordinary value"), { kind: "single", values: ["ordinary value"] });
    assert.deepEqual(parseCandidatePaste("  "), { kind: "single", values: ["  "] });
    assert.deepEqual(parseCandidatePaste(""), { kind: "empty" });
    assert.deepEqual(parseCandidatePaste("\n"), { kind: "values", source: "lines", values: [""] });
  });

  it("keeps atomic array operations, ordering, duplicates and value types", () => {
    const original = ["A", 1, true, null, "A"];
    assert.deepEqual(appendCandidateValues(original, ["B", 2]), ["A", 1, true, null, "A", "B", 2]);
    assert.deepEqual(removeCandidateValue(original, 1), ["A", true, null, "A"]);
    assert.deepEqual(removeCandidateValue(original, -1), original);
    assert.equal(candidateValuesEqual([1, { b: 2, a: 1 }], [1, { a: 1, b: 2 }]), true);
    assert.equal(candidateValuesEqual([1], ["1"]), false);
    assert.equal(candidateValuesEqual(["A", "B"], ["B", "A"]), false);
  });

  it("honors Enter, IME composition, and empty-input Backspace rules", () => {
    assert.equal(shouldAddCandidateOnEnter({ key: "Enter", isComposing: false, keyCode: 13 }), true);
    assert.equal(shouldAddCandidateOnEnter({ key: "Enter", isComposing: true, keyCode: 13 }), false);
    assert.equal(shouldAddCandidateOnEnter({ key: "Enter", isComposing: false, keyCode: 229 }), false);
    assert.equal(shouldAddCandidateOnEnter({ key: ",", isComposing: false }), false);
    assert.equal(shouldRemoveLastCandidateOnBackspace({ key: "Backspace", value: "", isComposing: false }, 1), true);
    assert.equal(shouldRemoveLastCandidateOnBackspace({ key: "Backspace", value: "x", isComposing: false }, 1), false);
    assert.equal(shouldRemoveLastCandidateOnBackspace({ key: "Backspace", value: "", isComposing: false }, 0), false);
    assert.equal(shouldRemoveLastCandidateOnBackspace({ key: "Backspace", value: "", isComposing: true }, 1), false);
  });

  it("does not impose a candidate-count limit", () => {
    const input = Array.from({ length: 2_000 }, (_value, index) => `value-${index}`).join("\n");
    const result = parseCandidatePaste(input);
    assert.equal(result.kind, "values");
    assert.equal(result.values.length, 2_000);
    assert.equal(result.values.at(-1), "value-1999");
  });
});
