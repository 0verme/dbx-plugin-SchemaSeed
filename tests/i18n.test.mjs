import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { createGenerationRuleDraft, getGenerationRuleEditorFields } from "../src/generation/generation-rules.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import {
  createI18n,
  createTranslator,
  DEFAULT_UI_LOCALE,
  missingMessageKeys,
  normalizeUiLocale,
  resolveUiLocale,
  SUPPORTED_UI_LOCALES,
} from "../src/i18n/index.mjs";
import { MESSAGE_CATALOGS } from "../src/i18n/catalog.mjs";
import { browserUiLocaleStorage, createUiLocaleStore, readHostLocale, readSavedLocale, saveUiLocale, UI_LOCALE_STORAGE_KEY } from "../src/i18n/ui-locale.mjs";
import { DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { normalizeTableSchema } from "../src/schema/schema-model.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_LOCALE = "zh-CN";
const BASE_CONTEXT = Object.freeze({ connectionId: "connection-A", table: "customer" });

/** @param {{ [key: string]: string } | null} [entries] */
function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries ?? {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    value: (key) => map.get(key),
  };
}

function previewCore(calls = []) {
  return async (schema, options) => {
    calls.push({ schema, options: structuredClone(options) });
    const plan = buildGenerationPlan(schema, options);
    const generated = generateRows(plan);
    return JSON.parse(JSON.stringify({ plan, generated }));
  };
}

function hostFor(response, calls = []) {
  return new DbxHostSchemaMetadataProvider({
    capabilities: { schemaMetadataApi: true },
    async getTableMetadata(context) {
      calls.push(context);
      return response;
    },
  });
}

function metadataResponse(columns, fieldCapabilities = {
  length: "supported",
  precision: "supported",
  scale: "supported",
  default: "supported",
}) {
  return { columns, fieldCapabilities };
}

async function walkModules(directory, suffix) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "i18n") continue;
      files.push(...await walkModules(relative, suffix));
    } else if (entry.name.endsWith(suffix)) {
      files.push(relative);
    }
  }
  return files;
}

describe("i18n locale strategy", () => {
  it("supports zh-CN and en-US with en-US as the reference locale", () => {
    assert.deepEqual(SUPPORTED_UI_LOCALES, ["zh-CN", "en-US"]);
    assert.equal(DEFAULT_UI_LOCALE, "en-US");
    assert.equal(createI18n("zh-CN").locale, "zh-CN");
    assert.equal(createI18n("en-US").locale, "en-US");
  });

  it("maps Chinese and English region tags to a supported UI locale", () => {
    for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans-CN", "zh-TW", "zh_CN"]) {
      assert.equal(normalizeUiLocale(tag), "zh-CN", `${tag} maps to zh-CN`);
    }
    for (const tag of ["en", "en-US", "en-GB", "EN_us"]) {
      assert.equal(normalizeUiLocale(tag), "en-US", `${tag} maps to en-US`);
    }
    for (const tag of ["fr", "de-DE", "ja", "", "   ", null, undefined, 42, {}]) {
      assert.equal(normalizeUiLocale(tag), null, `${String(tag)} is unsupported`);
    }
  });

  it("resolves host locale, then saved locale, then browser locale, then en-US", () => {
    assert.deepEqual(resolveUiLocale({ hostLocale: "en-US", savedLocale: "zh-CN", navigatorLanguage: "zh-CN" }), { locale: "en-US", source: "host" });
    assert.deepEqual(resolveUiLocale({ savedLocale: "zh-CN", navigatorLanguage: "en-US" }), { locale: "zh-CN", source: "saved" });
    assert.deepEqual(resolveUiLocale({ navigatorLanguage: "zh-SG" }), { locale: "zh-CN", source: "browser" });
    assert.deepEqual(resolveUiLocale({ navigatorLanguage: "fr-FR" }), { locale: "en-US", source: "default" });
    assert.deepEqual(resolveUiLocale({ hostLocale: "fr-FR", savedLocale: "??", navigatorLanguage: "de" }), { locale: "en-US", source: "default" });
    assert.deepEqual(resolveUiLocale(), { locale: "en-US", source: "default" });
  });

  it("falls back to en-US for unsupported locales and never crashes on a missing key", () => {
    const unsupported = createI18n("fr-FR");
    assert.equal(unsupported.locale, "en-US");
    assert.equal(unsupported("app.titleSuffix"), "Generation Workbench");

    // A partial locale catalog must resolve missing keys from en-US and, as the
    // last resort, return the key text instead of throwing.
    const partial = createTranslator("zh-CN", {
      "zh-CN": { "app.titleSuffix": "测试数据生成" },
      "en-US": { "app.titleSuffix": "Generation Workbench", "app.subtitle": "English fallback copy" },
    });
    assert.equal(partial("app.titleSuffix"), "测试数据生成");
    assert.equal(partial("app.subtitle"), "English fallback copy", "missing zh-CN key falls back to en-US");
    assert.equal(partial("totally.missing.key"), "totally.missing.key");
    assert.equal(partial(""), "");
    assert.equal(partial(null), "");
    assert.equal(partial(undefined, { value: 1 }), "");

    for (const locale of SUPPORTED_UI_LOCALES) {
      const t = createI18n(locale);
      assert.deepEqual(missingMessageKeys(locale), [], `${locale} has no missing key`);
      const extra = t.keys().filter((key) => !(key in MESSAGE_CATALOGS["en-US"]));
      assert.deepEqual(extra, [], `${locale} has no key that en-US lacks`);
    }
  });

  it("keeps zh-CN and en-US copy distinct for the main Workbench surfaces", () => {
    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    for (const key of ["app.titleSuffix", "context.title", "controls.rows", "controls.dataLocale", "actions.generate", "diagnostics.title", "preview.title", "preview.readonly", "export.csv", "status.blocked", "state.blocked.plan", "constraints.empty.none", "safety.notice", "footer.statement"]) {
      assert.equal(typeof zh(key), "string");
      assert.notEqual(zh(key), en(key), `${key} must be localized`);
      assert.doesNotMatch(en(key), /\{/, `${key} has no unresolved placeholder`);
    }
  });

  it("interpolates raw values without translating them", () => {
    const zh = createI18n("zh-CN");
    const summary = zh("preview.summary", { rows: 20, seed: "demo", locale: "zh-CN", profile: "sha256-v1" });
    assert.match(summary, /20/);
    assert.match(summary, /demo/);
    assert.match(summary, /zh-CN/, "the generation locale value is shown verbatim");
    assert.match(summary, /sha256-v1/);
    assert.equal(zh("columns.strategyDetail", { source: "按字段类型", detected: "姓名", confidence: "高可信度" }), "按字段类型 · 识别为 姓名（高可信度）");
    // Unresolved placeholders stay visible instead of producing "undefined".
    assert.match(zh("preview.summary", { rows: 1 }), /\{seed\}/);
  });
});

