import { runDbxSchemaMetadataProbe } from "./schema-metadata-probe.mjs";

const elements = {
  button: document.querySelector("#run-probe"),
  capability: document.querySelector("#capability-state"),
  context: document.querySelector("#table-context"),
  metadata: document.querySelector("#metadata-result"),
  diagnostics: document.querySelector("#diagnostics"),
};

const HANDOFF_METHOD = "schemaMetadataProbe/takeTableContext";
const HOST_API_ERROR_CODES = new Set([
  "capability_unavailable",
  "permission_denied",
  "missing_table_context",
  "connection_not_open",
  "metadata_request_failed",
  "invalid_metadata_response",
]);

function showJson(element, value) {
  element.textContent = JSON.stringify(value, null, 2);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function showDiagnostics(diagnostics) {
  const safeDiagnostics = diagnostics.map((diagnostic) => ({
    code: HOST_API_ERROR_CODES.has(diagnostic.code) ? diagnostic.code : "metadata_request_failed",
    message: diagnostic.message,
  }));
  showJson(elements.diagnostics, safeDiagnostics);
}

async function runProbe() {
  const host = window.dbxPlugin;
  elements.button.disabled = true;
  elements.capability.textContent = "检查 schemaMetadataApi…";
  elements.context.textContent = "读取插件暂存的 Table Context…";
  elements.metadata.textContent = "等待 metadata 请求";
  elements.diagnostics.textContent = "[]";

  try {
    const handoff = await host.invoke(HANDOFF_METHOD, {}, { timeoutMs: 5000 });
    const context = handoff && typeof handoff === "object" ? handoff.context : null;
    showJson(elements.context, context);

    const result = await runDbxSchemaMetadataProbe({
      capabilities: host.capabilities,
      getTableMetadata: (tableContext) => host.getTableMetadata(tableContext),
    }, context);

    elements.capability.textContent = result.capability.available ? "available" : "unavailable";
    if (result.ok) {
      showJson(elements.metadata, {
        hostResponse: result.metadata,
        notExposedByHostApi: result.futureCapabilities,
      });
      showDiagnostics(result.diagnostics);
    } else {
      elements.metadata.textContent = "未取得有效 metadata";
      showDiagnostics(result.diagnostics);
    }
  } catch (error) {
    elements.capability.textContent = "尚未确认";
    elements.metadata.textContent = "未取得 metadata";
    showDiagnostics([{ code: "metadata_request_failed", message: errorText(error) }]);
  } finally {
    elements.button.disabled = false;
  }
}

async function start() {
  const host = window.dbxPlugin;
  if (!host) {
    elements.capability.textContent = "unavailable";
    elements.diagnostics.textContent = "DBX Plugin Host bridge 不可用。";
    elements.button.disabled = true;
    return;
  }
  try {
    await host.ready;
    await runProbe();
  } catch (error) {
    elements.capability.textContent = "初始化失败";
    showDiagnostics([{ code: "metadata_request_failed", message: errorText(error) }]);
    elements.button.disabled = false;
  }
}

elements.button.addEventListener("click", () => void runProbe());
void start();
