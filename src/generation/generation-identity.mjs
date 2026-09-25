import { createHash } from "node:crypto";

/** Stable random-access digest shared by ordinary and constraint-aware generation. */
export function digestFor(identity) {
  return createHash("sha256")
    .update(JSON.stringify(["SchemaSeed", "sha256-addressed-v1", ...identity]), "utf8")
    .digest();
}

export function randomUnit(identity) {
  const digest = digestFor(identity);
  const top53Bits = digest.readBigUInt64BE(0) >> 11n;
  return Number(top53Bits) / 9_007_199_254_740_992;
}

export function randomBigIntBelow(exclusiveMax, identity) {
  if (exclusiveMax <= 0n) throw new Error("Random range must have a positive width");
  const bitCount = exclusiveMax.toString(2).length;
  const byteCount = Math.ceil(bitCount / 8);
  const mask = (1n << BigInt(bitCount)) - 1n;
  let bytes = Buffer.alloc(0);
  for (let block = 0; bytes.length < byteCount; block += 1) {
    bytes = Buffer.concat([bytes, digestFor([...identity, `block-${block}`])]);
  }
  const candidate = BigInt(`0x${bytes.subarray(0, byteCount).toString("hex")}`) & mask;
  return candidate % exclusiveMax;
}

export function randomBigIntBelowUniform(exclusiveMax, identity) {
  if (exclusiveMax <= 0n) throw new Error("Random range must have a positive width");
  if (exclusiveMax === 1n) return 0n;
  const bitCount = (exclusiveMax - 1n).toString(2).length;
  const byteCount = Math.ceil(bitCount / 8);
  const mask = (1n << BigInt(bitCount)) - 1n;
  for (let attempt = 0; ; attempt += 1) {
    const parts = [];
    let length = 0;
    for (let block = 0; length < byteCount; block += 1) {
      const part = digestFor([...identity, `candidate-${attempt}`, `block-${block}`]);
      parts.push(part);
      length += part.length;
    }
    const candidate = BigInt(`0x${Buffer.concat(parts).subarray(0, byteCount).toString("hex")}`) & mask;
    if (candidate < exclusiveMax) return candidate;
  }
}
