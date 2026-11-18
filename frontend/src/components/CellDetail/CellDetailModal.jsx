import React, { useEffect, useState } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./CellDetailModal.module.css";

export const CellDetailModal = () => {
  const isOpen = useTelemetryStore((state) => state.isDetailOpen);
  const position = useTelemetryStore((state) => state.selectedPosition);
  const closeModal = useTelemetryStore((state) => state.closeDetailModal);
  const cells = useTelemetryStore((state) => state.cells);
  const assemblyMap = useTelemetryStore((state) => state.assemblyMap);
  const anomalyFlags = useTelemetryStore((state) => state.anomalyFlags);
  const openReplacementWizard = useTelemetryStore((state) => state.openReplacementWizard);
  const updateTelemetry = useTelemetryStore((state) => state.updateTelemetry);
  const passportCache = useTelemetryStore((state) => state.passportCache) || {};
  const setPassportCache = useTelemetryStore((state) => state.setPassportCache);

  const [passport, setPassport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeWindow, setTimeWindow] = useState("1h"); // "1h" | "24h" | "7d" | "30d" | "all"
  const [historyData, setHistoryData] = useState([]);

  // Live telemetry for this cell position
  const cellTelemetry = position ? cells[position] : null;
  const batteryCode = position ? assemblyMap[position] : null;
  const cellAnomalies = position ? anomalyFlags[position] : null;

  // 1. Fetch live telemetry snapshot & historical data on modal open or position change
  useEffect(() => {
    if (isOpen && position) {
      // Actively fetch fresh live telemetry from backend
      api
        .getLatestTelemetry()
        .then((payload) => {
          if (payload) updateTelemetry(payload);
        })
        .catch(() => {});

      // Fetch actual historical telemetry from backend
      api
        .getCellHistory(position, timeWindow)
        .then((res) => {
          if (res?.datapoints && res.datapoints.length > 0) {
            setHistoryData(
              res.datapoints.map((d, idx) => ({
                time: d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : `${idx}s`,
                voltage: Number(d.voltage_v || 3.7),
                temp: Number(d.temperature_c || 25.0),
                dcir: Number(d.dcir_mohm || 30.0),
                soh: Number(d.soh_percent || 100.0),
              }))
            );
          } else {
            // If historical buffer is small, use current live values as seed points
            const currentV = cellTelemetry?.voltage_v ?? 3.7;
            const currentT = cellTelemetry?.temperature_c ?? 25.0;
            const seedPoints = Array.from({ length: 10 }, (_, i) => ({
              time: `${(10 - i) * 5}s ago`,
              voltage: currentV,
              temp: currentT,
              dcir: 30.0,
              soh: 100.0,
            }));
            setHistoryData(seedPoints);
          }
        })
        .catch(() => {
          const currentV = cellTelemetry?.voltage_v ?? 3.7;
          const currentT = cellTelemetry?.temperature_c ?? 25.0;
          setHistoryData([{ time: "now", voltage: currentV, temp: currentT, dcir: 30.0, soh: 100.0 }]);
        });
    }
  }, [isOpen, position, timeWindow, updateTelemetry]);

  // 2. Fetch Afterlife Intelligence Digital Passport for DCIR & Capacity
  useEffect(() => {
    if (isOpen && batteryCode) {
      if (passportCache[batteryCode]) {
        setPassport(passportCache[batteryCode]);
        return;
      }
      setLoading(true);
      setError(null);
      api
        .getPassport(batteryCode)
        .then((data) => {
          setPassport(data);
          setPassportCache(batteryCode, data);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message || "Failed to load passport from Afterlife API");
          setLoading(false);
        });
    } else {
      setPassport(null);
    }
  }, [isOpen, batteryCode, passportCache, setPassportCache]);

  if (!isOpen || !position) return null;

  const seriesNum = cellTelemetry?.series || (position.match(/S(\d+)/) ? Number(position.match(/S(\d+)/)[1]) : 1);
  const liveVoltage = cellTelemetry?.voltage_v != null ? `${cellTelemetry.voltage_v.toFixed(3)} V` : "Awaiting Data";
  const liveCellTemp = cellTelemetry?.temperature_c != null
    ? `${Number(cellTelemetry.temperature_c).toFixed(1)} °C`
    : "Awaiting Data";
  const liveSoc = cellTelemetry?.soc_percent != null ? `${Number(cellTelemetry.soc_percent).toFixed(1)} %` : "Awaiting Data";
  const liveSoh = cellTelemetry?.soh_percent != null
    ? `${Number(cellTelemetry.soh_percent).toFixed(1)} %`
    : "Awaiting Data";
  const passportSoh =
    passport?.soh_percent != null
      ? `${Number(passport.soh_percent).toFixed(1)} %`
      : loading
        ? "Fetching..."
        : "Awaiting Data";
  const liveCapacity = cellTelemetry?.capacity_ah;

  // DCIR & Capacity fetched from Afterlife Intelligence service
  const passportDcir =
    passport?.dcir_mohm != null
      ? `${Number(passport.dcir_mohm).toFixed(1)} mΩ`
      : passport?.bench_dcir_mohm != null
        ? `${Number(passport.bench_dcir_mohm).toFixed(1)} mΩ`
        : loading
          ? "Fetching..."
          : "N/A (Passport)";

  const liveCapacityValue =
    liveCapacity != null
      ? `${Number(liveCapacity).toFixed(2)} Ah`
      : "Awaiting Data";

  const passportCapacity =
    passport?.measured_capacity_ah != null
      ? `${Number(passport.measured_capacity_ah).toFixed(2)} Ah`
      : passport?.nominal_capacity_ah != null
        ? `${Number(passport.nominal_capacity_ah).toFixed(2)} Ah`
        : loading
          ? "Fetching..."
          : "N/A (Passport)";

  return (
    <div className={styles.overlay} onClick={closeModal}>
      <div className={styles.sidePanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>CELL DIAGNOSTICS & PASSPORT</h2>
            <span className={styles.subtitle}>Slot Position: {position}</span>
          </div>
          <button className={styles.closeBtn} onClick={closeModal}>✕</button>
        </div>

        <div className={styles.content}>
          <div className={`${styles.anomalyBox} ${cellAnomalies?.length ? "" : styles.noAnomaly}`}>
            {cellAnomalies?.length ? (
              <>
                ⚠️ <strong>Cell Anomaly Report:</strong>
                <ul>
                  {cellAnomalies.map((anomaly) => <li key={anomaly}>{anomaly}</li>)}
                </ul>
              </>
            ) : (
              <>
                <strong>Cell Anomaly Report:</strong>
                <div>No active anomalies for this cell.</div>
              </>
            )}
          </div>

          {/* Quick Cell Replacement Action Button */}
          <div className={styles.swapBar}>
            <button
              className={styles.swapActionBtn}
              onClick={() => {
                closeModal();
                openReplacementWizard(position);
              }}
            >
              Cell Replacement
            </button>
          </div>

          {/* Live BMS Telemetry */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>LIVE BMS TELEMETRY (8S Bank Monitored)</h3>
            <div className={styles.bankNotice}>
               <strong>8S Bank Telemetry:</strong> Voltage ({liveVoltage}) is measured across parallel bank S{seriesNum} (11 cells in parallel). Physical cell ID and passport capacity are tracked for O&M slot replacement.
            </div>
            <div className={styles.grid}>
              <div className={styles.infoBox}>
                <span className={styles.infoLabel}>Series Bank Voltage (Live)</span>
                <span className={styles.infoValue} style={{ color: "#38bdf8" }}>{liveVoltage}</span>
              </div>
              <div className={styles.infoBox} title="Live telemetry temperature. The backend currently applies the average NTC probe value to each cell slot.">
                <span className={styles.infoLabel}>Cell Temp</span>
                <span className={styles.infoValue} style={{ color: "#fbbf24" }}>{liveCellTemp}</span>
              </div>
              <div className={styles.infoBox} title="State of health fetched from the cell passport">
                <span className={styles.infoLabel}>SOH (Passport)</span>
                <span className={styles.infoValue} style={{ color: "#10b981" }}>{passportSoh}</span>
              </div>
              <div className={styles.infoBox}>
                <span className={styles.infoLabel}>State of Charge (SOC)</span>
                <span className={styles.infoValue} style={{ color: "#10b981" }}>{liveSoc}</span>
              </div>
              <div className={styles.infoBox} title="Bench internal resistance fetched from Afterlife Intelligence Digital Passport">
                <span className={styles.infoLabel}>DCIR (Passport)</span>
                <span className={styles.infoValue}>{passportDcir}</span>
              </div>
              <div className={styles.infoBox} title="Observer estimate seeded from passport capacity; not a direct BMS measurement">
                <span className={styles.infoLabel}>SOH (Live Estimate)</span>
                <span className={styles.infoValue} style={{ color: "#10b981" }}>{liveSoh}</span>
              </div>
              <div className={styles.infoBox} title="Observer estimate seeded from passport capacity; not a direct BMS measurement">
                <span className={styles.infoLabel}>Capacity (Live Estimate)</span>
                <span className={styles.infoValue}>
                  {liveCapacityValue}
                </span>
              </div>
              <div className={styles.infoBox} title="Measured or nominal capacity fetched from the cell passport">
                <span className={styles.infoLabel}>Capacity (Passport)</span>
                <span className={styles.infoValue}>
                  {passportCapacity}
                </span>
              </div>
            </div>
          </div>

          {/* Historical Time-Series Analytics (FR-8.2) */}
          <div className={styles.card}>
            <div className={styles.chartHeader}>
              <h3 className={styles.cardTitle}>HISTORICAL TIME-SERIES TRENDS</h3>
              <div className={styles.windowGroup}>
                {["1h", "24h", "7d", "30d", "all"].map((w) => (
                  <button
                    key={w}
                    className={`${styles.windowBtn} ${timeWindow === w ? styles.windowActive : ""}`}
                    onClick={() => setTimeWindow(w)}
                  >
                    {w.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Voltage & Temp Sparkline Visualization */}
            <div className={styles.chartWrapper}>
              <span className={styles.chartLabel}>Voltage (V) over time window ({timeWindow})</span>
              <svg viewBox="0 0 400 80" className={styles.sparkline}>
                {historyData.length > 1 ? (
                  <polyline
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="3"
                    points={historyData
                      .map((d, idx) => {
                        const x = (idx / (historyData.length - 1)) * 380 + 10;
                        const clampedV = Math.max(2.5, Math.min(4.3, d.voltage));
                        const y = 75 - ((clampedV - 2.5) / 1.8) * 65;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                  />
                ) : (
                  <text x="200" y="45" fill="#64748b" textAnchor="middle" fontSize="12">
                    Awaiting live time-series points...
                  </text>
                )}
              </svg>
            </div>

            <div className={styles.chartWrapper}>
              <span className={styles.chartLabel}>Temperature (°C) over time window ({timeWindow})</span>
              <svg viewBox="0 0 400 80" className={styles.sparkline}>
                {historyData.length > 1 ? (
                  <polyline
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="3"
                    points={historyData
                      .map((d, idx) => {
                        const x = (idx / (historyData.length - 1)) * 380 + 10;
                        const clampedT = Math.max(15, Math.min(65, d.temp));
                        const y = 75 - ((clampedT - 15) / 50) * 65;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                  />
                ) : (
                  <text x="200" y="45" fill="#64748b" textAnchor="middle" fontSize="12">
                    Awaiting live time-series points...
                  </text>
                )}
              </svg>
            </div>
          </div>

          {/* Afterlife Intelligence Digital Passport */}
          <div className={styles.card}>
            <div className={styles.passportHeader}>
              <h3 className={styles.cardTitle}>AFTERLIFE DIGITAL PASSPORT</h3>
              <span className={styles.apiTag}>🔗 AFTERLIFE API</span>
            </div>

            {batteryCode ? (
              loading ? (
                <div className={styles.loader}>Fetching passport from Afterlife Intelligence...</div>
              ) : error ? (
                <div className={styles.errorBox}>{error}</div>
              ) : passport ? (
                <div className={styles.passportDetails}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Battery Code</span>
                    <span className={styles.detailValueHighlight}>{passport.battery_code}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Legacy Cell ID</span>
                    <span className={styles.detailValue}>{passport.legacy_cell_id || "N/A"}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Chemistry</span>
                    <span className={styles.detailValue}>{passport.chemistry || "Li-ion"}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Form Factor</span>
                    <span className={styles.detailValue}>{passport.form_factor || "18650"}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Nominal Capacity</span>
                    <span className={styles.detailValue}>
                      {passport.nominal_capacity_ah != null
                        ? String(passport.nominal_capacity_ah).includes("Ah")
                          ? passport.nominal_capacity_ah
                          : `${passport.nominal_capacity_ah} Ah`
                        : passport.nominal_capacity != null
                        ? String(passport.nominal_capacity).includes("Ah")
                          ? passport.nominal_capacity
                          : `${passport.nominal_capacity} Ah`
                        : "N/A"}
                    </span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Measured Capacity</span>
                    <span className={styles.detailValue}>
                      {passport.measured_capacity_ah != null
                        ? String(passport.measured_capacity_ah).includes("Ah")
                          ? passport.measured_capacity_ah
                          : `${Number(passport.measured_capacity_ah).toFixed(2)} Ah`
                        : passport.derived_metrics?.measured_capacity_ah != null
                        ? `${Number(passport.derived_metrics.measured_capacity_ah).toFixed(2)} Ah`
                        : "Untested"}
                    </span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Intake Date</span>
                    <span className={styles.detailValue}>{passport.intake_date || "N/A"}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Intake OCV</span>
                    <span className={styles.detailValue}>
                      {passport.intake_ocv_v ? `${passport.intake_ocv_v} V` : "N/A"}
                    </span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Bench DCIR</span>
                    <span className={styles.detailValue}>
                      {passport.dcir_mohm ? `${passport.dcir_mohm} mΩ` : passport.bench_dcir_mohm ? `${passport.bench_dcir_mohm} mΩ` : "N/A"}
                    </span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Intake Source</span>
                    <span className={styles.detailValue}>{passport.source || "N/A"}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Lifecycle State</span>
                    <span className={styles.stateBadge}>{passport.current_state || "intake"}</span>
                  </div>
                </div>
              ) : null
            ) : (
              <div className={styles.unmappedAlert}>
                ⚠️ Position {position} is currently unmapped in the Pack Assembly Map. Use the Pack Assembly Map manager to assign a cell battery code.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CellDetailModal;
