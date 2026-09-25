import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createExportFilename } from "../src/export/export-dataset.mjs";
import { generateRows } from "../src/generation/generation-engine.mjs";
import { buildGenerationPlan } from "../src/generation/generation-plan.mjs";
import { createI18n } from "../src/i18n/index.mjs";
import { exportSaveMessage } from "../src/i18n/workbench-messages.mjs";
import { DbxHostSchemaMetadataProvider } from "../src/providers/dbx-host-schema-metadata-provider.mjs";
import { DbxGenerationWorkbenchController } from "../src/workbench/dbx-generation-workbench-controller.mjs";
import { EXPORT_SAVE_ERROR, encodeExportContent, saveExportWithHost } from "../ui/generation-workbench/export-save.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_CONTEXT = Object.freeze({ connectionId: "connection-A", database: "db", schema: "public", table: "audit_results" });
const COLUMNS = Object.freeze([
  { name: "audit_id", dataType: "integer", nullable: false },
  { name: "note", dataType: "varchar", nullable: true, length: 64 },
]);

function previewCore(calls = []) {
  return async (schema, options) => {
    calls.push({ schema, options: structuredClone(options) });
    const plan = buildGenerationPlan(schema, options);
    const generated = generateRows(plan);
    return JSON.parse(JSON.stringify({ plan, generated }));
  };
}

function productionProvider(columns = COLUMNS) {
  return new DbxHostSchemaMetadataProvider({
    capabilities: { schemaMetadataApi: true },
    async getTableMetadata() {
      return {
        columns,
        fieldCapabilities: { length: "supported", precision: "supported", scale: "supported", default: "supported" },
      };
    },
  });
}

async function generatedController(options = {}) {
  const previewCalls = [];
  const controller = new DbxGenerationWorkbenchController({
    provider: productionProvider(options.columns),
    preview: previewCore(previewCalls),
  });
  const view = await controller.setContext(BASE_CONTEXT);
  return { controller, view, previewCalls };
}

