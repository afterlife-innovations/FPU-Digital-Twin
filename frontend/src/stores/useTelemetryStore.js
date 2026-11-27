import { create } from "zustand";

const TELEMETRY_FRESHNESS_MS = 15_000;
const MAX_CLOCK_SKEW_MS = 30_000;

function isTelemetryFresh(timestamp) {
  if (typeof timestamp !== "string") return false;
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return false;

  const ageMs = Date.now() - timestampMs;
  return ageMs <= TELEMETRY_FRESHNESS_MS && ageMs >= -MAX_CLOCK_SKEW_MS;
}

export const useTelemetryStore = create((set, get) => ({
  connected: false,
  packId: "PACK-8S11P-001",
  timestamp: null,
  packVoltage: 0.0,
  packCurrent: 0.0,
  bmsProtocol: "RS485-to-TTL",

  // Phase 2 UI Controls
  viewMode: "3d", // Default to 3D WebGL view (FR-1.4)
  theme: "dark", // "dark" | "light"

  // Alerts
  isAlertsDrawerOpen: false,
  activeAlerts: [],

  // Pack summary
  summary: {
    total_voltage_v: 0.0,
    avg_cell_voltage_v: 0.0,
    min_cell_voltage_v: 0.0,
    max_cell_voltage_v: 0.0,
    voltage_delta_mv: 0.0,
    avg_temperature_c: 0.0,
    pack_current_a: 0.0,
    charging_current_limit_a: null,
    is_charging_limit_exceeded: false,
    green_count: 0,
    yellow_count: 0,
    red_count: 0,
  },

  // Map of position string -> CellTelemetry object
  cells: {},

  // Pack Assembly Map: position -> battery_code
  assemblyMap: {},

  // Legacy Cell ID Map: position -> legacy_cell_id
  legacyMap: {},

  // Selected cell position
  selectedPosition: null,

  // Hovered cell state
  hoveredPosition: null,
  hoveredCellData: null,
  tooltipCoords: { x: 0, y: 0 },

  // Passport Cache from Afterlife Intelligence service
  passportCache: {},
  setPassportCache: (batteryCode, data) =>
    set((state) => ({
      passportCache: { ...state.passportCache, [batteryCode]: data },
    })),

  // UI Modals & Drawers
  isDetailOpen: false,
  isAssemblyOpen: false,
  isGradeInventoryOpen: false,

  // Operations UI Controls
  isReplacementWizardOpen: false,
  replacementPosition: null,
  isMaintenanceHistoryOpen: false,
  isBmsInspectorOpen: false,
  anomalyFlags: {},

  setViewMode: (mode) => set({ viewMode: mode }),
  refreshConnectionStatus: () => set((state) => ({
    connected: isTelemetryFresh(state.timestamp),
  })),


  toggleTheme: () => {
    const nextTheme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", nextTheme);
    set({ theme: nextTheme });
  },

  toggleAlertsDrawer: () => set((state) => ({ isAlertsDrawerOpen: !state.isAlertsDrawerOpen })),
  setActiveAlerts: (alerts) => set({ activeAlerts: alerts }),

  openReplacementWizard: (position) =>
    set({ isReplacementWizardOpen: true, replacementPosition: position }),
  closeReplacementWizard: () =>
    set({ isReplacementWizardOpen: false, replacementPosition: null }),

  setMaintenanceHistoryOpen: (open) => set({ isMaintenanceHistoryOpen: open }),
  setBmsInspectorOpen: (open) => set({ isBmsInspectorOpen: open }),

  updateTelemetry: (payload) => {
    if (!payload || !payload.cells) return;

    const newCells = {};
    const anomalyFlags = payload.anomaly_flags || {};
    const alertTimestamp = payload.timestamp || new Date().toISOString();

    payload.cells.forEach((cell) => {
      newCells[cell.position] = cell;
    });
    const alerts = Object.entries(anomalyFlags).flatMap(([position, breaches]) =>
      breaches.map((message, index) => ({
        id: `${position}-${index}-${alertTimestamp}`,
        severity: message.startsWith("CRITICAL:") ? "critical" : "warning",
        position,
        message: `Cell ${position}: ${message}`,
        timestamp: alertTimestamp,
      }))
    );

    const summary = payload.summary || get().summary;

    // Reactively update hoveredCellData if a cell is currently hovered
    const currentHoveredPos = get().hoveredPosition;
    let nextHoveredData = get().hoveredCellData;
    if (currentHoveredPos && newCells[currentHoveredPos]) {
      const live = newCells[currentHoveredPos];
      const assignedCode = get().assemblyMap[currentHoveredPos];
      const legId = get().legacyMap[currentHoveredPos] || (assignedCode ? get().legacyMap[assignedCode] : null);
      nextHoveredData = {
        ...nextHoveredData,
        ...live,
        battery_code: assignedCode || nextHoveredData?.battery_code,
        legacy_cell_id: legId || nextHoveredData?.legacy_cell_id,
      };
    }

    set({
      connected: isTelemetryFresh(payload.timestamp),
      timestamp: payload.timestamp,
      packId: payload.pack_id || get().packId,
      packVoltage: payload.pack_voltage_v ?? summary?.total_voltage_v ?? get().packVoltage,
      packCurrent: payload.pack_current_a ?? summary?.pack_current_a ?? get().packCurrent,
      bmsProtocol: payload.bms_protocol || "RS485-to-TTL",
      summary,
      cells: newCells,
      hoveredCellData: nextHoveredData,
      activeAlerts: alerts,
      anomalyFlags,
    });
  },

  setAssemblyMap: (mapList) => {
    const mapObj = {};
    const legacyObj = {};
    if (Array.isArray(mapList)) {
      mapList.forEach((slot) => {
        if (slot.battery_code) {
          mapObj[slot.position] = slot.battery_code;
        }
        // Also extract legacy_cell_id if present
        const legacy = slot.legacy_cell_id || slot.legacyCellId || slot.legacy_id || slot.passport_data?.legacy_cell_id;
        if (legacy && legacy !== "null" && legacy !== "undefined" && String(legacy).trim() !== "" && String(legacy).trim() !== "N/A") {
          legacyObj[slot.position] = String(legacy);
          if (slot.battery_code) {
            legacyObj[slot.battery_code] = String(legacy);
          }
        }
      });
    }
    set({ assemblyMap: mapObj, legacyMap: legacyObj });
  },

  updateSlotAssignment: (position, batteryCode, legacyCellId = null) => {
    set((state) => ({
      assemblyMap: {
        ...state.assemblyMap,
        [position]: batteryCode,
      },
      legacyMap: legacyCellId
        ? {
            ...state.legacyMap,
            [position]: String(legacyCellId),
            ...(batteryCode ? { [batteryCode]: String(legacyCellId) } : {}),
          }
        : state.legacyMap,
    }));
  },

  setHoveredCell: (position, cellData, coords) => {
    set({
      hoveredPosition: position,
      hoveredCellData: cellData,
      tooltipCoords: coords || { x: 0, y: 0 },
    });
  },

  clearHoveredCell: () => {
    set({
      hoveredPosition: null,
      hoveredCellData: null,
    });
  },

  setSelectedPosition: (position) => {
    set({ selectedPosition: position, isDetailOpen: !!position });
  },

  closeDetailModal: () => set({ isDetailOpen: false, selectedPosition: null }),
  setAssemblyModalOpen: (open) => set({ isAssemblyOpen: open }),
  setGradeInventoryOpen: (open) => set({ isGradeInventoryOpen: open }),
}));

