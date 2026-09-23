const STATUS_LABELS = {
  loading: "加载中",
  empty: "无 fixture",
  ready: "Ready",
  ready_with_warnings: "Ready · warnings",
  blocked: "Blocked",
  preview_error: "Preview error",
};

const SEMANTIC_LABELS = {
  name: "Name · 姓名",
  gender: "Gender · 性别",
  birthday: "Birthday · 生日",
  mobile: "Mobile · 手机",
  email: "Email · 邮箱",
  address: "Address · 地址",
};

export function renderWorkbench(viewModel) {
  const statusBadge = byId("status-badge");
  statusBadge.textContent = STATUS_LABELS[viewModel.status] ?? viewModel.status;
  statusBadge.dataset.status = viewModel.status;
  byId("workbench").setAttribute("aria-busy", String(viewModel.status === "loading"));

  const hasFixtures = viewModel.fixtures.length > 0;
  byId("empty-state").hidden = viewModel.status !== "empty";
  byId("fatal-state").hidden = !(viewModel.status === "preview_error" && !hasFixtures);
  byId("fatal-message").textContent = viewModel.error ?? "未知错误";
  for (const id of ["context-title", "mapping-title", "person-title", "diagnostics-title", "preview-title"]) {
    byId(id).closest("section").hidden = !hasFixtures;
  }
  if (!hasFixtures) return;

  fillSelect("fixture-select", viewModel.fixtures, viewModel.selectedFixture);
  byId("rows-input").value = String(viewModel.controls.rowCount);
  byId("seed-input").value = viewModel.controls.seed;
  byId("locale-select").value = viewModel.controls.locale;
  byId("table-identity").textContent = viewModel.tableContext?.tableIdentity ?? viewModel.selectedFixture ?? "—";
  byId("action-error").textContent = viewModel.actionError ?? "";
  byId("action-error").hidden = !viewModel.actionError;

  renderMappings(viewModel.columns);
  renderPersonGroups(viewModel.personGroups);
  renderDiagnostics(viewModel.diagnostics, viewModel.information ?? []);
  renderPreview(viewModel);
}

function renderMappings(columns) {
  const body = byId("mapping-rows");
  body.replaceChildren();
  if (columns.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "没有可展示的 schema columns。";
    row.append(cell);
    body.append(row);
    return;
  }

  for (const column of columns) {
    const row = document.createElement("tr");
    row.append(textCell(column.column, "column-name"));
    row.append(textCell(column.schemaType, "schema-type"));
    row.append(textCell(column.detected, "detected-name"));
    const confidence = textCell(column.confidence, "confidence");
    confidence.dataset.confidence = column.confidence;
    row.append(confidence);

    const mappingCell = document.createElement("td");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Mapping for ${column.column}`);
    select.dataset.mappingColumn = column.column;
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "Auto / Fallback";
    select.append(auto);
    for (const [semanticType, label] of Object.entries(SEMANTIC_LABELS)) {
      const option = document.createElement("option");
      option.value = semanticType;
      option.textContent = label;
      select.append(option);
    }
    select.value = column.mappingValue;
    const selected = document.createElement("span");
    selected.className = "mapping-name";
    selected.textContent = column.selectedMapping;
    const controls = document.createElement("div");
    controls.className = "mapping-actions";
    controls.append(select, selected);
    if (column.canConfirm) {
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "link-button";
      confirm.dataset.confirmColumn = column.column;
      confirm.textContent = "Use detected";
      controls.append(confirm);
    }
    mappingCell.append(controls);
    row.append(mappingCell);

    const state = textCell(column.mappingStatus, "mapping-status");
    state.dataset.kind = column.mappingStatus.includes("incompatible") ? "error"
      : column.mappingStatus.startsWith("Confirmed") ? "confirmed"
        : column.mappingStatus.startsWith("Override") ? "override"
          : column.mappingStatus.includes("fallback") ? "warning" : "fallback";
    row.append(state);
    row.append(renderEvidence(column.evidence));
    body.append(row);
  }
}

function renderEvidence(evidence) {
  const cell = document.createElement("td");
  cell.className = "evidence-cell";
  if (evidence.length === 0) {
    cell.textContent = "—";
    return cell;
  }
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Evidence · ${evidence.length}`;
  const list = document.createElement("ul");
  list.className = "evidence-list";
  for (const entry of evidence) {
    const item = document.createElement("li");
    const source = document.createElement("strong");
    source.textContent = `${entry.source}: `;
    item.append(source, document.createTextNode(`${entry.observation} — ${entry.explanation}`));
    list.append(item);
  }
  details.append(summary, list);
  cell.append(details);
  return cell;
}

function renderPersonGroups(groups) {
  const panel = byId("person-panel");
  const container = byId("person-groups");
  container.replaceChildren();
  panel.hidden = groups.length === 0;
  for (const group of groups) {
    const card = document.createElement("article");
    card.className = "person-group";
    const heading = document.createElement("h3");
    const label = document.createElement("span");
    const suffix = group.identity.replace(/^person:/, "");
    label.textContent = `Person · ${suffix}`;
    heading.append(label);
    if (group.status === "partial") {
      const partial = document.createElement("span");
      partial.className = "partial-badge";
      partial.textContent = "⚠ Partial Person group";
      heading.append(partial);
    }
    const members = document.createElement("div");
    members.className = "person-members";
    for (const member of group.members) {
      const tag = document.createElement("span");
      tag.className = "person-member";
      tag.textContent = `${member.role} · ${member.column}`;
      members.append(tag);
    }
    card.append(heading, members);
    container.append(card);
  }
}

function renderDiagnostics(diagnostics, information) {
  const list = byId("diagnostics-list");
  list.replaceChildren();
  const entries = [
    ...information.map((notice) => ({ ...notice, severity: "info", blocking: false, table: null, column: null, rule: null })),
    ...diagnostics,
  ];
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "no-diagnostics";
    empty.textContent = "没有 Core diagnostics。";
    list.append(empty);
    return;
  }
  for (const diagnostic of entries) {
    const item = document.createElement("article");
    item.className = "diagnostic";
    item.dataset.severity = diagnostic.severity;
    const label = document.createElement("span");
    label.className = "diagnostic-label";
    label.textContent = severityLabel(diagnostic);
    const code = document.createElement("code");
    code.className = "diagnostic-code";
    code.textContent = diagnostic.code;
    const reason = document.createElement("span");
    reason.className = "diagnostic-reason";
    reason.textContent = diagnostic.reason;
    const location = document.createElement("span");
    location.className = "diagnostic-location";
    const parts = [diagnostic.table, diagnostic.column, diagnostic.rule].filter(Boolean);
    location.textContent = parts.join(" · ");
    item.append(label, code, reason, location);
    list.append(item);
  }
}