function recordingSave() {
  const calls = [];
  const saveFile = async (request, bytes) => {
    calls.push({ request, bytes: Uint8Array.from(bytes) });
    return { path: `C:/saved/${request.fileName}` };
  };
  return { calls, saveFile };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("production Workbench export save adapter", () => {
  it("hands CSV / JSON / INSERT SQL descriptors to the Host save API with the deterministic filename, MIME and UTF-8 bytes", async () => {
    const { controller, view } = await generatedController();
    const expectations = {
      csv: { mimeType: "text/csv;charset=utf-8", prefix: "\uFEFF" },
      json: { mimeType: "application/json;charset=utf-8", prefix: null },
      sql: { mimeType: "application/sql;charset=utf-8", prefix: null },
    };
    for (const format of ["csv", "json", "sql"]) {
      const descriptor = controller.prepareExport(format);
      const expectedName = createExportFilename(controller.currentDataset.tableIdentity, view.preview.rows.length, format);
      assert.equal(descriptor.filename, expectedName, `${format} filename still comes from createExportFilename`);
      assert.match(descriptor.filename, new RegExp(`^schemaseed-.+-${view.preview.rows.length}rows\\.${format}$`));

      const { calls, saveFile } = recordingSave();
      const result = await saveExportWithHost(saveFile, descriptor);

      assert.equal(result.status, "saved");
      assert.equal(result.path, `C:/saved/${descriptor.filename}`);
      assert.equal(calls.length, 1, `${format} reaches the Host exactly once`);
      assert.deepEqual(calls[0].request, { fileName: descriptor.filename, contentType: descriptor.mimeType });
      assert.equal(calls[0].request.contentType, expectations[format].mimeType);
      assert.deepEqual(calls[0].bytes, encodeExportContent(descriptor.content), `${format} bytes are the UTF-8 encoding of the serialized content`);
      if (expectations[format].prefix !== null) {
        assert.equal(calls[0].bytes[0], 0xEF, `${format} keeps the serializer BOM contract`);
        assert.equal(calls[0].bytes[1], 0xBB);
        assert.equal(calls[0].bytes[2], 0xBF);
      }
      assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(calls[0].bytes), descriptor.content, `${format} bytes round-trip`);
    }
  });

  it("reports a success only after the Host save promise resolves", async () => {
    const { controller } = await generatedController();
    const descriptor = controller.prepareExport("json");
    const pendingSave = deferred();
    let settled = false;
    const pendingResult = saveExportWithHost(() => pendingSave.promise, descriptor).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(settled, false, "no result is reported while the Host dialog is still open");

    pendingSave.resolve({ path: "C:/saved/report.json" });
    const result = await pendingResult;
    assert.equal(settled, true);
    assert.deepEqual(result, { status: "saved", path: "C:/saved/report.json" });
  });

  it("treats a Host null result as user cancellation, never as success or failure", async () => {
    const { controller } = await generatedController();
    for (const format of ["csv", "json", "sql"]) {
      const descriptor = controller.prepareExport(format);
      assert.deepEqual(await saveExportWithHost(async () => null, descriptor), { status: "cancelled" });
      assert.deepEqual(await saveExportWithHost(async () => undefined, descriptor), { status: "cancelled" });
    }

    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    const cancelled = { status: "cancelled" };
    assert.equal(exportSaveMessage(cancelled, zh), "已取消保存。");
    assert.match(exportSaveMessage(cancelled, en), /cancelled/);
    for (const t of [zh, en]) {
      assert.doesNotMatch(exportSaveMessage(cancelled, t), /已保存|Saved|失败|failed/i, "cancellation is not a success or failure message");
    }
  });

  it("fails closed with an upgrade hint when the DBX Host has no native save API", async () => {
    const { controller } = await generatedController();
    const descriptor = controller.prepareExport("csv");
    const result = await saveExportWithHost(undefined, descriptor);
    assert.deepEqual(result, { status: "failed", code: EXPORT_SAVE_ERROR.HOST_UNAVAILABLE });

    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    const message = { status: "failed", code: result.code };
    assert.match(exportSaveMessage(message, zh), /当前 DBX 版本不支持文件保存，请升级 DBX/);
    assert.match(exportSaveMessage(message, en), /update DBX/);
    assert.doesNotMatch(exportSaveMessage(message, zh), /已保存/);
    assert.doesNotMatch(exportSaveMessage(message, en), /Saved/);
  });

  it("maps a Host rejection to a localized save failure, never to success", async () => {
    const { controller } = await generatedController();
    const descriptor = controller.prepareExport("sql");
    const result = await saveExportWithHost(async () => {
      throw new Error("native dialog exploded");
    }, descriptor);
    assert.deepEqual(result, { status: "failed", code: EXPORT_SAVE_ERROR.HOST_FAILED });

    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    const message = { status: "failed", code: result.code };
    assert.match(exportSaveMessage(message, zh), /^保存失败：export_host_save_failed · 系统保存窗口或写入文件时出错。$/);
    assert.match(exportSaveMessage(message, en), /^Save failed: export_host_save_failed · The system save dialog or the file write failed\.$/);
    assert.doesNotMatch(exportSaveMessage(message, en), /Saved /);
  });

  it("encodes Chinese synthetic values as UTF-8 bytes without touching the serializers", async () => {
    const { controller } = await generatedController();
    await controller.dispatch({ type: "update-rule", column: "note", rule: { kind: "constant", value: "中文测试" } });
    let view = await controller.dispatch({ type: "generate" });
    assert.equal(view.plan.seed, controller.controls.seed);

    const { calls, saveFile } = recordingSave();
    const descriptor = controller.prepareExport("json");
    assert.match(descriptor.content, /中文测试/);
    const result = await saveExportWithHost(saveFile, descriptor);
    assert.equal(result.status, "saved");

    const decoded = new TextDecoder().decode(calls[0].bytes);
    assert.match(decoded, /中文测试/);
    assert.deepEqual(calls[0].bytes, encodeExportContent(descriptor.content));
    assert.equal(calls[0].bytes.includes(0x3F), false, "no lossy question-mark replacement in the UTF-8 bytes");

    const csv = controller.prepareExport("csv");
    const csvCall = recordingSave();
    await saveExportWithHost(csvCall.saveFile, csv);
    const csvBytes = csvCall.calls[0].bytes;
    assert.equal(csvBytes[0], 0xEF, "CSV still carries its UTF-8 BOM");
    assert.match(new TextDecoder().decode(csvBytes), /中文测试/);
  });

  it("exports the frozen current dataset and never regenerates rows", async () => {
    const { controller, view, previewCalls } = await generatedController();
    const dataset = controller.currentDataset;
    const callsBeforeExport = previewCalls.length;

    const csvDescriptor = controller.prepareExport("csv");
    const jsonDescriptor = controller.prepareExport("json");
    const sqlDescriptor = controller.prepareExport("sql");
    const { saveFile } = recordingSave();
    assert.equal((await saveExportWithHost(saveFile, csvDescriptor)).status, "saved");
    assert.equal((await saveExportWithHost(saveFile, jsonDescriptor)).status, "saved");
    assert.equal((await saveExportWithHost(saveFile, sqlDescriptor)).status, "saved");

    assert.equal(previewCalls.length, callsBeforeExport, "Host saves never call Core generation");
    assert.equal(controller.currentDataset, dataset, "the current dataset snapshot stays frozen");
    assert.deepEqual(JSON.parse(jsonDescriptor.content), view.preview.rows, "JSON export equals the preview rows");
    assert.match(csvDescriptor.content, /audit_id,note/);
    assert.match(sqlDescriptor.content, /INSERT INTO/);
    assert.equal(csvDescriptor.summary.rowCount, view.preview.rows.length);
    assert.equal(sqlDescriptor.summary.rowCount, view.preview.rows.length);
  });

  it("keeps prepare failures on the existing localized export error wording", async () => {
    const { controller } = await generatedController();
    await controller.dispatch({ type: "update-rule", column: "audit_id", rule: { kind: "random_integer", min: 0, max: Number.MAX_SAFE_INTEGER } });
    assert.equal(controller.getViewModel().export.enabled, false);

    const zh = createI18n("zh-CN");
    const message = exportSaveMessage({ status: "prepare_failed", code: "export_blocked_plan" }, zh);
    assert.match(message, /^导出失败：export_blocked_plan · 当前 GenerationPlan 被阻塞，无法导出。$/);
  });
});

