import { sha256Bytes, toHex } from "./sha256.mjs";

/** Concatenate digest blocks without Buffer (the Workbench UI imports this module). @param {Uint8Array[]} parts */
function concatBytes(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/** Stable random-access digest shared by ordinary and constraint-aware generation. */
export function digestFor(identity) {
  return sha256Bytes(JSON.stringify(["SchemaSeed", "sha256-addressed-v1", ...identity]));
}

export function randomUnit(identity) {
  const digest = digestFor(identity);
  const top53Bits = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getBigUint64(0) >> 11n;
  return Number(top53Bits) / 9_007_199_254_740_992;
}

export function randomBigIntBelow(exclusiveMax, identity) {
  if (exclusiveMax <= 0n) throw new Error("Random range must have a positive width");
  const bitCount = exclusiveMax.toString(2).length;
  const byteCount = Math.ceil(bitCount / 8);
  const mask = (1n << BigInt(bitCount)) - 1n;
  const blocks = [];
  let length = 0;
  for (let block = 0; length < byteCount; block += 1) {
    const digest = digestFor([...identity, `block-${block}`]);
    blocks.push(digest);
    length += digest.length;
  }
  const candidate = BigInt(`0x${toHex(concatBytes(blocks).subarray(0, byteCount))}`) & mask;
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
    const candidate = BigInt(`0x${toHex(concatBytes(parts).subarray(0, byteCount))}`) & mask;
    if (candidate < exclusiveMax) return candidate;
  }
}
