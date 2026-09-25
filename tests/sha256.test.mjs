import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { sha256Bytes, sha256Hex } from "../src/generation/sha256.mjs";
import { digestFor } from "../src/generation/generation-identity.mjs";

function referenceHex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("pure-JS sha256 is byte-identical to node:crypto", () => {
  const samples = [
    "",
    "abc",
    "SchemaSeed",
    "测试用户",
    "emoji 😀🚀",
    "\u0000\u0001\u007f",
    "\ud800",
    "a\ud800b",
    JSON.stringify(["SchemaSeed", "sha256-addressed-v1", "用户", "test", 42, true, null]),
  ];
  // Exercise every SHA-256 block/padding boundary (55/56/63/64/119/120 bytes).
  for (let length = 0; length <= 200; length += 1) samples.push("a".repeat(length));
  for (const sample of samples) {
    const expected = referenceHex(sample);
    assert.equal(sha256Hex(sample), expected, `sha256Hex for ${sample.length} chars`);
    assert.equal(Buffer.from(sha256Bytes(sample)).toString("hex"), expected, `sha256Bytes for ${sample.length} chars`);
  }
});

test("generation identity keeps the sha256-addressed v1 contract", () => {
  const identities = [
    ["table", "column", "0"],
    ["中文", "列", "x"],
    ["row", "5", "gender"],
    ["SchemaSeed", "a", "b", "c"],
  ];
  for (const identity of identities) {
    const expected = createHash("sha256")
      .update(JSON.stringify(["SchemaSeed", "sha256-addressed-v1", ...identity]), "utf8")
      .digest("hex");
    assert.equal(Buffer.from(digestFor(identity)).toString("hex"), expected, `digestFor ${JSON.stringify(identity)}`);
  }
});