function renderPreview(viewModel) {
  const plan = viewModel.plan;
  const summary = byId("preview-summary");
  const state = byId("preview-state");
  const notice = byId("safe-synthetic-notice");
  const head = byId("preview-columns");
  const body = byId("preview-rows");
  head.replaceChildren();
  body.replaceChildren();
  state.replaceChildren();
  notice.textContent = plan ? `Safe Synthetic · ${viewModel.safeSyntheticNotice}` : "";

  if (viewModel.status === "loading") {
    summary.textContent = "正在构建 GenerationPlan 并生成 preview…";
    state.textContent = "Loading";
    state.dataset.kind = "loading";
    return;
  }
  if (viewModel.status === "preview_error") {
    summary.textContent = "Fixture / preview 加载失败";
    state.dataset.kind = "error";
    const message = document.createElement("span");
    message.textContent = viewModel.error ?? "Preview failed";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button";
    retry.dataset.action = "retry";
    retry.textContent = "重试";
    state.append(message, document.createTextNode(" "), retry);
    return;
  }
  if (!plan) {
    summary.textContent = "等待可用的 GenerationPlan";
    state.textContent = viewModel.status === "empty" ? "没有可用 fixture。" : "Preview blocked。";
    state.dataset.kind = "blocked";
    return;
  }

  summary.textContent = `${plan.rowCount} rows · seed ${plan.seed} · ${plan.locale}`;
  state.textContent = viewModel.status === "blocked"
    ? "Preview blocked：Core plan 标记为 blocking；没有生成 rows。"
    : `GenerationPlan ${plan.status} · ${viewModel.preview.rows.length} rows`;
  state.dataset.kind = viewModel.status === "blocked" ? "blocked" : "ready";
  for (const column of viewModel.preview.columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    head.append(cell);
  }
  for (const previewRow of viewModel.preview.rows) {
    const row = document.createElement("tr");
    for (const column of viewModel.preview.columns) {
      const cell = document.createElement("td");
      const value = previewRow[column];
      if (value === null) {
        cell.textContent = "NULL";
        cell.className = "null-value";
        cell.title = "SQL NULL";
      } else {
        cell.textContent = typeof value === "string" ? value : JSON.stringify(value);
      }
      row.append(cell);
    }
    body.append(row);
  }
}

function fillSelect(id, values, selectedValue) {
  const select = byId(id);
  const optionsSignature = JSON.stringify(values);
  if (select.dataset.options !== optionsSignature) {
    select.replaceChildren();
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    select.dataset.options = optionsSignature;
  }
  if (select.value !== selectedValue) select.value = selectedValue;
}

function textCell(text, className) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function severityLabel(diagnostic) {
  if (diagnostic.severity === "info") return "Info";
  if (diagnostic.severity === "warning") return "Warning";
  if (diagnostic.severity === "unsupported") return "Unsupported";
  return diagnostic.blocking ? "Error · Blocking" : "Error";
}

function byId(id) {
  return document.getElementById(id);
}
