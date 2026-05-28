const state = {
  sessionId: null,
  devices: [],
  deviceFilter: "switches",
  selectedDevices: new Set(),
  interfaces: [],
  selectedInterfaces: new Set(),
  currentRows: [],
};

const fields = [
  ["_deviceName", "Device"],
  ["_devicePlatform", "Platform"],
  ["_portName", "Port"],
  ["interfaceType", "Type"],
  ["adminStatus", "Admin"],
  ["status", "Status"],
  ["vlanId", "VLAN"],
  ["nativeVlanId", "Native VLAN"],
  ["speed", "Speed"],
  ["duplex", "Duplex"],
  ["macAddress", "MAC"],
  ["description", "Description"],
  ["portMode", "Port Mode"],
  ["portType", "Port Type"],
  ["ipv4Address", "IPv4"],
  ["serialNo", "Serial"],
];

const els = {
  hostInput: document.querySelector("#hostInput"),
  userInput: document.querySelector("#userInput"),
  passwordInput: document.querySelector("#passwordInput"),
  verifyTlsInput: document.querySelector("#verifyTlsInput"),
  connectBtn: document.querySelector("#connectBtn"),
  connectionState: document.querySelector("#connectionState"),
  workflowSteps: [...document.querySelectorAll(".workflow-stepper span")],
  deviceCount: document.querySelector("#deviceCount"),
  deviceFilter: document.querySelector("#deviceFilter"),
  deviceSearch: document.querySelector("#deviceSearch"),
  deviceList: document.querySelector("#deviceList"),
  selectAllDevicesBtn: document.querySelector("#selectAllDevicesBtn"),
  clearDevicesBtn: document.querySelector("#clearDevicesBtn"),
  loadInterfacesBtn: document.querySelector("#loadInterfacesBtn"),
  refreshInterfacesBtn: document.querySelector("#refreshInterfacesBtn"),
  metricActions: [...document.querySelectorAll(".metric-action")],
  totalMetric: document.querySelector("#totalMetric"),
  upMetric: document.querySelector("#upMetric"),
  downMetric: document.querySelector("#downMetric"),
  selectedMetric: document.querySelector("#selectedMetric"),
  totalPercentMetric: document.querySelector("#totalPercentMetric"),
  upPercentMetric: document.querySelector("#upPercentMetric"),
  downPercentMetric: document.querySelector("#downPercentMetric"),
  selectedPercentMetric: document.querySelector("#selectedPercentMetric"),
  portMapSubtitle: document.querySelector("#portMapSubtitle"),
  statusUpSegment: document.querySelector("#statusUpSegment"),
  statusDownSegment: document.querySelector("#statusDownSegment"),
  statusOtherSegment: document.querySelector("#statusOtherSegment"),
  portMap: document.querySelector("#portMap"),
  interfaceSearch: document.querySelector("#interfaceSearch"),
  statusFilter: document.querySelector("#statusFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  vlanFilter: document.querySelector("#vlanFilter"),
  selectedOnlyFilter: document.querySelector("#selectedOnlyFilter"),
  selectVisibleBtn: document.querySelector("#selectVisibleBtn"),
  clearInterfacesBtn: document.querySelector("#clearInterfacesBtn"),
  tableSubtitle: document.querySelector("#tableSubtitle"),
  visibleCount: document.querySelector("#visibleCount"),
  interfaceTable: document.querySelector("#interfaceTable"),
  reportScope: document.querySelector("#reportScope"),
  reportScopeCount: document.querySelector("#reportScopeCount"),
  reportPanel: document.querySelector("#reportPanel"),
  reportHint: document.querySelector("#reportHint"),
  reportTitle: document.querySelector("#reportTitle"),
  reportFormat: document.querySelector("#reportFormat"),
  includeSummary: document.querySelector("#includeSummary"),
  fieldList: document.querySelector("#fieldList"),
  downloadReportBtn: document.querySelector("#downloadReportBtn"),
  downloadReportBtnTop: document.querySelector("#downloadReportBtnTop"),
  detailDrawer: document.querySelector("#detailDrawer"),
  closeDrawerBtn: document.querySelector("#closeDrawerBtn"),
  drawerDevice: document.querySelector("#drawerDevice"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerStatus: document.querySelector("#drawerStatus"),
  drawerBody: document.querySelector("#drawerBody"),
  toast: document.querySelector("#toast"),
};

async function api(path, body = null) {
  const options = body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    : {};
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  }
  return data;
}

function setConnectionState(label, mode = "idle") {
  els.connectionState.textContent = label;
  els.connectionState.className = `state-dot ${mode}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function textValue(row, key) {
  const value = row[key];
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function speedLabel(value) {
  if (!value || Number.isNaN(Number(value))) return textValue({ value }, "value");
  const mbps = Number(value) / 1000;
  if (mbps >= 1000) return `${mbps / 1000} Gbps`;
  return `${Math.round(mbps)} Mbps`;
}

function statusClass(value) {
  const status = String(value || "").toLowerCase();
  if (status === "up") return "status-up";
  if (status === "down") return "status-down";
  return "status-other";
}

function selectedFields() {
  return [...els.fieldList.querySelectorAll("input:checked")].map((input) => input.value);
}

function isSwitch(device) {
  return [device.family, device.platformId, device.hostname]
    .join(" ")
    .toLowerCase()
    .includes("switch");
}

function isWireless(device) {
  const text = [device.family, device.platformId, device.hostname].join(" ").toLowerCase();
  return text.includes("wireless") || text.includes("ap") || text.includes("c9800");
}

function filteredDevices() {
  const query = els.deviceSearch.value.trim().toLowerCase();
  return state.devices.filter((device) => {
    if (state.deviceFilter === "switches" && !isSwitch(device)) return false;
    if (state.deviceFilter === "wireless" && !isWireless(device)) return false;
    if (!query) return true;
    return [device.hostname, device.platformId, device.family, device.managementIpAddress]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function statusTotals(rows = state.interfaces) {
  const up = rows.filter((row) => String(row.status || "").toLowerCase() === "up").length;
  const down = rows.filter((row) => String(row.status || "").toLowerCase() === "down").length;
  return { up, down, other: Math.max(rows.length - up - down, 0) };
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function updateWorkflow() {
  const steps = {
    connect: Boolean(state.sessionId),
    select: state.selectedDevices.size > 0,
    load: state.interfaces.length > 0,
    report: reportRows().length > 0,
  };
  let activeAssigned = false;
  els.workflowSteps.forEach((step) => {
    const key = step.dataset.step;
    step.classList.toggle("complete", steps[key]);
    const isActive = !steps[key] && !activeAssigned;
    step.classList.toggle("active", isActive);
    if (isActive) activeAssigned = true;
  });
}

function updateReportPanel() {
  const rows = reportRows();
  const hasInterfaces = state.interfaces.length > 0;
  els.reportPanel.classList.toggle("is-empty", !hasInterfaces);
  els.reportHint.textContent = hasInterfaces
    ? `${rows.length} interface${rows.length === 1 ? "" : "s"} in this report scope.`
    : "Load interfaces to build a custom report.";
  els.reportScopeCount.textContent = `${rows.length} rows`;
}

async function loadDefaults() {
  const defaults = await api("/api/defaults");
  els.hostInput.value = defaults.host;
  els.userInput.value = defaults.username;
  els.passwordInput.value = defaults.password;
}

async function connect() {
  setConnectionState("Connecting", "busy");
  els.connectBtn.disabled = true;
  try {
    const data = await api("/api/connect", {
      host: els.hostInput.value.trim(),
      username: els.userInput.value.trim(),
      password: els.passwordInput.value,
      verifyTls: els.verifyTlsInput.checked,
    });
    state.sessionId = data.sessionId;
    state.devices = data.devices;
    state.selectedDevices.clear();
    state.interfaces = [];
    state.selectedInterfaces.clear();
    setConnectionState("Connected", "online");
    showToast(`Connected to ${data.host}; ${data.devices.length} devices found.`);
    renderDevices();
    renderInterfaces();
  } catch (error) {
    setConnectionState("Error", "error");
    showToast(error.message);
  } finally {
    els.connectBtn.disabled = false;
  }
}

function renderDevices() {
  const devices = filteredDevices();

  els.deviceCount.textContent = state.devices.length ? `${devices.length}/${state.devices.length}` : "0";
  els.deviceFilter.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.deviceFilter);
  });
  els.selectAllDevicesBtn.disabled = devices.length === 0;
  els.clearDevicesBtn.disabled = state.selectedDevices.size === 0;
  els.loadInterfacesBtn.disabled = !state.sessionId || state.selectedDevices.size === 0;
  els.loadInterfacesBtn.textContent = state.selectedDevices.size
    ? `Load Interfaces (${state.selectedDevices.size})`
    : "Load Interfaces";

  if (!devices.length) {
    els.deviceList.className = "device-list empty-state";
    els.deviceList.textContent = state.devices.length ? "No devices match this view." : "Connect to see devices.";
    updateWorkflow();
    return;
  }

  els.deviceList.className = "device-list";
  els.deviceList.innerHTML = devices
    .map(
      (device) => `
        <label class="device-row ${state.selectedDevices.has(device.id) ? "is-selected" : ""}" data-device-id="${escapeHtml(device.id)}">
          <input type="checkbox" ${state.selectedDevices.has(device.id) ? "checked" : ""} />
          <div>
            <div class="device-name">${escapeHtml(device.hostname)}</div>
            <div class="device-meta">
              <span>${escapeHtml(device.platformId)}</span>
              <span>${escapeHtml(device.family)}</span>
              <span>${escapeHtml(device.managementIpAddress)}</span>
            </div>
          </div>
        </label>`
    )
    .join("");
  updateWorkflow();
}

async function loadInterfaces() {
  if (!state.selectedDevices.size) {
    showToast("Select at least one device first.");
    return;
  }
  els.loadInterfacesBtn.disabled = true;
  els.refreshInterfacesBtn.disabled = true;
  showToast("Loading interfaces...");
  try {
    const data = await api("/api/interfaces", {
      sessionId: state.sessionId,
      deviceIds: [...state.selectedDevices],
      includeDetail: false,
    });
    state.interfaces = data.results.flatMap((result) => result.interfaces);
    state.selectedInterfaces.clear();
    if (data.errors.length) {
      showToast(`${data.errors.length} device request failed; loaded the rest.`);
    } else {
      showToast(`Loaded ${state.interfaces.length} interfaces.`);
    }
    renderInterfaces();
  } catch (error) {
    showToast(error.message);
  } finally {
    els.loadInterfacesBtn.disabled = state.selectedDevices.size === 0;
    els.refreshInterfacesBtn.disabled = state.interfaces.length === 0;
    updateWorkflow();
  }
}

function filteredRows() {
  const query = els.interfaceSearch.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  const type = els.typeFilter.value;
  const vlan = els.vlanFilter.value.trim();
  return state.interfaces.filter((row) => {
    if (els.selectedOnlyFilter.checked && !state.selectedInterfaces.has(row._key)) return false;
    if (status !== "all" && String(row.status || "").toLowerCase() !== status) return false;
    if (type !== "all" && String(row.interfaceType || "") !== type) return false;
    if (vlan && String(row.vlanId || "") !== vlan) return false;
    if (!query) return true;
    return [
      row._deviceName,
      row._devicePlatform,
      row._portName,
      row.interfaceType,
      row.status,
      row.adminStatus,
      row.vlanId,
      row.macAddress,
      row.description,
      row.portMode,
      row.portType,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function renderInterfaces() {
  const rows = filteredRows();
  state.currentRows = rows;

  const { up, down, other } = statusTotals();
  els.totalMetric.textContent = state.interfaces.length;
  els.upMetric.textContent = up;
  els.downMetric.textContent = down;
  els.selectedMetric.textContent = state.selectedInterfaces.size;
  els.totalPercentMetric.textContent = state.interfaces.length ? "100% loaded" : "No data";
  els.upPercentMetric.textContent = `${percent(up, state.interfaces.length)}% on`;
  els.downPercentMetric.textContent = `${percent(down, state.interfaces.length)}% off`;
  els.selectedPercentMetric.textContent = `${percent(state.selectedInterfaces.size, state.interfaces.length)}% selected`;
  els.visibleCount.textContent = `${rows.length} visible`;
  els.tableSubtitle.textContent = state.interfaces.length
    ? `${state.selectedDevices.size} device(s), ${state.interfaces.length} loaded interfaces.`
    : "Load a device to see interface details.";

  els.refreshInterfacesBtn.disabled = state.selectedDevices.size === 0;
  els.selectVisibleBtn.disabled = rows.length === 0;
  els.clearInterfacesBtn.disabled = state.selectedInterfaces.size === 0;
  els.downloadReportBtn.disabled = reportRows().length === 0;
  els.downloadReportBtnTop.disabled = reportRows().length === 0;
  updateMetricActions();
  updateStatusDistribution(up, down, other);
  renderPortMap(rows);
  updateReportPanel();
  updateWorkflow();

  if (!rows.length) {
    els.interfaceTable.innerHTML = `<tr><td colspan="9" class="empty-cell">${
      state.interfaces.length ? "No interfaces match the current filters." : "No interfaces loaded."
    }</td></tr>`;
    return;
  }

  els.interfaceTable.innerHTML = rows
    .map(
      (row) => `
        <tr data-key="${escapeHtml(row._key)}">
          <td><input type="checkbox" ${state.selectedInterfaces.has(row._key) ? "checked" : ""} /></td>
          <td class="port-cell">${escapeHtml(row._portName)}</td>
          <td>${escapeHtml(row._deviceName)}<div class="muted">${escapeHtml(row._devicePlatform)}</div></td>
          <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(textValue(row, "status"))}</span></td>
          <td>${escapeHtml(textValue(row, "adminStatus"))}</td>
          <td>${escapeHtml(textValue(row, "vlanId"))}</td>
          <td>${escapeHtml(speedLabel(row.speed))}</td>
          <td>${escapeHtml(textValue(row, "duplex"))}</td>
          <td>${escapeHtml(textValue(row, "description"))}</td>
        </tr>`
    )
    .join("");
}

function updateStatusDistribution(up, down, other) {
  const total = Math.max(up + down + other, 1);
  els.statusUpSegment.style.width = `${(up / total) * 100}%`;
  els.statusDownSegment.style.width = `${(down / total) * 100}%`;
  els.statusOtherSegment.style.width = `${(other / total) * 100}%`;
}

function renderPortMap(rows) {
  if (!state.interfaces.length) {
    els.portMapSubtitle.textContent = "Ports appear here after interfaces load.";
    els.portMap.className = "port-map empty-state";
    els.portMap.textContent = "Load interfaces to see a visual port map.";
    return;
  }
  if (!rows.length) {
    els.portMapSubtitle.textContent = "No ports match the current filters.";
    els.portMap.className = "port-map empty-state";
    els.portMap.textContent = "Adjust filters to bring ports back into view.";
    return;
  }

  const { up, down, other } = statusTotals(rows);
  els.portMapSubtitle.textContent = `${rows.length} visible ports · ${up} up (${percent(up, rows.length)}%) · ${down} down (${percent(down, rows.length)}%) · ${other} other`;
  els.portMap.className = "port-map";
  const groups = new Map();
  rows.forEach((row) => {
    const deviceName = row._deviceName || "Unknown device";
    if (!groups.has(deviceName)) groups.set(deviceName, []);
    groups.get(deviceName).push(row);
  });

  els.portMap.innerHTML = [...groups.entries()]
    .map(([deviceName, deviceRows]) => {
      const stats = statusTotals(deviceRows);
      const platform = deviceRows[0]?._devicePlatform || "-";
      const tiles = deviceRows
        .map((row) => {
          const selected = state.selectedInterfaces.has(row._key);
          return `
            <button class="port-tile ${statusClass(row.status)} ${selected ? "is-selected" : ""}" type="button" data-key="${escapeHtml(row._key)}" title="${escapeHtml(row._deviceName)} · ${escapeHtml(row._portName)} · ${escapeHtml(textValue(row, "status"))}">
              <span>${escapeHtml(shortPortName(row._portName))}</span>
            </button>`;
        })
        .join("");
      return `
        <section class="port-group">
          <div class="port-group-head">
            <div>
              <strong>${escapeHtml(deviceName)}</strong>
              <span>${escapeHtml(platform)}</span>
            </div>
            <small>${deviceRows.length} ports · ${stats.up} up (${percent(stats.up, deviceRows.length)}%) · ${stats.down} down (${percent(stats.down, deviceRows.length)}%)</small>
          </div>
          <div class="port-grid">${tiles}</div>
        </section>`;
    })
    .join("");
}

function updateMetricActions() {
  els.metricActions.forEach((button) => {
    const filter = button.dataset.metricFilter;
    const active =
      (filter === "all" && els.statusFilter.value === "all" && !els.selectedOnlyFilter.checked) ||
      (filter === "up" && els.statusFilter.value === "up" && !els.selectedOnlyFilter.checked) ||
      (filter === "down" && els.statusFilter.value === "down" && !els.selectedOnlyFilter.checked) ||
      (filter === "selected" && els.selectedOnlyFilter.checked);
    button.classList.toggle("is-active", active);
  });
}

function shortPortName(portName) {
  return String(portName || "-")
    .replace("AppGigabitEthernet", "AppGi")
    .replace("FortyGigabitEthernet", "Fo")
    .replace("TwentyFiveGigE", "Twe")
    .replace("TenGigabitEthernet", "Te")
    .replace("GigabitEthernet", "Gi");
}

function renderFieldList() {
  els.fieldList.innerHTML = fields
    .map(
      ([key, label], index) => `
        <label>
          <input type="checkbox" value="${key}" ${index < 12 ? "checked" : ""} />
          <span>${label}</span>
        </label>`
    )
    .join("");
}

function reportRows() {
  const scope = els.reportScope.value;
  if (scope === "all") return state.interfaces;
  if (scope === "visible") return state.currentRows;
  return state.interfaces.filter((row) => state.selectedInterfaces.has(row._key));
}

function downloadReport() {
  const rows = reportRows();
  if (!rows.length) {
    showToast("No rows in this report scope.");
    return;
  }
  const keys = selectedFields();
  if (!keys.length) {
    showToast("Select at least one report field.");
    return;
  }
  const title = els.reportTitle.value.trim() || "Catalyst Center Interface Report";
  const format = els.reportFormat.value;
  const timestamp = new Date();
  let content;
  let mime;
  let extension;
  if (format === "csv") {
    content = buildCsv(rows, keys);
    mime = "text/csv";
    extension = "csv";
  } else if (format === "json") {
    content = JSON.stringify(
      {
        title,
        generatedAt: timestamp.toISOString(),
        rows: rows.map((row) => pickFields(row, keys)),
      },
      null,
      2
    );
    mime = "application/json";
    extension = "json";
  } else {
    content = buildHtmlReport(title, rows, keys, timestamp);
    mime = "text/html";
    extension = "html";
  }
  const filename = `${slug(title)}-${timestamp.toISOString().slice(0, 10)}.${extension}`;
  download(filename, content, mime);
  showToast(`Downloaded ${filename}`);
}

function pickFields(row, keys) {
  return Object.fromEntries(keys.map((key) => [key, key === "speed" ? speedLabel(row[key]) : row[key] ?? ""]));
}

function buildCsv(rows, keys) {
  const labels = keys.map((key) => fields.find((field) => field[0] === key)?.[1] || key);
  const lines = [labels.map(csvEscape).join(",")];
  rows.forEach((row) => {
    lines.push(keys.map((key) => csvEscape(key === "speed" ? speedLabel(row[key]) : row[key] ?? "")).join(","));
  });
  return lines.join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function buildHtmlReport(title, rows, keys, timestamp) {
  const labels = keys.map((key) => fields.find((field) => field[0] === key)?.[1] || key);
  const byDevice = new Map();
  rows.forEach((row) => {
    const device = row._deviceName || "Unknown device";
    byDevice.set(device, (byDevice.get(device) || 0) + 1);
  });
  const up = rows.filter((row) => String(row.status || "").toLowerCase() === "up").length;
  const down = rows.filter((row) => String(row.status || "").toLowerCase() === "down").length;
  const summary = els.includeSummary.checked
    ? `<section class="summary">
        <div><span>Total interfaces</span><strong>${rows.length}</strong></div>
        <div><span>Up</span><strong>${up}</strong></div>
        <div><span>Down</span><strong>${down}</strong></div>
        <div><span>Devices</span><strong>${byDevice.size}</strong></div>
      </section>`
    : "";
  const tableRows = rows
    .map(
      (row) => `<tr>${keys
        .map((key) => `<td>${escapeHtml(key === "speed" ? speedLabel(row[key]) : row[key] ?? "")}</td>`)
        .join("")}</tr>`
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:36px;color:#1d1d1f;background:#fff}h1{font-size:30px;margin:0 0 6px}.meta{color:#6e6e73;margin-bottom:24px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.summary div{border:1px solid #e8e8ed;border-radius:8px;padding:14px}.summary span{display:block;color:#6e6e73;font-size:12px;font-weight:800;text-transform:uppercase}.summary strong{font-size:28px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 8px;border-bottom:1px solid #e8e8ed;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#6e6e73;background:#fbfbfd}@media print{body{margin:18px}.summary{break-inside:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">Generated ${escapeHtml(timestamp.toLocaleString())} · ${rows.length} interfaces · ${byDevice.size} devices</div>
${summary}
<table><thead><tr>${labels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table>
</body></html>`;
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "report";
}

