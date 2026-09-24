import { GENERATION_PREVIEW_METHOD } from "../../src/generation/generation-runtime-contract.mjs";
import { DbxHostSchemaMetadataProvider } from "../../src/providers/dbx-host-schema-metadata-provider.mjs";
import { DbxGenerationWorkbenchController } from "../../src/workbench/dbx-generation-workbench-controller.mjs";

const WORKBENCH_MARKUP = `
  <div class="sswb">
    <header class="sswb-header">
      <div class="sswb-brand"><span class="sswb-mark" aria-hidden="true">S</span><div><h1>SchemaSeed <span>Generation Workbench</span></h1><p>DBX Table Context · schema-aware synthetic data</p></div></div>
      <span id="sswb-status" class="sswb-status" role="status" aria-live="polite">加载中</span>
    </header>
    <main class="sswb-main">
      <section class="sswb-panel" aria-labelledby="sswb-context-title">
        <div class="sswb-heading"><div><h2 id="sswb-context-title">当前表</h2><p class="sswb-caption">直接使用 DBX 传入的 TableContext；database / schema 可选</p></div><span class="sswb-context-tag">DBX HOST</span></div>
        <div class="sswb-context-grid">
          <div><span>Database</span><strong id="sswb-database">—</strong></div>
          <div><span>Schema</span><strong id="sswb-schema">—</strong></div>
          <div><span>Table</span><strong id="sswb-table">—</strong></div>
        </div>
        <form id="sswb-controls" class="sswb-controls">
          <label>Rows <small>1–100</small><input id="sswb-rows" name="rowCount" type="number" min="1" max="100" value="20" required></label>
          <label>Seed<input id="sswb-seed" name="seed" type="text" value="demo" maxlength="128"></label>
          <label>Locale<select id="sswb-locale" name="locale"><option value="zh-CN">zh-CN</option><option value="en">en</option></select></label>
          <div class="sswb-actions"><button class="sswb-button sswb-primary" type="button" data-sswb-action="generate">Generate</button><button class="sswb-button" type="button" data-sswb-action="regenerate-same-seed">Regenerate Same Seed</button><button class="sswb-button" type="button" data-sswb-action="new-seed">New Seed</button></div>
        </form>
        <p id="sswb-action-error" class="sswb-inline-error" role="alert" hidden></p>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-columns-title">
        <div class="sswb-heading"><div><h2 id="sswb-columns-title">字段与当前生成策略</h2><p class="sswb-caption">Generator、Semantic Mapping 与 evidence 来自现有 GenerationPlan</p></div></div>
        <div class="sswb-scroll"><table class="sswb-mapping"><thead><tr><th>字段名</th><th>Schema Type</th><th>当前 generator / semantic mapping</th><th>Mapping 状态</th><th>Diagnostics / Evidence</th></tr></thead><tbody id="sswb-columns"></tbody></table></div>
        <div class="sswb-rule-slot"><strong>Rule Editor integration slot · Issue #32</strong><span>本 Workbench 仅展示当前 mapping；完整规则编辑器不属于 Issue #31。</span></div>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-diagnostics-title">
        <div class="sswb-heading"><div><h2 id="sswb-diagnostics-title">Diagnostics</h2><p class="sswb-caption">复用 Host Provider / Generation Core diagnostics</p></div></div>
        <div id="sswb-diagnostics" class="sswb-diagnostics"></div>
      </section>

      <section class="sswb-panel" aria-labelledby="sswb-preview-title">
        <div class="sswb-heading"><div><h2 id="sswb-preview-title">Preview</h2><p id="sswb-preview-summary" class="sswb-caption">等待真实 DBX TableContext</p></div><span class="sswb-readonly">READ ONLY</span></div>
        <p id="sswb-state-message" class="sswb-state-message" role="status"></p>
        <p id="sswb-safe-notice" class="sswb-safe-notice"></p>
        <div class="sswb-export-row"><div><button id="sswb-export-csv" class="sswb-button" type="button" data-sswb-export="csv" disabled>Export CSV</button><button id="sswb-export-json" class="sswb-button" type="button" data-sswb-export="json" disabled>Export JSON</button></div><span id="sswb-export-message" role="status" aria-live="polite">Export is available after a successful preview.</span></div>
        <div class="sswb-scroll sswb-preview-scroll"><table class="sswb-preview"><thead><tr id="sswb-preview-head"></tr></thead><tbody id="sswb-preview-body"></tbody></table></div>
      </section>
      <footer>Production DBX Workbench · No fixture fallback · No second database connection · No database writes</footer>
    </main>
  </div>`;

