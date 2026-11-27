import React, { useEffect } from "react";
import { Header } from "./components/Header/Header";
import { PackSummary } from "./components/PackSummary/PackSummary";
import { PackGrid } from "./components/PackGrid/PackGrid";
import { CellTooltip } from "./components/CellTooltip/CellTooltip";
import { CellDetailModal } from "./components/CellDetail/CellDetailModal";
import { CellReplacementWizard } from "./components/CellDetail/CellReplacementWizard";
import { AssemblyMapModal } from "./components/AssemblyMap/AssemblyMapModal";
import { CellGradesModal } from "./components/CellGrades/CellGradesModal";
import { MaintenanceHistoryModal } from "./components/Maintenance/MaintenanceHistoryModal";
import { BMSFrameInspectorModal } from "./components/BMS/BMSFrameInspectorModal";
import { AlertsDrawer } from "./components/Alerts/AlertsDrawer";
import { socket } from "./services/socket";
import { api } from "./services/api";
import { useTelemetryStore } from "./stores/useTelemetryStore";
import styles from "./App.module.css";

export function App() {
  const updateTelemetry = useTelemetryStore((state) => state.updateTelemetry);
  const packId = useTelemetryStore((state) => state.packId);

  useEffect(() => {
    // Initial fetch of Pack Assembly Map
    api
      .getAssemblyMap(packId)
      .then((mapList) => {
        useTelemetryStore.getState().setAssemblyMap(mapList);
      })
      .catch((err) => console.error("Initial map fetch error:", err));

    // Fallback REST fetch & active sync polling
    const fetchLatestTelemetry = () => {
      api
        .getLatestTelemetry()
        .then((payload) => updateTelemetry(payload))
        .catch(() => useTelemetryStore.getState().refreshConnectionStatus());
    };

    fetchLatestTelemetry();
    // Continuous polling ensures telemetry stays updated even if WebSocket is delayed or disconnected
    const pollInterval = setInterval(fetchLatestTelemetry, 1500);

    // Socket.IO real-time event listeners
    const handleConnect = () => {
      fetchLatestTelemetry();
    };

    const handleTelemetry = (data) => {
      updateTelemetry(data);
    };

    socket.on("connect", handleConnect);
    socket.on("telemetry", handleTelemetry);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      clearInterval(pollInterval);
      socket.off("connect", handleConnect);
      socket.off("telemetry", handleTelemetry);
    };
  }, [packId, updateTelemetry]);

  return (
    <div className={styles.appContainer}>
      <Header />
      <PackSummary />
      <main className={styles.mainContent}>
        <PackGrid />
      </main>
      <CellTooltip />
      <CellDetailModal />
      <CellReplacementWizard />
      <AssemblyMapModal />
      <CellGradesModal />
      <MaintenanceHistoryModal />
      <BMSFrameInspectorModal />
      <AlertsDrawer />
    </div>
  );
}

export default App;