describe("i18n UI locale persistence", () => {
  it("prefers a host locale, saves the user's choice, and announces changes", () => {
    const storage = memoryStorage();
    const store = createUiLocaleStore({ storage, navigatorLanguage: "zh-CN" });
    assert.equal(store.getLocale(), "zh-CN");
    assert.equal(store.getSource(), "browser");

    const seen = [];
    const unsubscribe = store.subscribe((translator) => seen.push(translator.locale));
    const translator = store.setLocale("en-US");
    assert.equal(translator.locale, "en-US");
    assert.equal(store.getLocale(), "en-US");
    assert.equal(store.getSource(), "saved");
    assert.equal(storage.value(UI_LOCALE_STORAGE_KEY), "en-US");
    assert.deepEqual(seen, ["en-US"]);
    unsubscribe();

    const reopened = createUiLocaleStore({ storage, navigatorLanguage: "zh-CN" });
    assert.equal(reopened.getLocale(), "en-US", "the saved locale outranks the browser locale");
    assert.equal(reopened.getSource(), "saved");

    const hosted = createUiLocaleStore({ storage: memoryStorage({ [UI_LOCALE_STORAGE_KEY]: "en-US" }), hostLocale: "zh-CN", navigatorLanguage: "en-US" });
    assert.equal(hosted.getLocale(), "zh-CN", "a real host locale outranks the saved locale");
    assert.equal(hosted.getSource(), "host");
  });

  it("never invents a host locale and survives unavailable storage", () => {
    // DBX Host API ^1.3 exposes no locale: the host slot must stay empty.
    assert.equal(readHostLocale({ capabilities: { schemaMetadataApi: true }, context: { table: "t" }, invoke() {} }), undefined);
    assert.equal(readHostLocale(null), undefined);
    assert.equal(readHostLocale({ locale: "   " }), undefined);
    assert.equal(readHostLocale({ locale: "zh-CN" }), "zh-CN");

    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    assert.equal(readSavedLocale(throwing), undefined);
    assert.equal(saveUiLocale(throwing, "zh-CN"), false);
    assert.equal(browserUiLocaleStorage({ get localStorage() { throw new Error("denied"); } }), null);
    const store = createUiLocaleStore({ storage: throwing, navigatorLanguage: "zh-CN" });
    assert.equal(store.getLocale(), "zh-CN");
    store.setLocale("en-US");
    assert.equal(store.getLocale(), "en-US");
    assert.equal(store.setLocale("fr-FR").locale, "en-US", "an unsupported locale is ignored");
  });
});