/** @param {HTMLElement} root @param {object} host @param {unknown} initialContext */
export async function mountGenerationWorkbench(root, host, initialContext) {
  root.innerHTML = WORKBENCH_MARKUP;
  const controller = new DbxGenerationWorkbenchController({
    provider: new DbxHostSchemaMetadataProvider({
      capabilities: host.capabilities,
      getTableMetadata: (tableContext) => host.getTableMetadata(tableContext),
    }),
    preview: (schema, options) => host.invoke(
      GENERATION_PREVIEW_METHOD,
      { schema, options },
      { timeoutMs: 30_000 },
    ),
  });
  const unsubscribeRender = controller.subscribe(render);
  const unsubscribeContext = host.onContext((context) => {
    void controller.setContext(context);
  });
  root.addEventListener("change", onControlsChange);
  root.addEventListener("click", onClick);
  await controller.setContext(host.context ?? initialContext);
  render(controller.getViewModel());

  function onControlsChange(event) {
    const target = event.target;
    if (target.matches("#sswb-rows, #sswb-seed, #sswb-locale")) {
      void controller.dispatch({
        type: "update-controls",
        controls: {
          rowCount: Number(element("sswb-rows").value),
          seed: element("sswb-seed").value,
          locale: element("sswb-locale").value,
        },
      });
    }
  }

  function onClick(event) {
    const target = event.target.closest("[data-sswb-action], [data-sswb-export]");
    if (!target) return;
    if (target.dataset.sswbExport) {
      try {
        const descriptor = controller.prepareExport(target.dataset.sswbExport);
        const objectUrl = URL.createObjectURL(new Blob([descriptor.content], { type: descriptor.mimeType }));
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = descriptor.filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        element("sswb-export-message").textContent = `${descriptor.summary.rowCount} rows · ${descriptor.summary.format} · UTF-8`;
      } catch (error) {
        element("sswb-export-message").textContent = `${error.code ?? "export_error"} · ${error.message}`;
      }
      return;
    }
    void controller.dispatch({ type: target.dataset.sswbAction });
  }

  function render(viewModel) {
    const context = viewModel.context;
    element("sswb-database").textContent = context?.database ?? "—";
    element("sswb-schema").textContent = context?.schema ?? "—";
    element("sswb-table").textContent = context?.table ?? "—";
    element("sswb-status").textContent = statusLabel(viewModel);
    element("sswb-status").dataset.status = viewModel.status;
    element("sswb-state-message").textContent = stateMessage(viewModel);
    element("sswb-state-message").dataset.status = viewModel.status;
    element("sswb-action-error").textContent = viewModel.actionError ?? "";
    element("sswb-action-error").hidden = !viewModel.actionError;
    element("sswb-safe-notice").textContent = viewModel.plan ? viewModel.safeSyntheticNotice : "";
    const rowInput = element("sswb-rows");
    const seedInput = element("sswb-seed");
    const localeInput = element("sswb-locale");
    if (document.activeElement !== rowInput) rowInput.value = String(viewModel.controls.rowCount);
    if (document.activeElement !== seedInput) seedInput.value = viewModel.controls.seed;
    if (document.activeElement !== localeInput) localeInput.value = viewModel.controls.locale;
    for (const control of root.querySelectorAll("button, input, select")) control.disabled = viewModel.status === "loading";
    renderColumns(viewModel.columns);
    renderDiagnostics(viewModel.diagnostics);
    renderPreview(viewModel);
    element("sswb-export-csv").disabled = !viewModel.export.enabled || viewModel.status === "loading";
    element("sswb-export-json").disabled = !viewModel.export.enabled || viewModel.status === "loading";
    if (viewModel.status === "loading" || !viewModel.export.enabled) {
      element("sswb-export-message").textContent = "Export is available after a successful preview.";
    }
  }

  function renderColumns(columns) {
    const body = element("sswb-columns");
    body.replaceChildren();
    if (columns.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = controller.status === "loading" ? "正在读取 schema metadata…" : "暂无可展示字段。";
      row.append(cell);
      body.append(row);
      return;
    }
    for (const column of columns) {
      const row = document.createElement("tr");
      row.append(textCell(column.column, "sswb-column-name"));
      row.append(textCell(column.schemaType, "sswb-mono"));
      const strategy = document.createElement("td");
      const generator = document.createElement("strong");
      generator.textContent = column.selectedMapping;
      const detail = document.createElement("small");
      detail.textContent = `${column.rule.source.replaceAll("_", " ")} · detected ${column.detected} (${column.confidence})`;
      strategy.append(generator, detail);
      row.append(strategy);
      row.append(textCell(column.mappingStatus, "sswb-mapping-status"));
      const detailsCell = document.createElement("td");
      if (column.evidence.length > 0) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = `${column.evidence.length} evidence item(s)`;
        const list = document.createElement("ul");
        for (const entry of column.evidence) {
          const item = document.createElement("li");
          item.textContent = `${entry.source}: ${entry.observation} — ${entry.explanation}`;
          list.append(item);
        }
        details.append(summary, list);
        detailsCell.append(details);
      } else detailsCell.textContent = "—";
      row.append(detailsCell);
      body.append(row);
    }
  }

  function renderDiagnostics(diagnostics) {
    const container = element("sswb-diagnostics");
    container.replaceChildren();
    if (diagnostics.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = viewForCurrentStatus(controller.getViewModel());
      container.append(empty);
      return;
    }
    for (const diagnostic of diagnostics) {
      const item = document.createElement("article");
      item.className = "sswb-diagnostic";
      item.dataset.severity = diagnostic.severity ?? "error";
      const label = document.createElement("strong");
      label.textContent = `${diagnostic.severity ?? "error"}${diagnostic.blocking ? " · blocking" : ""}`;
      const code = document.createElement("code");
      code.textContent = diagnostic.code;
      const reason = document.createElement("span");
      reason.textContent = diagnostic.reason;
      const location = document.createElement("small");
      location.textContent = [diagnostic.table, diagnostic.column, diagnostic.rule].filter(Boolean).join(" · ");
      item.append(label, code, reason, location);
      container.append(item);
    }
  }

  function renderPreview(viewModel) {
    const header = element("sswb-preview-head");
    const body = element("sswb-preview-body");
    header.replaceChildren();
    body.replaceChildren();
    const summary = element("sswb-preview-summary");
    if (viewModel.plan) {
      summary.textContent = `${viewModel.plan.rowCount} rows · seed ${viewModel.plan.seed} · ${viewModel.plan.locale} · ${viewModel.plan.determinismProfile}`;
    } else {
      summary.textContent = viewModel.context ? "等待 GenerationPlan" : "等待有效 TableContext";
    }
    for (const column of viewModel.preview.columns) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column;
      header.append(cell);
    }
    for (const previewRow of viewModel.preview.rows) {
      const row = document.createElement("tr");
      for (const column of viewModel.preview.columns) {
        const cell = document.createElement("td");
        const value = previewRow[column];
        cell.textContent = value === null ? "NULL" : typeof value === "string" ? value : JSON.stringify(value);
        if (value === null) cell.className = "sswb-null";
        row.append(cell);
      }
      body.append(row);
    }
  }

  return () => {
    unsubscribeRender();
    unsubscribeContext();
    root.removeEventListener("change", onControlsChange);
    root.removeEventListener("click", onClick);
  };
}

