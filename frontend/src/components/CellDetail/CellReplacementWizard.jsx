import React, { useEffect, useState } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./CellReplacementWizard.module.css";

export const CellReplacementWizard = () => {
  const isOpen = useTelemetryStore((state) => state.isReplacementWizardOpen);
  const position = useTelemetryStore((state) => state.replacementPosition);
  const closeWizard = useTelemetryStore((state) => state.closeReplacementWizard);
  const updateSlotAssignment = useTelemetryStore((state) => state.updateSlotAssignment);
  const packId = useTelemetryStore((state) => state.packId);
  const cells = useTelemetryStore((state) => state.cells);
  const assemblyMap = useTelemetryStore((state) => state.assemblyMap);

  const [step, setStep] = useState(1);
  const [candidates, setCandidates] = useState([]);
  const [targetVitals, setTargetVitals] = useState(null);
  const [searchTierUsed, setSearchTierUsed] = useState(null);
  const [targetCode, setTargetCode] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [operator, setOperator] = useState("Field Technician");
  const [reason, setReason] = useState("Elevated internal resistance / degradation");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);

  const cellTelemetry = position ? cells[position] : null;

  useEffect(() => {
    if (isOpen && position) {
      setStep(1);
      setLoading(true);
      setError(null);
      setSuccessResult(null);
      setSelectedCandidate(null);
      setTargetVitals(null);
      setSearchTierUsed(null);
      const code = assemblyMap[position] || "UNMAPPED";
      setTargetCode(code);

      api
        .getReplacementCandidates(position, packId)
        .then((data) => {
          setCandidates(data.candidates || []);
          setTargetVitals(data.target_vitals || null);
          setSearchTierUsed(data.search_tier_used || null);
          if (data.candidates && data.candidates.length > 0) {
            setSelectedCandidate(data.candidates[0]);
          }
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message || "Failed to load candidate cells");
          setLoading(false);
        });
    }
  }, [isOpen, position, packId, assemblyMap]);

  if (!isOpen || !position) return null;

  const handleConfirmSwap = async () => {
    if (!selectedCandidate) return;
    setLoading(true);
    setError(null);

    try {
      const res = await api.executeCellSwap(
        {
          position,
          old_battery_code: targetCode,
          new_battery_code: selectedCandidate.battery_code,
          operator,
          reason,
        },
        packId
      );

      // Update local Zustand assembly map state
      updateSlotAssignment(position, selectedCandidate.battery_code);
      setSuccessResult(res);
      setStep(4); // Success step
    } catch (err) {
      setError(err.message || "Cell replacement failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={closeWizard}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>CELL REPLACEMENT WIZARD</h2>
            <span className={styles.subtitle}>Target Matrix Position: {position} • 5-Step BaaS Matching Engine</span>
          </div>
          <button className={styles.closeBtn} onClick={closeWizard}>✕</button>
        </div>

        {/* Wizard Steps Indicator */}
        <div className={styles.stepper}>
          <div className={`${styles.stepBadge} ${step >= 1 ? styles.stepActive : ""}`}>1. Target Overview</div>
          <div className={styles.stepDivider} />
          <div className={`${styles.stepBadge} ${step >= 2 ? styles.stepActive : ""}`}>2. Candidate Selection</div>
          <div className={styles.stepDivider} />
          <div className={`${styles.stepBadge} ${step >= 3 ? styles.stepActive : ""}`}>3. Operator & Reason</div>
          <div className={styles.stepDivider} />
          <div className={`${styles.stepBadge} ${step >= 4 ? styles.stepActive : ""}`}>4. Swap Execution</div>
        </div>

        {/* Step 1: Target Cell Vitals */}
        {step === 1 && (
          <div className={styles.stepBody}>
            <h3 className={styles.sectionTitle}>1. Target Cell Diagnostic Overview</h3>
            <div className={styles.targetBox}>
              <div className={styles.targetRow}>
                <span className={styles.targetLabel}>Target Position:</span>
                <span className={styles.targetValue}>{position}</span>
              </div>
              <div className={styles.targetRow}>
                <span className={styles.targetLabel}>Installed Cell Passport Code:</span>
                <span className={styles.codeBadge}>{targetCode}</span>
              </div>
              {cellTelemetry && (
                <div className={styles.vitalsGrid}>
                  <div className={styles.vitalCard}>
                    <span className={styles.vitalLabel}>Voltage</span>
                    <span className={styles.vitalVal}>{cellTelemetry.voltage_v?.toFixed(3)} V</span>
                  </div>
                  <div className={styles.vitalCard}>
                    <span className={styles.vitalLabel}>Temperature</span>
                    <span className={styles.vitalVal}>{cellTelemetry.temperature_c?.toFixed(1)} °C</span>
                  </div>
                  <div className={styles.vitalCard}>
                    <span className={styles.vitalLabel}>DC Resistance</span>
                    <span className={styles.vitalVal}>{cellTelemetry.dcir_mohm?.toFixed(1)} mΩ</span>
                  </div>
                  <div className={styles.vitalCard}>
                    <span className={styles.vitalLabel}>State of Health</span>
                    <span className={styles.vitalVal}>{cellTelemetry.soh_percent?.toFixed(1)} %</span>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={closeWizard}>Cancel</button>
              <button className={styles.primaryBtn} onClick={() => setStep(2)}>
                Proceed to Grade-Matched Candidates →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Rank Candidate Selection */}
        {step === 2 && (
          <div className={styles.stepBody}>
            <h3 className={styles.sectionTitle}>2. Rank-Matched Replacement Candidates</h3>

            {targetVitals && (
              <div className={styles.vitalsSummaryCard}>
                <div className={styles.vitalsTitle}> Parallel String Group S{targetVitals.series} Target Baseline</div>
                <div className={styles.vitalsMeta}>
                  {targetVitals.target_block_avg_soh != null && (
                    <span>Group Avg SOH: <strong>{targetVitals.target_block_avg_soh}%</strong></span>
                  )}
                  {targetVitals.target_absolute_capacity_mah != null && (
                    <span>Target Cap: <strong>{targetVitals.target_absolute_capacity_mah} mAh</strong></span>
                  )}
                  {targetVitals.target_block_avg_dcir != null && (
                    <span>Avg DCIR: <strong>{targetVitals.target_block_avg_dcir} mΩ</strong></span>
                  )}
                  {targetVitals.target_block_live_ocv != null && (
                    <span>Live OCV: <strong>{targetVitals.target_block_live_ocv} V</strong></span>
                  )}
                </div>
              </div>
            )}

            <p className={styles.hintText}>
              🔗 3-Tier Cascade: Tier 1 (Same Manufacturer ±250mAh/±1.5V/±5%) → Tier 2 (All Manufacturers, same) → Tier 3 (Widened ±500mAh/±2.5V/±10%)
            </p>

            {searchTierUsed && (
              <div className={styles.tierBadgeContainer}>
                <span className={`${styles.tierBadge} ${searchTierUsed === 1 ? styles.tier1 : searchTierUsed === 2 ? styles.tier2 : styles.tier3}`}>
                  {searchTierUsed === 1
                    ? "✓ Tier 1 — Same Manufacturer (Tight Match)"
                    : searchTierUsed === 2
                      ? "⟶ Tier 2 — All Manufacturers (Tight Match)"
                      : "⟶ Tier 3 — All Manufacturers (Widened Ballpark)"}
                </span>
              </div>
            )}

            {loading ? (
              <div className={styles.loader}>Searching inventory for matching cells...</div>
            ) : error ? (
              <div className={styles.errorBox}>{error}</div>
            ) : candidates.length === 0 ? (
              <div className={styles.emptyBox}>No matching replacement candidates available in inventory.</div>
            ) : (
              <div className={styles.candidatesList}>
                {candidates.map((cand) => {
                  const safety = cand.safety_directive;
                  const isOk = safety ? safety.is_compliant : true;
                  return (
                    <div
                      key={cand.battery_code}
                      className={`${styles.candidateCard} ${selectedCandidate?.battery_code === cand.battery_code ? styles.candidateSelected : ""
                        }`}
                      onClick={() => setSelectedCandidate(cand)}
                    >
                      <div className={styles.candHeader}>
                        <input
                          type="radio"
                          name="candidate"
                          checked={selectedCandidate?.battery_code === cand.battery_code}
                          onChange={() => setSelectedCandidate(cand)}
                        />
                        <span className={styles.candCode}>{cand.battery_code}</span>
                        {cand.manufacturer && (
                          <span className={styles.mfrTag}>{cand.manufacturer} {cand.model_name || ""}</span>
                        )}
                        {cand.search_tier && (
                          <span className={`${styles.tierBadge} ${cand.search_tier === 1 ? styles.tier1 : cand.search_tier === 2 ? styles.tier2 : styles.tier3}`}>
                            T{cand.search_tier}
                          </span>
                        )}
                        <span className={styles.scoreBadge}>Match {cand.match_score}%</span>
                      </div>

                      <div className={styles.candMeta}>
                        <span>Grade: <strong>{cand.current_grade}</strong></span>
                        <span>Capacity: <strong>{cand.absolute_capacity_mah || cand.soh_percent * 25.0} mAh</strong></span>
                        <span>DCIR: <strong>{cand.dcir_mohm} mΩ</strong> {cand.dcir_delta_mohm !== undefined && `(Δ ${cand.dcir_delta_mohm} mΩ)`}</span>
                        <span>OCV: <strong>{cand.resting_ocv_v || cand.ocv_v} V</strong></span>
                        <span>SOH: <strong>{cand.soh_percent}%</strong></span>
                      </div>

                      {safety && (
                        <div className={isOk ? styles.safetyOk : styles.safetyWarn}>
                          {isOk ? "✓ Safe for immediate swap (Inrush compliant ≤1.5V)" : `⚡ ${safety.instruction}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={() => setStep(1)}>← Back</button>
              <button
                className={styles.primaryBtn}
                disabled={!selectedCandidate}
                onClick={() => setStep(3)}
              >
                Proceed to Operator Confirmation →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Operator Details & Swap Reason */}
        {step === 3 && (
          <div className={styles.stepBody}>
            <h3 className={styles.sectionTitle}>3. Operator & Reason Confirmation</h3>

            <div className={styles.formGroup}>
              <label className={styles.label}>Field Operator / Engineer Name:</label>
              <input
                type="text"
                className={styles.input}
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="e.g. John Doe (Lead Tech)"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Replacement Reason & Forensic Notes:</label>
              <textarea
                className={styles.textarea}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Describe reason for cell retirement..."
              />
            </div>

            <div className={styles.summarySwapBox}>
              <div><strong>Position:</strong> {position}</div>
              <div><strong>Old Cell (Retiring):</strong> <span className={styles.retiredCode}>{targetCode}</span></div>
              <div><strong>New Cell (Deploying):</strong> <span className={styles.deployedCode}>{selectedCandidate?.battery_code}</span></div>
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={() => setStep(2)}>← Back</button>
              <button
                className={styles.confirmBtn}
                disabled={loading}
                onClick={handleConfirmSwap}
              >
                {loading ? "Executing Cell Swap..." : "Execute Cell Swap & Update Passports"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Success Result */}
        {step === 4 && successResult && (
          <div className={styles.stepBody}>
            <div className={styles.successBanner}>
              <span className={styles.successIcon}>✓</span>
              <h3>CELL REPLACEMENT COMPLETED SUCCESSFULLY</h3>
            </div>

            <div className={styles.resultDetails}>
              <p>Position <strong>{position}</strong> has been updated in the Pack Assembly Map.</p>
              <div className={styles.resultRow}>
                <span>Old Cell Passport:</span>
                <span className={styles.stateTagRed}>{targetCode} → RETIRED_FROM_PACK</span>
              </div>
              <div className={styles.resultRow}>
                <span>New Cell Passport:</span>
                <span className={styles.stateTagGreen}>{selectedCandidate?.battery_code} → DEPLOYED_IN_PACK</span>
              </div>
              <div className={styles.resultRow}>
                <span>Map Version Recorded:</span>
                <span>Version #{successResult.version_number}</span>
              </div>
              {successResult.anomaly_cleared && (
                <div className={styles.resultRow}>
                  <span>Real-time Telemetry:</span>
                  <span className={styles.stateTagGreen}>✓ Simulator fault cleared for {position}</span>
                </div>
              )}
            </div>

            <div className={styles.actions}>
              <button className={styles.primaryBtn} onClick={closeWizard}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CellReplacementWizard;
