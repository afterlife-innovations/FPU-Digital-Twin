import React, { useEffect, useState } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./MaintenanceHistoryModal.module.css";

export const MaintenanceHistoryModal = () => {
  const isOpen = useTelemetryStore((state) => state.isMaintenanceHistoryOpen);
  const closeModal = () => useTelemetryStore.getState().setMaintenanceHistoryOpen(false);
  const packId = useTelemetryStore((state) => state.packId);

  const [activeTab, setActiveTab] = useState("swaps"); // "swaps" | "map_versions"
  const [swaps, setSwaps] = useState([]);
  const [mapVersions, setMapVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);

      Promise.all([
        api.getMaintenanceHistory(packId),
        api.getMapHistory(packId),
      ])
        .then(([swapsData, versionsData]) => {
          setSwaps(swapsData || []);
          setMapVersions(versionsData || []);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message || "Failed to load maintenance history");
          setLoading(false);
        });
    }
  }, [isOpen, packId]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={closeModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>PACK MAINTENANCE & MAP HISTORY</h2>
            <span className={styles.subtitle}>Traceability Audit Log for {packId}</span>
          </div>
          <button className={styles.closeBtn} onClick={closeModal}>✕</button>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabNav}>
          <button
            className={`${styles.tabBtn} ${activeTab === "swaps" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("swaps")}
          >
            Cell Replacements ({swaps.length})
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === "map_versions" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("map_versions")}
          >
            Assembly Map Versions ({mapVersions.length})
          </button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loader}>Loading historical audit records...</div>
          ) : error ? (
            <div className={styles.errorBox}>{error}</div>
          ) : activeTab === "swaps" ? (
            swaps.length === 0 ? (
              <div className={styles.emptyState}>No maintenance replacement events recorded yet.</div>
            ) : (
              <div className={styles.timeline}>
                {swaps.map((item) => (
                  <div key={item.id} className={styles.timelineCard}>
                    <div className={styles.cardHeader}>
                      <span className={styles.posBadge}>Position {item.position}</span>
                      <span className={styles.timeTag}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "N/A"}</span>
                    </div>

                    <div className={styles.swapFlow}>
                      <div className={styles.cellBox}>
                        <span className={styles.cellBoxLabel}>Retired Cell</span>
                        <span className={styles.oldCode}>{item.old_battery_code}</span>
                      </div>
                      <span className={styles.arrowIcon}>➔</span>
                      <div className={styles.cellBox}>
                        <span className={styles.cellBoxLabel}>Deployed Cell</span>
                        <span className={styles.newCode}>{item.new_battery_code}</span>
                      </div>
                    </div>

                    <div className={styles.metaRow}>
                      <span>Operator: <strong>{item.operator || "Field Tech"}</strong></span>
                      <span>Reason: <em>{item.reason || "Scheduled swap"}</em></span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : mapVersions.length === 0 ? (
            <div className={styles.emptyState}>No map version history recorded yet.</div>
          ) : (
            <div className={styles.versionList}>
              {mapVersions.map((ver) => (
                <div key={ver.id} className={styles.versionCard}>
                  <div className={styles.versionTop}>
                    <span className={styles.verBadge}>Version #{ver.version_number}</span>
                    <span className={styles.changeType}>{ver.change_type?.toUpperCase()}</span>
                    <span className={styles.timeTag}>{ver.timestamp ? new Date(ver.timestamp).toLocaleString() : "N/A"}</span>
                  </div>
                  {ver.changed_position && (
                    <div className={styles.verDetails}>
                      Target Position Changed: <strong>{ver.changed_position}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MaintenanceHistoryModal;