function openDrawer(row) {
  els.drawerDevice.textContent = row._deviceName || "Device";
  els.drawerTitle.textContent = row._portName || "Interface";
  els.drawerStatus.innerHTML = `
    <span class="status-pill ${statusClass(row.status)}">${escapeHtml(textValue(row, "status"))}</span>
    <span class="count-pill">Admin ${escapeHtml(textValue(row, "adminStatus"))}</span>
    <span class="count-pill">VLAN ${escapeHtml(textValue(row, "vlanId"))}</span>
  `;
  const priority = [
    "description",
    "interfaceType",
    "portMode",
    "portType",
    "speed",
    "duplex",
    "macAddress",
    "nativeVlanId",
    "ipv4Address",
    "serialNo",
    "pid",
    "series",
    "ifIndex",
    "mtu",
    "lastInput",
    "lastOutput",
  ];
  const keys = [...new Set([...priority, ...Object.keys(row).filter((key) => !key.startsWith("_"))])];
  els.drawerBody.innerHTML = keys
    .filter((key) => row[key] !== undefined && row[key] !== null && row[key] !== "")
    .map((key) => `<div class="kv"><span>${escapeHtml(key)}</span><span>${escapeHtml(key === "speed" ? speedLabel(row[key]) : row[key])}</span></div>`)
    .join("");
  els.detailDrawer.classList.add("open");
  els.detailDrawer.setAttribute("aria-hidden", "false");
}

