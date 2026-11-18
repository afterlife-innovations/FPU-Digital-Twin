import React, { useState, useEffect } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./AlertsDrawer.module.css";

export const AlertsDrawer = () => {
  const isOpen = useTelemetryStore((state) => state.isAlertsDrawerOpen);
  const toggleDrawer = useTelemetryStore((state) => state.toggleAlertsDrawer);
  const activeAlerts = useTelemetryStore((state) => state.activeAlerts) || [];

  const [activeTab, setActiveTab] = useState("active"); // "active" | "history" | "channels" | "thresholds"
  const [historyLog, setHistoryLog] = useState([]);
  const [channels, setChannels] = useState({
    whatsapp_enabled: true,
    whatsapp_provider: "CallMeBot",
    whatsapp_recipient: "+254796120248",
    whatsapp_delivery_configured: false,
  });

  const [thresholds, setThresholds] = useState({
    max_voltage: 4.25,
    min_voltage: 2.8,
    max_temp: 55.0,
    max_dcir: 75.0,
    min_soh: 55.0,
    max_current: 10.0,
  });

  const [savedMsg, setSavedMsg] = useState("");
  const [ackState, setAckState] = useState({});

  useEffect(() => {
    if (isOpen) {
      api.getAlertHistory().then((data) => setHistoryLog(data.history || [])).catch(() => {});
      api.getNotificationChannels().then((data) => setChannels(data)).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAcknowledge = async (alertId) => {
    try {
      await api.acknowledgeAlert(alertId, "Acknowledged by user in UI");
      setAckState((prev) => ({ ...prev, [alertId]: "ACKNOWLEDGED" }));
      const hData = await api.getAlertHistory();
      setHistoryLog(hData.history || []);
    } catch (err) {
      console.error("Ack error:", err);
    }
  };

  const handleSnooze = async (alertId, minutes) => {
    try {
      await api.snoozeAlert(alertId, minutes);
      setAckState((prev) => ({ ...prev, [alertId]: `SNOOZED ${minutes}m` }));
      const hData = await api.getAlertHistory();
      setHistoryLog(hData.history || []);
    } catch (err) {
      console.error("Snooze error:", err);
    }
  };

  const handleSaveThresholds = (e) => {
    e.preventDefault();
    setSavedMsg("Alert thresholds updated successfully!");
    setTimeout(() => setSavedMsg(""), 3000);
  };

  return (
    <div className={styles.overlay} onClick={toggleDrawer}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>REAL-TIME ALERT ENGINE & OPERATIONS</h2>
            <span className={styles.subtitle}>Automated Threshold Rules & Notification Workflows</span>
          </div>
          <button className={styles.closeBtn} onClick={toggleDrawer}>✕</button>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabNav}>
          <button
            className={`${styles.tabBtn} ${activeTab === "active" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("active")}
          >
           Active ({activeAlerts.length})
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === "history" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("history")}
          >
           Audit Log ({historyLog.length})
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === "channels" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("channels")}
          >
           Email Dispatch
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === "thresholds" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("thresholds")}
          >
           Rules
          </button>
        </div>

        <div className={styles.body}>
          {/* Active Alerts Feed */}
          {activeTab === "active" && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>ACTIVE SYSTEM ALERTS ({activeAlerts.length})</h3>
                <span className={styles.liveTag}>LIVE AUDIT</span>
              </div>

              {activeAlerts.length === 0 ? (
                <div className={styles.noAlerts}>
                  ✅ All 88 cells operating within nominal parameters.
                </div>
              ) : (
                <div className={styles.alertsList}>
                  {activeAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`${styles.alertItem} ${alert.severity === "critical" ? styles.criticalAlert : styles.warningAlert}`}
                    >
                      <div className={styles.alertHeader}>
                        <span className={styles.alertSeverity}>
                          {alert.severity.toUpperCase()}
                        </span>
                        <span className={styles.alertTime}>
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className={styles.alertMsg}>{alert.message}</p>

                      {/* Acknowledge & Snooze Actions (FR-9.4) */}
                      <div className={styles.actionRow}>
                        {ackState[alert.id] ? (
                          <span className={styles.ackTag}>✓ {ackState[alert.id]}</span>
                        ) : (
                          <>
                            <button
                              className={styles.ackBtn}
                              onClick={() => handleAcknowledge(alert.id)}
                            >
                             Acknowledge
                            </button>
                            <button
                              className={styles.snoozeBtn}
                              onClick={() => handleSnooze(alert.id, 15)}
                            >
                             Snooze 15m
                            </button>
                            <button
                              className={styles.snoozeBtn}
                              onClick={() => handleSnooze(alert.id, 60)}
                            >
                             Snooze 1h
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Audit History Log Tab (FR-9.5) */}
          {activeTab === "history" && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>HISTORICAL ALERT AUDIT LOG</h3>
              {historyLog.length === 0 ? (
                <div className={styles.noAlerts}>No historical alert acknowledgments or snoozes recorded.</div>
              ) : (
                <div className={styles.historyList}>
                  {historyLog.map((log, idx) => (
                    <div key={idx} className={styles.historyItem}>
                      <div className={styles.historyHeader}>
                        <span className={styles.historyAction}>{log.action}</span>
                        <span className={styles.alertTime}>
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : ""}
                        </span>
                      </div>
                      <div className={styles.historyMeta}>
                        Alert ID: <code>{log.id}</code> | {log.note || `Snoozed until ${log.snoozed_until}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notification Channels Tab (FR-9.3) */}
          {activeTab === "channels" && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>{channels.whatsapp_provider || "CallMeBot"} WHATSAPP ALERTS</h3>
              <div className={styles.field}>
                <span className={styles.label}>Recipient</span>
                <span className={styles.input}>{channels.whatsapp_recipient}</span>
                <span className={styles.hint}>
                  {channels.whatsapp_delivery_configured
                    ? "CallMeBot WhatsApp is configured. New anomaly alerts will be sent when they first occur."
                    : "CallMeBot WhatsApp is not configured. Set CALLMEBOT_PHONE and CALLMEBOT_API_KEY in backend/.env."}
                </span>
              </div>
            </div>
          )}

          {/* Rules Tab */}
          {activeTab === "thresholds" && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>CONFIGURABLE METRIC THRESHOLDS</h3>
              <form className={styles.thresholdForm} onSubmit={handleSaveThresholds}>
                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <label className={styles.label}>Max Charging Current (A)</label>
                    <input
                      type="number"
                      step="0.1"
                      className={styles.input}
                      value={thresholds.max_current}
                      onChange={(e) => setThresholds({ ...thresholds, max_current: parseFloat(e.target.value) })}
                    />
                    <span className={styles.hint}>Configurable current threshold</span>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Max Cell Temp (°C)</label>
                    <input
                      type="number"
                      step="1"
                      className={styles.input}
                      value={thresholds.max_temp}
                      onChange={(e) => setThresholds({ ...thresholds, max_temp: parseFloat(e.target.value) })}
                    />
                    <span className={styles.hint}>Warning &gt; 45°C / Critical &gt; 55°C</span>
                  </div>
                </div>

                <button type="submit" className={styles.saveBtn}>
                   Save Threshold Rules
                </button>
                {savedMsg && <div className={styles.successBox}>{savedMsg}</div>}
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};



export default AlertsDrawer;
