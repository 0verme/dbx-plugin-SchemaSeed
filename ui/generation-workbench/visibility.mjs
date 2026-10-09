export function renderWorkbenchContextVisibility(root, status) {
  const empty = status === "empty";
  root.querySelector("#sswb-empty-state").hidden = !empty;
  root.querySelector("#sswb-workbench-content").hidden = empty;
  root.querySelector("#sswb-status").hidden = empty;
}
