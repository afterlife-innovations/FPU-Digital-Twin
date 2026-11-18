import React, { useEffect, useRef, useState } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { API_BASE } from "../../services/apiBase";
import styles from "./BMSFrameInspectorModal.module.css";

const POLL_MS = 2000;
const MAX_HISTORY = 50;
const STALE_AFTER_MS = 10000; // no new data for 10 s => link shown as waiting


const fmt = (v, digits = 3, unit = "") =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "N/A"
    : `${Number(v).toFixed(digits)}${unit}`;

async function fetchLatest() {
  const res = await fetch(`${API_BASE}/telemetry/latest`);
  if (!res.ok) throw new Error(`GET /telemetry/latest returned ${res.status}`);
  return res.json();
}

// Collapse the 88 expanded cells (S1-P1 ... S8-P11) into one row per series bank.
function toBanks(cells = []) {

  const banks = new Map();
  for (const c of cells) {
    if (!banks.has(c.series)) {
      banks.set(c.series, { series: c.series, voltage_v: c.voltage_v, soc_percent: [], parallel: 0 });
    }
    const bank = banks.get(c.series);
    bank.parallel += 1;
    if (c.soc_percent != null) bank.soc_percent.push(Number(c.soc_percent));
  }
  return [...banks.values()]
    .map((bank) => ({
      ...bank,
      soc_percent: bank.soc_percent.length
        ? bank.soc_percent.reduce((sum, value) => sum + value, 0) / bank.soc_percent.length
        : null,
    }))
    .sort((a, b) => a.series - b.series);
}

