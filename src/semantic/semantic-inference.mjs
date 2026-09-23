import { interpretColumnType } from "../schema/schema-interpreter.mjs";

export const SEMANTIC_TYPES = Object.freeze([
  "unknown",
  "name",
  "gender",
  "birthday",
  "mobile",
  "email",
  "address",
]);

const aliases = new Map([
  ["name", ["name", "full_name", "customer_name", "cust_name", "姓名"]],
  ["gender", ["gender", "sex", "性别"]],
  ["birthday", ["birthday", "birth_date", "date_of_birth", "dob", "出生日期"]],
  ["mobile", ["mobile", "phone", "phone_no", "mobile_no", "telephone", "手机号", "手机号码"]],
  ["email", ["email", "email_address", "电子邮箱", "邮箱"]],
  ["address", ["address", "addr", "home_address", "contact_address", "地址"]],
]);

const stringSemanticTypes = new Set(["name", "gender", "mobile", "email", "address"]);

/**
 * Infer a semantic candidate from normalized column name, schema family, and
 * length only. This function never chooses a generator or reads row data.
 * @param {import("../schema/schema-model.mjs").ColumnSchema} column
 * @param {string} locale
 */
export function inferSemanticType(column, locale = "zh-CN") {
  const normalizedName = normalizeColumnName(column.name);
  const exactMatches = [];
  for (const [semanticType, names] of aliases) {
    for (const alias of names) {
      if (normalizeColumnName(alias) === normalizedName) {
        exactMatches.push({ semanticType, alias, quality: "exact" });
      }
    }
  }

  const matches = exactMatches.length > 0 ? exactMatches : findTokenMatches(normalizedName);
  const semanticCandidates = [...new Set(matches.map((match) => match.semanticType))];
  const nameEvidence = matches.map((match) => Object.freeze({
    source: "column_name",
    observation: `${column.name} → ${match.alias}`,
    explanation: match.quality === "exact"
      ? `Normalized column name exactly matches a known ${match.semanticType} alias`
      : `Column name contains a ${match.semanticType} alias as a separate token`,
  }));

  if (semanticCandidates.length === 0) {
    return Object.freeze({
      semanticType: "unknown",
      confidence: "unknown",
      evidence: Object.freeze([]),
      candidates: Object.freeze([]),
      status: "unknown",
      normalizedName,
    });
  }

  if (semanticCandidates.length > 1) {
    return Object.freeze({
      semanticType: "unknown",
      confidence: "unknown",
      evidence: Object.freeze(nameEvidence),
      candidates: Object.freeze(semanticCandidates),
      status: "ambiguous",
      normalizedName,
    });
  }

  const semanticType = semanticCandidates[0];
  const compatibility = checkSemanticCompatibility(column, semanticType, locale);
  const evidence = [...nameEvidence, ...compatibility.evidence];
  if (compatibility.compatible === false) {
    return Object.freeze({
      semanticType,
      confidence: matches[0].quality === "exact" ? "medium" : "low",
      evidence: Object.freeze(evidence),
      candidates: Object.freeze([semanticType]),
      status: "incompatible",
      reason: compatibility.reason,
      normalizedName,
    });
  }

  const confidence = matches[0].quality === "exact"
    ? compatibility.compatible === true && compatibility.lengthKnown !== false ? "high" : "medium"
    : matches[0].quality === "suffix" ? "medium" : "low";
  return Object.freeze({
    semanticType,
    confidence,
    evidence: Object.freeze(evidence),
    candidates: Object.freeze([semanticType]),
    status: "candidate",
    normalizedName,
  });
}

/** @param {import("../schema/schema-model.mjs").ColumnSchema} column */
export function normalizeColumnName(name) {
  return String(name)
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1_$2")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Check whether an explicitly chosen semantic can be represented in the
 * schema family and the Safe Synthetic marker can fit a known varchar length.
 * `compatible: null` means the schema type is unknown, not compatible.
 * @param {import("../schema/schema-model.mjs").ColumnSchema} column
 * @param {string} semanticType
 * @param {string} locale
 */
export function checkSemanticCompatibility(column, semanticType, locale = "zh-CN") {
  const expectedFamily = semanticType === "birthday" ? "date" : stringSemanticTypes.has(semanticType) ? "varchar" : null;
  if (!expectedFamily) {
    return { compatible: false, lengthKnown: false, reason: `Unsupported semantic type ${semanticType}`, evidence: [] };
  }

  const interpreted = interpretColumnType(column);
  if (!interpreted) {
    const knownType = column.dataType.state === "known";
    return {
      compatible: knownType ? false : null,
      lengthKnown: false,
      reason: knownType
        ? `Semantic type ${semanticType} requires ${expectedFamily}, but schema type ${String(column.dataType.value)} is unsupported`
        : `Semantic type ${semanticType} cannot be checked because schema type is ${column.dataType.state}`,
      evidence: [],
    };
  }

  if (interpreted.kind !== expectedFamily) {
    return {
      compatible: false,
      lengthKnown: false,
      reason: `Semantic type ${semanticType} requires schema family ${expectedFamily}; received ${interpreted.kind}`,
      evidence: [Object.freeze({
        source: "schema_type",
        observation: String(column.dataType.value),
        explanation: `${interpreted.kind} is incompatible with semantic type ${semanticType}`,
      })],
    };
  }

  const evidence = [Object.freeze({
    source: "schema_type",
    observation: String(column.dataType.value),
    explanation: `${interpreted.kind} is compatible with semantic type ${semanticType}`,
  })];
  if (expectedFamily !== "varchar") {
    return { compatible: true, lengthKnown: true, evidence };
  }

  const length = column.length;
  if (length.state !== "known") {
    return { compatible: true, lengthKnown: false, evidence };
  }

  const minimum = minimumSafeSyntheticLength(semanticType, locale);
  if (!Number.isSafeInteger(length.value) || length.value < minimum) {
    const reason = `Safe Synthetic ${semanticType} needs at least ${minimum} characters for its test marker; schema length is ${String(length.value)}`;
    evidence.push(Object.freeze({
      source: "length",
      observation: String(length.value),
      explanation: reason,
    }));
    return { compatible: false, lengthKnown: true, reason, evidence };
  }

  evidence.push(Object.freeze({
    source: "length",
    observation: String(length.value),
    explanation: `Schema length accommodates the Safe Synthetic ${semanticType} marker`,
  }));
  return { compatible: true, lengthKnown: true, evidence };
}

function minimumSafeSyntheticLength(semanticType, locale) {
  const localized = {
    name: { "zh-CN": 10, en: 14 },
    gender: { "zh-CN": 4, en: 6 },
    mobile: { "zh-CN": 11, en: 11 },
    email: { "zh-CN": 21, en: 21 },
    address: { "zh-CN": 10, en: 14 },
  };
  return localized[semanticType]?.[locale] ?? localized[semanticType]?.["zh-CN"] ?? 1;
}

function findTokenMatches(normalizedName) {
  const tokens = normalizedName.split("_").filter(Boolean);
  const matches = [];
  for (const [semanticType, names] of aliases) {
    for (const alias of names) {
      if (/[^\x00-\x7F]/u.test(alias)) continue;
      const aliasTokens = normalizeColumnName(alias).split("_").filter(Boolean);
      if (aliasTokens.length === 0) continue;
      const start = tokens.findIndex((_token, index) => aliasTokens.every((part, offset) => tokens[index + offset] === part));
      if (start < 0) continue;
      const atSuffix = start + aliasTokens.length === tokens.length;
      matches.push({ semanticType, alias, quality: atSuffix ? "suffix" : "token" });
    }
  }
  return matches;
}
