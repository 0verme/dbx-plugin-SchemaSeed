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
renderWorkbench(viewModel);

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
  const target = event.target.closest("[data-action], [data-confirm-column]");
  if (!target) return;
  if (target.dataset.confirmColumn) {
    void dispatch({ type: "confirm-detected", column: target.dataset.confirmColumn });
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
    renderWorkbench(viewModel);
  } catch (error) {
    viewModel = { ...viewModel, status: "preview_error", error: error.message };
    renderWorkbench(viewModel);
  }
}

async function dispatch(action) {
  if (busy) return;
  busy = true;
  setBusy(true);
  renderWorkbench({ ...viewModel, status: "loading", actionError: null });
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Workbench server returned HTTP ${response.status}`);
    viewModel = result;
    renderWorkbench(viewModel);
  } catch (error) {
    viewModel = { ...viewModel, actionError: error.message };
    renderWorkbench(viewModel);
  } finally {
    busy = false;
    setBusy(false);
  }
}

function setBusy(value) {
  for (const control of document.querySelectorAll("button, input, select")) control.disabled = value;
}

initialize();