function statusLabel(viewModel) {
  if (viewModel.status === "loading") return viewModel.stage === "metadata" ? "Loading metadata" : "Generating";
  if (viewModel.status === "ready") return "Ready";
  if (viewModel.status === "warning") return "Warning · preview ready";
  if (viewModel.status === "blocked") return "Blocked";
  return "Error";
}

function stateMessage(viewModel) {
  if (viewModel.status === "loading") return viewModel.stage === "metadata"
    ? "正在通过 DBX Host API 读取当前表 metadata…"
    : "正在构建 GenerationPlan 并生成 preview…";
  if (viewModel.status === "blocked" && viewModel.diagnostics.some((entry) => entry.code === "metadata_capability_unavailable")) {
    return "当前 DBX runtime 未提供 Schema Metadata capability；此表无法生成。";
  }
  if (viewModel.status === "blocked") return viewModel.plan
    ? "GenerationPlan blocked；不会生成或导出 dataset。"
    : "TableContext 无效或 metadata 不可用；请从 DBX Sidebar 表右键重新打开。";
  if (viewModel.status === "error") return viewModel.error ?? "Host API 或 Generation Runtime 请求失败。";
  if (viewModel.status === "warning") return "Preview 已生成，但 Core diagnostics 包含 warning / unsupported facts。";
  return "Preview 与当前 GenerationPlan 对应；Export 将复用相同 dataset。";
}

function viewForCurrentStatus(viewModel) {
  if (viewModel.status === "loading") return "正在加载…";
  if (viewModel.status === "blocked") return "当前 GenerationPlan blocked。";
  if (viewModel.status === "error") return "Host / runtime error。";
  if (viewModel.status === "warning") return "Core 返回 warning；可检查字段级 diagnostics。";
  return "没有 Core diagnostics。";
}

function textCell(text, className) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing Workbench UI element: ${id}`);
  return found;
}
