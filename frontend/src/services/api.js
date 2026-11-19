import { API_BASE } from "./apiBase";

const API_ORIGIN =
  API_BASE ||
  (typeof window !== "undefined" ? window.location.origin : "the configured API host");

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${url}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach ${API_ORIGIN}${url}: ${reason}`);
  }

  const responseText = await res.text();
  let responseData = null;
  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = null;
    }
  }

  if (!res.ok) {
    let errorMsg = "API Request Failed";
    const detail = responseData?.detail;
    if (typeof detail === "string") {
      errorMsg = detail;
    } else if (Array.isArray(detail)) {
      errorMsg = detail
        .map((d) => {
          if (typeof d === "string") return d;
          const locStr = Array.isArray(d.loc) ? d.loc.filter((x) => x !== "body").join(".") : "";
          return `${locStr ? locStr + ": " : ""}${d.msg || JSON.stringify(d)}`;
        })
        .join("; ");
    } else if (typeof detail === "object" && detail !== null) {
      errorMsg = detail.message || detail.msg || JSON.stringify(detail);
    } else if (responseData?.message) {
      errorMsg = responseData.message;
    } else if (responseText) {
      errorMsg = responseText.replace(/\s+/g, " ").slice(0, 240);
    } else {
      errorMsg = res.statusText || errorMsg;
    }
    throw new Error(`${errorMsg} (HTTP ${res.status} for ${url})`);
  }

  if (!responseText) return null;
  if (responseData === null) {
    throw new Error(`API returned invalid JSON for ${url} (HTTP ${res.status}).`);
  }
  return responseData;
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
