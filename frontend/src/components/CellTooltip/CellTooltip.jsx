import React, { useEffect, useState } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./CellTooltip.module.css";

export const CellTooltip = () => {
  const hoveredPosition = useTelemetryStore((state) => state.hoveredPosition);
  const cellData = useTelemetryStore((state) => state.hoveredCellData);
  const cells = useTelemetryStore((state) => state.cells);
  const anomalyFlags = useTelemetryStore((state) => state.anomalyFlags);
  const assemblyMap = useTelemetryStore((state) => state.assemblyMap);
  const legacyMap = useTelemetryStore((state) => state.legacyMap) || {};
  const coords = useTelemetryStore((state) => state.tooltipCoords);
  const passportCache = useTelemetryStore((state) => state.passportCache) || {};
  const setPassportCache = useTelemetryStore((state) => state.setPassportCache);

  const [loadingPassport, setLoadingPassport] = useState(false);

  // Read live telemetry reactively for cell measurements
  const liveTelemetry = hoveredPosition && cells[hoveredPosition] ? cells[hoveredPosition] : cellData;
  const batteryCode = (hoveredPosition && assemblyMap[hoveredPosition]) || liveTelemetry?.battery_code;
  const passport = batteryCode ? passportCache[batteryCode] : null;
  const cellAnomalies = hoveredPosition ? anomalyFlags[hoveredPosition] : null;

  // Fetch DCIR & Capacity from Afterlife Intelligence service when battery code is known
  useEffect(() => {
    if (batteryCode && !passportCache[batteryCode]) {
      setLoadingPassport(true);
      api
        .getPassport(batteryCode)
        .then((data) => {
          if (data) {
            setPassportCache(batteryCode, data);
          }
          setLoadingPassport(false);
        })
        .catch(() => {
          setLoadingPassport(false);
        });
    }
  }, [batteryCode, passportCache, setPassportCache]);

  if (!hoveredPosition || !liveTelemetry) return null;

  const legacyCellId =
    liveTelemetry.legacy_cell_id ||
    legacyMap[hoveredPosition] ||
    (batteryCode ? legacyMap[batteryCode] : null) ||
    passport?.legacy_cell_id;

  const displayLegacyId =
    legacyCellId && legacyCellId !== "N/A" && legacyCellId !== "null" && legacyCellId !== "undefined"
      ? String(legacyCellId)
      : "N/A";
  const manufacturer = passport?.manufacturer || passport?.brand;

  const posX = Math.max(145, Math.min(coords.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 150));
  const posY = coords.y;
  const transform = posY < 220 ? "translate(-50%, 20px)" : "translate(-50%, -100%)";

  const healthStatus = liveTelemetry.health_status || "green";
  const healthClass =
    healthStatus === "green"
      ? styles.greenStatus
      : healthStatus === "yellow"
        ? styles.yellowStatus
        : styles.redStatus;

  // Live Telemetry: Voltage
  const voltageVal = liveTelemetry.voltage_v != null ? `${Number(liveTelemetry.voltage_v).toFixed(3)} V` : "— V";
  const cellTempVal =
    liveTelemetry.temperature_c != null
      ? `${Number(liveTelemetry.temperature_c).toFixed(1)} °C`
      : "Awaiting Data";
  const socVal = liveTelemetry.soc_percent != null ? `${Number(liveTelemetry.soc_percent).toFixed(1)} %` : "— %";
  const liveCapacity = liveTelemetry.capacity_ah;
  const liveSoh = liveTelemetry.soh_percent;

  // Afterlife Intelligence: DCIR & Capacity
  const dcirVal =
    passport?.dcir_mohm != null
      ? `${Number(passport.dcir_mohm).toFixed(1)} mΩ`
      : passport?.bench_dcir_mohm != null
        ? `${Number(passport.bench_dcir_mohm).toFixed(1)} mΩ`
        : loadingPassport
          ? "Fetching..."
          : "— mΩ";

  const liveCapacityVal =
    liveCapacity != null
      ? `${Number(liveCapacity).toFixed(2)} Ah`
      : "Awaiting Data";

  const passportCapacityVal =
    passport?.measured_capacity_ah != null
      ? `${Number(passport.measured_capacity_ah).toFixed(2)} Ah`
      : passport?.nominal_capacity_ah != null
        ? `${Number(passport.nominal_capacity_ah).toFixed(2)} Ah`
        : loadingPassport
          ? "Fetching..."
          : "— Ah";

  const sohVal =
    liveSoh != null
      ? `${Number(liveSoh).toFixed(1)} %`
      : "— %";
  const passportSohVal =
    passport?.soh_percent != null
      ? `${Number(passport.soh_percent).toFixed(1)} %`
      : loadingPassport
        ? "Fetching..."
        : "— %";

  return (
    <div
      className={styles.tooltipContainer}
      style={{
        left: `${posX}px`,
        top: `${posY}px`,
        transform,
      }}
    >
      <div className={styles.tooltipHeader}>
        <span className={styles.positionTag}>{hoveredPosition}</span>
        <span className={`${styles.statusBadge} ${healthClass}`}>
          {healthStatus.toUpperCase()}
        </span>
      </div>

      <div className={styles.scopeBadge}>8S Bank Telemetry | Slot {hoveredPosition}</div>

      <div className={styles.batteryCodeRow}>
        <span className={styles.codeLabel}>Battery Code:</span>
        <span className={styles.codeValue}>
          {batteryCode || "Unmapped Slot"}
        </span>
      </div>

      <div className={styles.batteryCodeRow}>
        <span className={styles.codeLabel}>Legacy ID:</span>
        <span className={styles.codeValue}>
          {displayLegacyId}
        </span>
      </div>

      <div className={styles.batteryCodeRow}>
        <span className={styles.codeLabel}>Manufacturer:</span>
        <span className={styles.codeValue}>
          {manufacturer || (loadingPassport ? "Fetching..." : "—")}
        </span>
      </div>

      <div className={`${styles.anomalyAlert} ${cellAnomalies?.length ? "" : styles.noAnomaly}`}>
        <strong>Anomaly report:</strong>
        {cellAnomalies?.length
          ? cellAnomalies.map((anomaly) => <span key={anomaly}>{anomaly}</span>)
          : <span>No active anomalies for this cell.</span>}
      </div>

      <div className={styles.vitalsGrid}>
        {/* Live Telemetry: Voltage */}
        <div className={`${styles.vitalBox} ${liveTelemetry.trigger_metric === "voltage_v" || liveTelemetry.trigger_metric === "voltage_drift" ? styles.vitalTriggered : ""}`}>
          <span className={styles.vitalLabel}>Bank S{liveTelemetry.series || 1} (Live)</span>
          <span className={styles.vitalValue}>{voltageVal}</span>
        </div>

        <div
          className={`${styles.vitalBox} ${liveTelemetry.trigger_metric === "temperature_c" ? styles.vitalTriggered : ""}`}
          title="Live telemetry temperature. The backend currently applies the average NTC probe value to each cell slot."
        >
          <span className={styles.vitalLabel}>Cell Temp</span>
          <span className={styles.vitalValue}>{cellTempVal}</span>
        </div>

        {/* Afterlife Passport: SOH */}
        <div className={styles.vitalBox} title="State of health fetched from the cell passport">
          <span className={styles.vitalLabel}>SOH (Passport)</span>
          <span className={styles.vitalValue}>{passportSohVal}</span>
        </div>

        {/* Live or observer-estimated SOC */}
        <div className={styles.vitalBox}>
          <span className={styles.vitalLabel}>State of Charge (SOC)</span>
          <span className={styles.vitalValue} style={{ color: "#10b981" }}>{socVal}</span>
        </div>

        {/* Afterlife Passport: DCIR */}
        <div className={styles.vitalBox} title="Bench DCIR fetched from Afterlife Intelligence Digital Passport">
          <span className={styles.vitalLabel}>DCIR (Passport)</span>
          <span className={styles.vitalValue} style={{ color: "#38bdf8" }}>{dcirVal}</span>
        </div>

        {/* Observer-estimated SOH */}
        <div className={styles.vitalBox} title="Observer estimate seeded from passport capacity; not a direct BMS measurement">
          <span className={styles.vitalLabel}>SOH (Live Estimate)</span>
          <span className={styles.vitalValue} style={{ color: "#10b981" }}>{sohVal}</span>
        </div>

        {/* Observer-estimated capacity */}
        <div className={styles.vitalBox} title="Observer estimate seeded from passport capacity; not a direct BMS measurement">
          <span className={styles.vitalLabel}>Capacity (Live Estimate)</span>
          <span className={styles.vitalValue} style={{ color: "#38bdf8" }}>
            {liveCapacityVal}
          </span>
        </div>

        {/* Passport capacity */}
        <div className={`${styles.vitalBox} ${styles.vitalBoxFull}`} title="Measured or nominal capacity from the cell passport">
          <span className={styles.vitalLabel}>Capacity (Passport)</span>
          <span className={styles.vitalValue} style={{ color: "#94a3b8" }}>
            {passportCapacityVal}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CellTooltip;
