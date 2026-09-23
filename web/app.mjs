import { renderWorkbench } from "./render.mjs";

const root = document.getElementById("workbench");
const controls = document.getElementById("dataset-controls");
let viewModel = {
  status: "loading",
  fixtures: [],
  selectedFixture: null,
  controls: { rowCount: 20, seed: "demo", locale: "zh-CN" },
  columns: [],
  personGroups: [],
  diagnostics: [],
  preview: { columns: [], rows: [] },
  plan: null,
};
let busy = false;
let exportMessage = "";
renderState();

function renderState(nextViewModel = viewModel) {
  renderWorkbench({ ...nextViewModel, exportMessage, exportBusy: busy });
}

controls.addEventListener("submit", (event) => event.preventDefault());
controls.addEventListener("change", (event) => {
  const target = event.target;
  if (target.name === "fixture") {
    void dispatch({ type: "select-fixture", fixture: target.value });
  } else if (["rowCount", "seed", "locale"].includes(target.name)) {
    void dispatch({
      type: "update-controls",
      controls: {
        rowCount: Number(document.getElementById("rows-input").value),
        seed: document.getElementById("seed-input").value,
        locale: document.getElementById("locale-select").value,
      },
    });
  }
});

root.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-mapping-column]")) {
    void dispatch({
      type: "set-mapping",
      column: target.dataset.mappingColumn,
      semanticType: target.value,
    });
  }
});

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action], [data-confirm-column], [data-export-format]");
  if (!target) return;
  if (target.dataset.confirmColumn) {
    void dispatch({ type: "confirm-detected", column: target.dataset.confirmColumn });
    return;
  }
  if (target.dataset.exportFormat) {
    void download(target.dataset.exportFormat);
    return;
  }
  if (target.dataset.action === "regenerate") void dispatch({ type: "regenerate" });
  else if (target.dataset.action === "new-seed") void dispatch({ type: "new-seed" });
  else if (target.dataset.action === "retry") void dispatch({ type: "retry" });
});

async function initialize() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error(`Workbench server returned HTTP ${response.status}`);
    viewModel = await response.json();
    renderState();
  } catch (error) {
    viewModel = { ...viewModel, status: "preview_error", error: error.message };
    renderState();
  }
}

async function dispatch(action) {
  if (busy) return;
  busy = true;
  setBusy(true);
  renderState({ ...viewModel, status: "loading", actionError: null });
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Workbench server returned HTTP ${response.status}`);
    viewModel = result;
    exportMessage = "";
    renderState();
  } catch (error) {
    viewModel = { ...viewModel, actionError: error.message };
    renderState();
  } finally {
    busy = false;
    setBusy(false);
    renderState();
  }
}

async function download(format) {
  if (busy || viewModel.export?.enabled !== true) return;
  busy = true;
  setBusy(true);
  exportMessage = "正在准备下载…";
  renderState();
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format }),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error ?? `Export failed with HTTP ${response.status}`);
      error.code = result.code;
      throw error;
    }

    const blob = new Blob([result.content], { type: result.mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = result.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    exportMessage = `${result.summary.rowCount} rows · ${result.summary.format} · ${result.summary.encoding}`
      + (result.summary.spreadsheetSafe ? " · Spreadsheet-safe" : "");
  } catch (error) {
    exportMessage = `${error.code ?? "export_error"} · ${error.message}`;
  } finally {
    busy = false;
    setBusy(false);
    renderState();
  }
}

function setBusy(value) {
  for (const control of document.querySelectorAll("button, input, select")) control.disabled = value;
}

initialize();
