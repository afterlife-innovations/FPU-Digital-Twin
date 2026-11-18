import React from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./Header.module.css";

export const Header = () => {
  const connected = useTelemetryStore((state) => state.connected);
  const packId = useTelemetryStore((state) => state.packId);
  const bmsProtocol = useTelemetryStore((state) => state.bmsProtocol);
  const theme = useTelemetryStore((state) => state.theme);
  const toggleTheme = useTelemetryStore((state) => state.toggleTheme);
  const activeAlerts = useTelemetryStore((state) => state.activeAlerts) || [];
  const setAssemblyModalOpen = useTelemetryStore((state) => state.setAssemblyModalOpen);
  const setGradeInventoryOpen = useTelemetryStore((state) => state.setGradeInventoryOpen);
  const setMaintenanceHistoryOpen = useTelemetryStore((state) => state.setMaintenanceHistoryOpen);
  const setBmsInspectorOpen = useTelemetryStore((state) => state.setBmsInspectorOpen);
  const toggleAlertsDrawer = useTelemetryStore((state) => state.toggleAlertsDrawer);

  const handleExportData = (format) => {
    const url = api.exportTelemetryUrl(format);
    window.open(url, "_blank");
  };

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <div className={styles.logoBadge}>AI</div>
        <div>
          <h1 className={styles.title}>AFTERLIFE INTELLIGENCE</h1>
          <span className={styles.subtitle}>8S11P Battery Pack Digital Twin</span>
        </div>
      </div>

      <div className={styles.centerSection}>
        <span className={styles.packTag}>{packId}</span>
        <span
          className={styles.protocolTag}
          onClick={() => setBmsInspectorOpen(true)}
          style={{ cursor: "pointer" }}
          title="Click to open BMS RS485 Forensics Inspector"
        >
          <span className={styles.protocolDot} />
          BMS: {bmsProtocol}
        </span>
      </div>

      <div className={styles.rightSection}>
        {/* Export Data Button */}
        <button
          className={styles.themeBtn}
          onClick={() => handleExportData("csv")}
          title="Export Pack Telemetry History as CSV"
        >
          CSV Export
        </button>

        {/* Maintenance Log Button */}
        <button
          className={styles.themeBtn}
          onClick={() => setMaintenanceHistoryOpen(true)}
          title="View Pack Maintenance Swap Log & Map Versions"
        >
          Maintenance Log
        </button>


        <button
          className={styles.themeBtn}
          onClick={toggleTheme}
          title="Toggle Light/Dark Theme"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>

        <button
          className={`${styles.alertsBtn} ${activeAlerts.length > 0 ? styles.alertsActive : ""}`}
          onClick={toggleAlertsDrawer}
          title="View Real-Time Alerts & Thresholds"
        >
          Alerts {activeAlerts.length > 0 && <span className={styles.alertBadge}>{activeAlerts.length}</span>}
        </button>

        {/* Cell Grades Explorer Button */}
        <button
          className={styles.themeBtn}
          onClick={() => setGradeInventoryOpen(true)}
          style={{ background: "rgba(59, 130, 246, 0.15)", borderColor: "rgba(59, 130, 246, 0.4)", color: "#93c5fd" }}
          title="Explore Cell Grades, Manufacturers, Legacy IDs and Passports from Afterlife API"
        >
          Cell Grades
        </button>

        <button
          className={styles.assemblyBtn}
          onClick={() => setAssemblyModalOpen(true)}
        >
          Assembly Map
        </button>

        <div className={styles.statusIndicator}>
          <span className={`${styles.dot} ${connected ? styles.dotConnected : styles.dotDisconnected}`} />
          <span className={styles.statusText}>{connected ? "BMS LINK ACTIVE" : "CONNECTING..."}</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