describe("production Workbench save path regression", () => {
  it("uses the DBX Host native save and no browser Blob download in the production Workbench", async () => {
    const source = await readFile(path.join(root, "ui/generation-workbench/app.mjs"), "utf8");
    assert.match(source, /saveExportWithHost/);
    assert.match(source, /export-save\.mjs/);
    assert.match(source, /host\.saveFile/, "the production Workbench reads the public window.dbxPlugin.saveFile host method");
    assert.doesNotMatch(source, /URL\.createObjectURL/, "no object URLs in the production save path");
    assert.doesNotMatch(source, /new Blob\(/, "no Blob download in the production save path");
    assert.doesNotMatch(source, /link\.click\(\)|\.download\s*=/, "no <a download> click in the production save path");
  });

  it("keeps the standalone browser harness on its own Blob download path", async () => {
    const source = await readFile(path.join(root, "web/app.mjs"), "utf8");
    assert.match(source, /new Blob\(/);
    assert.match(source, /URL\.createObjectURL/);
    assert.match(source, /link\.download/);
  });

  it("keeps zh-CN / en-US save copy aligned and free of leaked machine text", () => {
    const keys = [
      "export.saving",
      "export.waiting",
      "export.saved",
      "export.savedTo",
      "export.savedSimple",
      "export.cancelled",
      "export.saveFailed",
      "export.error.export_host_save_unavailable",
      "export.error.export_host_save_failed",
    ];
    const zh = createI18n("zh-CN");
    const en = createI18n("en-US");
    for (const key of keys) {
      assert.equal(zh.has(key), true, `zh-CN has ${key}`);
      assert.equal(en.has(key), true, `en-US has ${key}`);
      assert.doesNotMatch(en(key), /[\u4e00-\u9fff]/, `en-US ${key} stays English`);
      assert.doesNotMatch(zh(key), /export\.[a-z]/, `zh-CN ${key} resolves to copy`);
    }

    const descriptor = { filename: "schemaseed-audit_results-20rows.sql", summary: { rowCount: 20, format: "SQL" } };
    assert.equal(exportSaveMessage({ status: "saved", descriptor }, zh), "已保存 schemaseed-audit_results-20rows.sql（20 行 · SQL · UTF-8）");
    assert.equal(exportSaveMessage({ status: "saved", path: "C:/out/a.sql", descriptor }, zh), "已保存到：C:/out/a.sql");
    assert.match(exportSaveMessage({ status: "saving", descriptor }, en), /Preparing/);
    assert.match(exportSaveMessage({ status: "waiting", descriptor }, en), /system save dialog/);
  });
});