export const BMSFrameInspectorModal = () => {
  const isOpen = useTelemetryStore((state) => state.isBmsInspectorOpen);
  const closeModal = () => useTelemetryStore.getState().setBmsInspectorOpen(false);

  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const lastStampRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    let cancelled = false;
    setLoading(true);

    const poll = async () => {
      try {
        const data = await fetchLatest();
        if (cancelled) return;

        setLatest(data);
        setError(null);

        // Only add a history row when the backend has a new reading.
        if (data.timestamp && data.timestamp !== lastStampRef.current) {
          lastStampRef.current = data.timestamp;
          setHistory((prev) => [data, ...prev].slice(0, MAX_HISTORY));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load telemetry");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setNow(Date.now());
        }
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const summary = latest?.summary ?? {};
  const banks = toBanks(latest?.cells);
  const socValues = (latest?.cells || [])
    .map((cell) => cell.soc_percent)
    .filter((value) => value != null)
    .map(Number);
  const packSoc = socValues.length
    ? socValues.reduce((sum, value) => sum + value, 0) / socValues.length
    : null;
  const ageMs = latest?.timestamp ? now - new Date(latest.timestamp).getTime() : null;
  const connected = ageMs !== null && ageMs < STALE_AFTER_MS;
  const rawHex = latest?.raw_hex;

  return (
    <div className={styles.overlay} onClick={closeModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>BMS protocol forensics and raw frame inspector</h2>
            <span className={styles.subtitle}>
              Live readings from GET /telemetry/latest, refreshed every {POLL_MS / 1000} s
            </span>
          </div>
          <button className={styles.closeBtn} onClick={closeModal} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Link status */}
        <div className={styles.statusBanner}>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Link state:</span>
            <span className={connected ? styles.statusOnline : styles.statusWaiting}>
              {connected ? "● Connected" : "○ Waiting for live data"}
            </span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Protocol:</span>
            <span className={styles.protoBadge}>{latest?.bms_protocol || "N/A"}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Last frame:</span>
            <span className={styles.statusVal}>
              {latest?.timestamp ? new Date(latest.timestamp).toLocaleTimeString() : "N/A"}
              {ageMs !== null ? ` (${Math.round(ageMs / 1000)} s ago)` : ""}
            </span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Pack:</span>
            <span className={styles.statusVal}>{latest?.pack_id || "N/A"}</span>
          </div>
        </div>

        {/* Pack summary */}
        <div className={styles.statusBanner}>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Voltage:</span>
            <span className={styles.statusVal}>{fmt(latest?.pack_voltage_v, 3, " V")}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Current:</span>
            <span className={styles.statusVal}>{fmt(latest?.pack_current_a, 3, " A")}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>SOC:</span>
            <span className={styles.statusVal}>{packSoc != null ? fmt(packSoc, 1, " %") : "N/A"}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Power:</span>
            <span className={styles.statusVal}>{fmt(summary.pack_power_w, 1, " W")}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Cell min / max:</span>
            <span className={styles.statusVal}>
              {fmt(summary.min_cell_voltage_v)} / {fmt(summary.max_cell_voltage_v)} V
            </span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Delta:</span>
            <span className={styles.statusVal}>{fmt(summary.voltage_delta_mv, 0, " mV")}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Avg temp:</span>
            <span className={styles.statusVal}>{fmt(summary.avg_temperature_c, 1, " °C")}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Mode:</span>
            <span className={styles.statusVal}>{summary.operating_mode || "N/A"}</span>
          </div>
        </div>

        <div className={styles.streamContainer}>
          {loading && !latest ? (
            <div className={styles.loader}>Loading latest telemetry...</div>
          ) : error && !latest ? (
            <div className={styles.errorBox}>
              {error}. Check that the backend is running on {API_BASE} and allows requests from this page.
            </div>
          ) : !latest ? (
            <div className={styles.emptyState}>
              No telemetry received yet. Waiting for the ESP32 to post a frame.
            </div>
          ) : (
            <>
              {error && <div className={styles.errorBox}>{error}. Showing the last good reading.</div>}

              {/* Per-bank voltages */}
              <table className={styles.frameTable}>
                <thead>
                  <tr>
                    <th>Series bank</th>
                    <th>Voltage (V)</th>
                    <th>Voltage (mV)</th>
                    <th>SOC (%)</th>
                    <th>Cells in parallel</th>
                  </tr>
                </thead>
                <tbody>
                  {banks.map((b) => (
                    <tr key={b.series}>
                      <td className={styles.typeCol}>S{b.series}</td>
                      <td>{fmt(b.voltage_v)}</td>
                      <td>{Math.round(b.voltage_v * 1000)}</td>
                      <td>{b.soc_percent != null ? fmt(b.soc_percent, 1, " %") : "N/A"}</td>
                      <td>{b.parallel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Raw frame, shown only if the backend returns one */}
              {rawHex && (
                <table className={styles.frameTable}>
                  <thead>
                    <tr>
                      <th>Frame type</th>
                      <th>Raw payload (hex)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={styles.typeCol}>{latest.frame_type || "telemetry"}</td>
                      <td className={styles.hexCol}>{rawHex}</td>
                    </tr>
                  </tbody>
                </table>
              )}

              {/* Reading history */}
              <table className={styles.frameTable}>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Protocol</th>
                    <th>Pack V</th>
                    <th>Current</th>
                    <th>SOC</th>
                    <th>Delta</th>
                    <th>Avg temp</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.timestamp}>
                      <td className={styles.timeCol}>
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </td>
                      <td>
                        <span className={styles.rs485Badge}>{h.bms_protocol || "RS485"}</span>
                      </td>
                      <td>{fmt(h.pack_voltage_v, 3, " V")}</td>
                      <td>{fmt(h.pack_current_a, 3, " A")}</td>
                      <td>{(() => {
                        const values = (h.cells || []).map((cell) => cell.soc_percent).filter((value) => value != null);
                        return values.length ? fmt(values.reduce((sum, value) => sum + Number(value), 0) / values.length, 1, " %") : "N/A";
                      })()}</td>
                      <td>{fmt(h.summary?.voltage_delta_mv, 0, " mV")}</td>
                      <td>{fmt(h.summary?.avg_temperature_c, 1, " °C")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BMSFrameInspectorModal;