function bindEvents() {
  els.connectBtn.addEventListener("click", connect);
  els.metricActions.forEach((button) => {
    button.addEventListener("click", () => applyMetricFilter(button.dataset.metricFilter));
  });
  els.deviceFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.deviceFilter = button.dataset.filter;
    renderDevices();
  });
  els.deviceSearch.addEventListener("input", renderDevices);
  els.deviceList.addEventListener("change", (event) => {
    const row = event.target.closest(".device-row");
    if (!row) return;
    const id = row.dataset.deviceId;
    if (event.target.checked) state.selectedDevices.add(id);
    else state.selectedDevices.delete(id);
    renderDevices();
  });
  els.selectAllDevicesBtn.addEventListener("click", () => {
    filteredDevices().forEach((device) => state.selectedDevices.add(device.id));
    renderDevices();
  });
  els.clearDevicesBtn.addEventListener("click", () => {
    state.selectedDevices.clear();
    renderDevices();
  });
  els.loadInterfacesBtn.addEventListener("click", loadInterfaces);
  els.refreshInterfacesBtn.addEventListener("click", loadInterfaces);
  [els.interfaceSearch, els.statusFilter, els.typeFilter, els.vlanFilter, els.selectedOnlyFilter, els.reportScope].forEach((el) =>
    el.addEventListener("input", renderInterfaces)
  );
  els.selectVisibleBtn.addEventListener("click", () => {
    state.currentRows.forEach((row) => state.selectedInterfaces.add(row._key));
    renderInterfaces();
  });
  els.clearInterfacesBtn.addEventListener("click", () => {
    state.selectedInterfaces.clear();
    renderInterfaces();
  });
  els.interfaceTable.addEventListener("change", (event) => {
    if (event.target.type !== "checkbox") return;
    const rowElement = event.target.closest("tr");
    const key = rowElement?.dataset.key;
    if (!key) return;
    if (event.target.checked) state.selectedInterfaces.add(key);
    else state.selectedInterfaces.delete(key);
    renderInterfaces();
  });
  els.interfaceTable.addEventListener("click", (event) => {
    if (event.target.type === "checkbox") return;
    const rowElement = event.target.closest("tr[data-key]");
    if (!rowElement) return;
    const row = state.interfaces.find((item) => item._key === rowElement.dataset.key);
    if (row) openDrawer(row);
  });
  els.portMap.addEventListener("click", (event) => {
    const tile = event.target.closest(".port-tile");
    if (!tile) return;
    const row = state.interfaces.find((item) => item._key === tile.dataset.key);
    if (!row) return;
    if (state.selectedInterfaces.has(row._key)) state.selectedInterfaces.delete(row._key);
    else state.selectedInterfaces.add(row._key);
    openDrawer(row);
    renderInterfaces();
  });
  els.closeDrawerBtn.addEventListener("click", () => {
    els.detailDrawer.classList.remove("open");
    els.detailDrawer.setAttribute("aria-hidden", "true");
  });
  els.downloadReportBtn.addEventListener("click", downloadReport);
  els.downloadReportBtnTop.addEventListener("click", downloadReport);
  els.fieldList.addEventListener("change", renderInterfaces);
}

function applyMetricFilter(filter) {
  if (filter === "selected") {
    els.selectedOnlyFilter.checked = true;
    els.statusFilter.value = "all";
  } else {
    els.selectedOnlyFilter.checked = false;
    els.statusFilter.value = filter === "all" ? "all" : filter;
  }
  renderInterfaces();
}

renderFieldList();
bindEvents();
renderDevices();
renderInterfaces();
loadDefaults().catch(() => null);