import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const BIRTHDAY_MIN = Date.parse("1970-01-01T00:00:00.000Z");
const BIRTHDAY_MAX = Date.parse("2005-12-31T00:00:00.000Z");

/**
 * Generate one Safe Synthetic field from an already-resolved GenerationPlan
 * identity. No real-person data, external provider, or shared RNG state is used.
 * @param {string} semanticType
 * @param {string[]} identity
 * @param {string} locale
 */
export function generatePersonSyntheticValue(semanticType, identity, locale) {
  switch (semanticType) {
    case "name": {
      const suffix = hexToken([...identity, "name-token"], 6);
      return locale === "en" ? `TestUser${suffix}` : `测试用户${suffix}`;
    }
    case "gender": {
      const female = digestFor([...identity, "gender-choice"]).readUInt8(0) % 2 === 0;
      if (locale === "en") return female ? "TEST-F" : "TEST-M";
      return female ? "测试-女" : "测试-男";
    }
    case "birthday": {
      const spanDays = Math.floor((BIRTHDAY_MAX - BIRTHDAY_MIN) / DAY_MS) + 1;
      const offset = Number(randomBigIntBelow(BigInt(spanDays), [...identity, "birthday-date"])) * DAY_MS;
      return new Date(BIRTHDAY_MIN + offset).toISOString().slice(0, 10);
    }
    case "mobile": {
      const digitCount = locale === "en" ? 7 : 8;
      const digits = decimalToken([...identity, "mobile-token"], digitCount);
      return locale === "en" ? `TEST${digits}` : `测试号${digits}`;
    }
    case "email":
      return `p${hexToken([...identity, "email-token"], 8)}@example.com`;
    case "address": {
      const suffix = hexToken([...identity, "address-token"], 6);
      return locale === "en" ? `TestAddr${suffix}` : `测试地址${suffix}`;
    }
    default:
      throw new Error(`No Safe Synthetic generator supports semantic type ${semanticType}`);
  }
}

function hexToken(identity, length) {
  return digestFor(identity).toString("hex").slice(0, length).toUpperCase();
}

function decimalToken(identity, length) {
  let output = "";
  let block = 0;
  while (output.length < length) {
    const bytes = digestFor([...identity, `block-${block}`]);
    for (const byte of bytes) output += String(byte % 10);
    block += 1;
  }
  return output.slice(0, length);
}

function randomBigIntBelow(exclusiveMax, identity) {
  const bytes = digestFor(identity);
  return bytes.readBigUInt64BE(0) % exclusiveMax;
}

function digestFor(identity) {
  return createHash("sha256")
    .update(JSON.stringify(["SchemaSeed", "sha256-addressed-v1", ...identity]), "utf8")
    .digest();
}
