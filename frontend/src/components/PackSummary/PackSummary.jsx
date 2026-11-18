import React from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import styles from "./PackSummary.module.css";

export const PackSummary = () => {
  const summary = useTelemetryStore((state) => state.summary);
  const cells = useTelemetryStore((state) => state.cells);
  const packVoltage = useTelemetryStore((state) => state.packVoltage);
  const packCurrent = useTelemetryStore((state) => state.packCurrent);
  const timestamp = useTelemetryStore((state) => state.timestamp);

  const cellList = Object.values(cells);
  const liveVoltage = packVoltage > 0 ? packVoltage : (summary?.total_voltage_v || 0);
  const liveCurrent = packCurrent !== 0 ? packCurrent : (summary?.pack_current_a || 0);
  const hasLiveData = cellList.length > 0 || liveVoltage > 0 || Boolean(timestamp);

  const greenCount = hasLiveData
    ? cellList.filter((c) => c.health_status === "green").length
    : (summary?.green_count ?? 0);
  const yellowCount = hasLiveData
    ? cellList.filter((c) => c.health_status === "yellow").length
    : (summary?.yellow_count ?? 0);
  const redCount = hasLiveData
    ? cellList.filter((c) => c.health_status === "red").length
    : (summary?.red_count ?? 0);

  const nominalVoltage = 29.6; // 8S × 3.7V nominal

  return (
    <div className={styles.summaryBar}>
      <div className={styles.metricCard}>
        <span className={styles.label}>PACK VOLTAGE</span>
        <div className={styles.valueGroup}>
          {hasLiveData ? (
            <>
              <span className={styles.value}>{liveVoltage.toFixed(2)} V</span>
              <span className={styles.subtext}>
                Nominal 29.6V ({liveVoltage >= nominalVoltage ? "+" : ""}{(liveVoltage - nominalVoltage).toFixed(2)}V)
              </span>
            </>
          ) : (
            <>
              <span className={`${styles.value} ${styles.awaiting}`}>— V</span>
              <span className={styles.awaitingLabel}>AWAITING LIVE DATA</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.metricCard}>
        <span className={styles.label}>PACK CURRENT</span>
        <div className={styles.valueGroup}>
          {hasLiveData ? (
            <>
              <span className={styles.value}>{liveCurrent.toFixed(2)} A</span>
              <span className={styles.subtext}>
                {summary?.operating_mode ? `Mode: ${summary.operating_mode}` : `Power: ${(liveVoltage * liveCurrent).toFixed(1)} W`}
              </span>
            </>
          ) : (
            <>
              <span className={`${styles.value} ${styles.awaiting}`}>— A</span>
              <span className={styles.awaitingLabel}>AWAITING LIVE DATA</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.metricCard}>
        <span className={styles.label}>AVG BANK VOLTAGE (8S)</span>
        <div className={styles.valueGroup}>
          {hasLiveData && summary?.avg_cell_voltage_v != null ? (
            <>
              <span className={styles.value}>{summary.avg_cell_voltage_v.toFixed(3)} V</span>
              <span className={styles.subtext}>
                Min {(summary.min_cell_voltage_v ?? 0).toFixed(3)}V / Max {(summary.max_cell_voltage_v ?? 0).toFixed(3)}V (Δ {(summary.voltage_delta_mv ?? 0)}mV)
              </span>
            </>
          ) : (
            <>
              <span className={`${styles.value} ${styles.awaiting}`}>— V</span>
              <span className={styles.awaitingLabel}>AWAITING LIVE DATA</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.metricCard}>
        <span className={styles.label}>PACK PROBE TEMP</span>
        <div className={styles.valueGroup}>
          {hasLiveData && summary?.avg_temperature_c != null ? (
            <>
              <span className={styles.value}>{summary.avg_temperature_c.toFixed(1)} °C</span>
              <span className={styles.subtext}>NTC Probe Ambient</span>
            </>
          ) : (
            <>
              <span className={`${styles.value} ${styles.awaiting}`}>— °C</span>
              <span className={styles.awaitingLabel}>AWAITING LIVE DATA</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.metricCard}>
        <span className={styles.label}>PACK HEALTH DISTRIBUTION</span>
        <div className={styles.healthBadges}>
          <div className={`${styles.badge} ${styles.badgeGreen}`}>
            <span className={styles.badgeCount}>{greenCount}</span>
            <span className={styles.badgeLabel}>NOMINAL</span>
          </div>
          <div className={`${styles.badge} ${styles.badgeYellow}`}>
            <span className={styles.badgeCount}>{yellowCount}</span>
            <span className={styles.badgeLabel}>WARNING</span>
          </div>
          <div className={`${styles.badge} ${styles.badgeRed}`}>
            <span className={styles.badgeCount}>{redCount}</span>
            <span className={styles.badgeLabel}>CRITICAL</span>
          </div>
        </div>
      </div>
    </div>
  );
};
