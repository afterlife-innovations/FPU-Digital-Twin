import { API_BASE } from "./apiBase";

async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    let errorMsg = "API Request Failed";
    if (typeof errorData.detail === "string") {
      errorMsg = errorData.detail;
    } else if (Array.isArray(errorData.detail)) {
      errorMsg = errorData.detail
        .map((d) => {
          if (typeof d === "string") return d;
          const locStr = Array.isArray(d.loc) ? d.loc.filter((x) => x !== "body").join(".") : "";
          return `${locStr ? locStr + ": " : ""}${d.msg || JSON.stringify(d)}`;
        })
        .join("; ");
    } else if (typeof errorData.detail === "object" && errorData.detail !== null) {
      errorMsg = errorData.detail.message || errorData.detail.msg || JSON.stringify(errorData.detail);
    } else if (errorData.message) {
      errorMsg = errorData.message;
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

export const api = {
  // Telemetry REST Fallback & History
  getLatestTelemetry: () => request("/telemetry/latest"),
  getCellHistory: (position, window = "1h") => request(`/telemetry/history/${position}?window=${window}`),
  getThresholds: () => request("/telemetry/config/thresholds"),
  configureObserverCellMetrics: (packId, cells) =>
    request("/telemetry/observer/cell-metrics", {
      method: "POST",
      body: JSON.stringify({ pack_id: packId, cells }),
    }),

  // Pack Assembly Map
  getAssemblyMap: (packId = "PACK-8S11P-001") => request(`/pack/${packId}/map`),
  getAssemblyProgress: (packId = "PACK-8S11P-001") => request(`/pack/${packId}/progress`),

  // Assign cell to position
  // 🔗 AFTERLIFE API: Validates battery code against Afterlife Intelligence inventory
  assignCell: (packId, series, parallel, batteryCode) =>
    request(`/pack/${packId}/map`, {
      method: "POST",
      body: JSON.stringify({ series, parallel, battery_code: batteryCode }),
    }),

  // Bulk import mapping
  // 🔗 AFTERLIFE API: Validates batch codes against inventory
  bulkAssign: (packId, mappings) =>
    request(`/pack/${packId}/map/bulk`, {
      method: "POST",
      body: JSON.stringify({ mappings }),
    }),

  // 🔗 AFTERLIFE API: Matches cells from inventory against pack build tolerances
  matchPack: (matchParams) =>
    request(`/pack/match`, {
      method: "POST",
      body: JSON.stringify(matchParams),
    }),

  // 🔗 AFTERLIFE API: Retrieves pack sessions created in Afterlife Pack Builder
  getPackSessions: () => request("/pack/afterlife/sessions"),

  // 🔗 AFTERLIFE API: Retrieves specific pack session with cell assignments in their respective positions
  getPackSession: (sessionId) => request(`/pack/afterlife/sessions/${sessionId}`),

  unassignCell: (packId, series, parallel) =>
    request(`/pack/${packId}/map/S${series}-P${parallel}`, {
      method: "DELETE",
    }),
  clearPackAssignments: (packId) =>
    request(`/pack/${packId}/map`, {
      method: "DELETE",
    }),

  // Afterlife Intelligence Platform Passports Proxy
  // 🔗 AFTERLIFE API: Retrieves full inventory with grade distribution, manufacturer, legacy ID & codes
  getGradesInventory: (forceRefresh = false) =>
    request(`/passport/inventory/grades?refresh=${forceRefresh}`),

  // 🔗 AFTERLIFE API: Searches passports by code, legacy ID, chemistry, or source
  searchPassports: (query) =>
    request(`/passport/search?q=${encodeURIComponent(query)}`),

  // 🔗 AFTERLIFE API: Lists registered battery passports
  listPassports: (page = 1, pageSize = 50) =>
    request(`/passport/list?page=${page}&page_size=${pageSize}`),

  // 🔗 AFTERLIFE API: Gets detailed passport for a cell
  getPassport: (batteryCode) =>
    request(`/passport/${encodeURIComponent(batteryCode)}`),

  // 🔗 AFTERLIFE API: Gets test history for a cell
  getPassportTests: (batteryCode) =>
    request(`/passport/${encodeURIComponent(batteryCode)}/tests`),

  // --- Phase 3 Operations Endpoints ---
  getReplacementCandidates: (position, packId = "PACK-8S11P-001") =>
    request(`/pack/${packId}/replacements/${position}`),

  executeCellSwap: (swapPayload, packId = "PACK-8S11P-001") =>
    request(`/pack/${packId}/replace-cell`, {
      method: "POST",
      body: JSON.stringify(swapPayload),
    }),

  getMaintenanceHistory: (packId = "PACK-8S11P-001") =>
    request(`/pack/${packId}/maintenance`),

  getMapHistory: (packId = "PACK-8S11P-001") =>
    request(`/pack/${packId}/map/history`),

  getBMSStatus: () => request("/bms/status"),

  getBMSFrames: (limit = 50, protocol = null) => {
    const q = protocol ? `?limit=${limit}&protocol=${protocol}` : `?limit=${limit}`;
    return request(`/bms/frames${q}`);
  },

  getAnomalies: () => request("/telemetry/anomalies"),

  exportTelemetryUrl: (format = "csv") => `${API_BASE}/telemetry/export?format=${format}`,

  acknowledgeAlert: (alertId, note) =>
    request(`/alerts/${alertId}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  snoozeAlert: (alertId, minutes = 15) =>
    request(`/alerts/${alertId}/snooze`, {
      method: "POST",
      body: JSON.stringify({ duration_minutes: minutes }),
    }),

  getAlertHistory: () => request("/alerts/history"),

  getNotificationChannels: () => request("/alerts/channels"),

  saveNotificationChannels: (channels) =>
    request("/alerts/channels", {
      method: "POST",
      body: JSON.stringify(channels),
    }),
};
