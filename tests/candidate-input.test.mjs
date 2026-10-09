import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendCandidateValues,
  canEditEnumCandidatesAsTags,
  candidateValuesEqual,
  parseCandidateJson,
  parseCandidatePaste,
  parseCandidateText,
  parseCandidateValues,
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

  it("parses scalar Tag Input by the existing Core family without losing value types", () => {
    for (const [text, value] of [["1", 1], ["-1", -1], ["0", 0], ["2147483647", 2147483647], ["9007199254740991", Number.MAX_SAFE_INTEGER]]) {
      assert.deepEqual(parseCandidateText("integer", text), { ok: true, value });
    }
    assert.deepEqual(parseCandidateText("integer", "abc"), { ok: false, reason: "invalid-integer" });
    for (const text of ["9007199254740992", "9223372036854775807", "-9223372036854775808"]) {
      assert.deepEqual(parseCandidateText("integer", text), { ok: false, reason: "integer-range" }, text);
    }

    for (const text of ["0.1", "12.50", "-99.99", "12345678901234567890.123456"]) {
      assert.deepEqual(parseCandidateText("decimal", text), { ok: true, value: text });
    }
    assert.deepEqual(parseCandidateText("decimal", "12.50x"), { ok: false, reason: "invalid-decimal" });
    assert.deepEqual(parseCandidateText("boolean", "TRUE"), { ok: true, value: true });
    assert.deepEqual(parseCandidateText("boolean", "false"), { ok: true, value: false });
    assert.deepEqual(parseCandidateText("boolean", "yes"), { ok: false, reason: "invalid-boolean" });
    assert.deepEqual(parseCandidateText("varchar", "  张三  "), { ok: true, value: "  张三  " });
  });

  it("enables tags only when the Core values round-trip losslessly", () => {
    assert.equal(canEditEnumCandidatesAsTags("varchar", ["", "张三"]), true);
    assert.equal(canEditEnumCandidatesAsTags("integer", [1, -1, Number.MAX_SAFE_INTEGER]), true);
    assert.equal(canEditEnumCandidatesAsTags("integer", ["1"]), false);
    assert.equal(canEditEnumCandidatesAsTags("integer", [Number.MAX_SAFE_INTEGER + 1]), false);
    assert.equal(canEditEnumCandidatesAsTags("decimal", ["12.50", "12345678901234567890.123456"]), true);
    assert.equal(canEditEnumCandidatesAsTags("decimal", [12.5]), false);
    assert.equal(canEditEnumCandidatesAsTags("boolean", [true, false]), true);
    assert.equal(canEditEnumCandidatesAsTags("date", ["2026-10-09"]), true);
    assert.equal(canEditEnumCandidatesAsTags("timestamp", ["2026-10-09T12:00:00"]), true);
    assert.equal(canEditEnumCandidatesAsTags("json", ["text"]), false);
    assert.equal(canEditEnumCandidatesAsTags("unknown", []), false);
  });

  it("parses typed paste atomically and rejects JSON numbers that could lose precision", () => {
    assert.deepEqual(parseCandidateValues("integer", ["1", 2, "-3"]), { ok: true, values: [1, 2, -3] });
    assert.deepEqual(parseCandidateValues("integer", ["1", 9007199254740992]), {
      ok: false, reason: "integer-range", index: 1,
    });
    assert.deepEqual(parseCandidateValues("decimal", ["0.1", "12.50"]), { ok: true, values: ["0.1", "12.50"] });
    assert.deepEqual(parseCandidateValues("decimal", [0.1]), {
      ok: false, reason: "decimal-json-number", index: 0,
    });
    assert.deepEqual(parseCandidateValues("boolean", ["true", false]), { ok: true, values: [true, false] });

    assert.deepEqual(parseCandidateJson("[9007199254740991, 1.0, 1e2]", "integer"), {
      ok: true, values: [Number.MAX_SAFE_INTEGER, 1, 100],
    });
    assert.deepEqual(parseCandidateJson("[9223372036854775807]", "integer"), {
      ok: false, reason: "integer-range",
    });
    assert.deepEqual(parseCandidateJson("[9007199254740991.4]", "integer"), {
      ok: false, reason: "invalid-integer",
    });
    assert.deepEqual(parseCandidateJson('["9223372036854775807"]', "integer"), {
      ok: true, values: ["9223372036854775807"],
    });
    assert.deepEqual(parseCandidatePaste("[9007199254740991.4]", "integer"), {
      kind: "error", reason: "invalid-integer",
    });
    assert.deepEqual(parseCandidatePaste("1,000", "integer"), {
      kind: "ambiguous", text: "1,000", splitValues: ["1", "000"], singleValue: "1,000",
    });
    assert.deepEqual(parseCandidatePaste("12.50,99.99", "decimal"), {
      kind: "ambiguous", text: "12.50,99.99", splitValues: ["12.50", "99.99"], singleValue: "12.50,99.99",
    });
    assert.deepEqual(parseCandidatePaste('["12345678901234567890.123456"]', "decimal"), {
      kind: "values", source: "json", values: ["12345678901234567890.123456"],
    });
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