describe("UI locale and synthetic data locale stay independent", () => {
  it("changing the generation locale does not switch the interface language", async () => {
    const controller = new DbxGenerationWorkbenchController({
      provider: hostFor(metadataResponse([{ name: "customer_name", dataType: "varchar", nullable: false, length: 24 }])),
      preview: previewCore(),
      translator: createI18n("zh-CN"),
    });
    let view = await controller.setContext(BASE_CONTEXT);
    assert.equal(view.controls.locale, "zh-CN");
    assert.equal(controller.translator.locale, "zh-CN");
    assert.match(view.columns[0].mappingStatus, /待确认/);

    view = await controller.dispatch({ type: "update-controls", controls: { rowCount: 5, seed: "demo", locale: "en" } });
    assert.equal(view.controls.locale, "en", "the generation locale changed");
    assert.equal(controller.translator.locale, "zh-CN", "the interface language did not");
    assert.match(view.columns[0].mappingStatus, /待确认/, "view-model copy stays in the UI language");
    assert.equal(view.plan.locale, "en", "Core received the generation locale");
  });

  it("changing the interface language does not touch the generation locale, plan or dataset", async () => {
    const previewCalls = [];
    const controller = new DbxGenerationWorkbenchController({
      provider: hostFor(metadataResponse([{ name: "customer_id", dataType: "integer", nullable: false }])),
      preview: previewCore(previewCalls),
      translator: createI18n("en-US"),
    });
    const store = createUiLocaleStore({ storage: memoryStorage(), navigatorLanguage: "en-US" });
    let view = await controller.setContext(BASE_CONTEXT);
    const callsAfterGenerate = previewCalls.length;
    const generatedRows = structuredClone(view.preview.rows);
    assert.equal(view.controls.locale, "zh-CN", "generation locale keeps its own default");
    assert.equal(controller.translator.locale, "en-US");

    store.setLocale("zh-CN");
    controller.setTranslator(store.getTranslator());
    view = controller.getViewModel();
    assert.equal(controller.translator.locale, "zh-CN");
    assert.equal(view.controls.locale, "zh-CN", "generation locale untouched");
    assert.equal(previewCalls.length, callsAfterGenerate, "no regeneration happens on a language change");
    assert.deepEqual(view.preview.rows, generatedRows, "the dataset is untouched");
    assert.equal(view.plan.seed, "demo");
    assert.equal(view.columns[0].mappingStatus, "默认策略");
  });

  it("keeps the Workbench UI free of inline locale branches and hardcoded CJK copy", async () => {
    const files = [
      "ui/generation-workbench/app.mjs",
      "ui/app.mjs",
      "src/workbench/workbench-view-model.mjs",
      "src/workbench/dbx-generation-workbench-controller.mjs",
      "src/i18n/workbench-messages.mjs",
      "src/i18n/diagnostics.mjs",
      "src/i18n/labels.mjs",
    ];
    for (const relative of files) {
      const source = await readFile(path.join(root, relative), "utf8");
      assert.doesNotMatch(source, /locale === "zh-CN"\s*\?/, `${relative} must not branch on the locale inline`);
      assert.doesNotMatch(source, /[\u4e00-\u9fff]/, `${relative} must not contain hardcoded Chinese copy`);
    }
  });

  it("covers every diagnostic code found in the Core and provider sources", async () => {
    const codePattern = /(?:code:\s*"([a-z][a-z0-9_]+)"|fail(?:Scalar)?\(\s*"([a-z][a-z0-9_]+)")/g;
    const codes = new Set(["generation_runtime_failed"]);
    for (const relative of await walkModules("src", ".mjs")) {
      const source = await readFile(path.join(root, relative), "utf8");
      for (const match of source.matchAll(codePattern)) codes.add(match[1] ?? match[2]);
    }
    assert.ok(codes.size > 30, `expected to discover the Core diagnostic codes, found ${codes.size}`);
    for (const locale of SUPPORTED_UI_LOCALES) {
      const t = createI18n(locale);
      for (const code of codes) {
        assert.equal(t.has(`diagnostic.${code}.title`), true, `${locale} localizes diagnostic ${code}`);
        assert.equal(t.has(`diagnostic.${code}.description`), true, `${locale} explains diagnostic ${code}`);
      }
    }
  });
});

describe("i18n key coverage in the Workbench sources", () => {
  const UI_SOURCES = [
    "ui/generation-workbench/app.mjs",
    "ui/app.mjs",
    "src/i18n/diagnostics.mjs",
    "src/i18n/labels.mjs",
    "src/i18n/ui-locale.mjs",
    "src/i18n/workbench-messages.mjs",
    "src/workbench/workbench-view-model.mjs",
  ];
  const STATIC_KEY = /(?:\bt(?:\.has)?\(\s*"([^"]+)"|data-i18n(?:-title)?="([^"]+)")/g;

  it("uses only keys that exist in both catalogs", async () => {
    const keys = new Set();
    for (const relative of UI_SOURCES) {
      const source = await readFile(path.join(root, relative), "utf8");
      for (const match of source.matchAll(STATIC_KEY)) keys.add(match[1] ?? match[2]);
    }
    assert.ok(keys.size > 60, `expected the Workbench to reference many message keys, found ${keys.size}`);
    for (const locale of SUPPORTED_UI_LOCALES) {
      const t = createI18n(locale);
      for (const key of keys) assert.equal(t.has(key), true, `${locale} resolves ${key}`);
    }
    // Documentation and tests are not the UI, but the key sets stay in sync.
    assert.equal(createI18n("zh-CN").has("diagnostic.varchar_length_unknown.title"), true);
    assert.equal(createI18n("zh-CN").has("diagnostic.semantic_confirmation_required.title"), true);
  });

  it("resolves every element id the production Workbench UI looks up", async () => {
    const source = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
    const markup = /const WORKBENCH_MARKUP = `([\s\S]*?)`;/.exec(source)?.[1] ?? "";
    const declared = new Set([...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
    const used = new Set([...source.matchAll(/element\("([^"]+)"\)/g)].map((match) => match[1]));
    assert.ok(declared.size > 20, "the Workbench markup declares its elements");
    for (const id of used) assert.equal(declared.has(id), true, `element #${id} exists in the Workbench markup`);
    // Every i18n-bound node must carry a key that is valid for the active locale.
    for (const key of [...markup.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1])) {
      assert.equal(createI18n("zh-CN").has(key), true, `markup binds ${key}`);
      assert.equal(createI18n("en-US").has(key), true, `markup binds ${key}`);
    }
  });

  it("localizes every dynamic key family the presentation layer builds", () => {
    const t = createI18n("zh-CN");
    for (const level of ["blocking", "warning", "error", "unsupported", "needs_confirmation"]) {
      assert.equal(t.has(`diagnostics.level.${level}`), true, `diagnostics.level.${level}`);
    }
    for (const fallback of ["export.error.export_error", "confidence.unknown", "semantic.unknown", "schemaType.state.unknown", "status.error", "constraints.capacity.unknown", "export.ready", "uiLocale.zh-CN", "uiLocale.en-US", "ruleSource.schema_type_fallback", "mappingStatus.needsConfirmation", "detected.ambiguous", "diagnostics.fallback.title", "diagnostics.fallback.description"]) {
      assert.equal(t.has(fallback), true, fallback);
    }
  });

  it("localizes every rule kind and rule editor field the Generation Core publishes", () => {
    const column = normalizeTableSchema({
      tableIdentity: "rule-field-coverage",
      columns: [{ name: "value", dataType: "varchar", nullable: true, length: 32 }],
    }).schema.columns[0];
    const kinds = [
      "auto", "constant", "sequence", "random_integer", "random_decimal", "random_string",
      "enum", "boolean_ratio", "date_range", "timestamp_range", "uuid", "null_ratio", "semantic",
    ];
    for (const kind of kinds) {
      const draft = createGenerationRuleDraft(column, kind);
      const fields = getGenerationRuleEditorFields(column, draft);
      assert.ok(fields.length > 0 || kind === "auto" || kind === "uuid", `${kind} publishes editor fields`);
      for (const locale of SUPPORTED_UI_LOCALES) {
        const t = createI18n(locale);
        assert.equal(t.has(`ruleKind.${kind}`), true, `${locale} names generation rule ${kind}`);
        for (const field of fields) {
          const localized = t.has(`ruleField.${kind}.${field.key}`) || t.has(`ruleField.${field.key}`);
          assert.equal(localized, true, `${locale} labels ${kind}.${field.key}`);
        }
      }
    }
  });
});
