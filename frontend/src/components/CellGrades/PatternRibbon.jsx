import React, { useState, useMemo } from "react";
import styles from "./CellGradesModal.module.css";

const CLUSTER_KEYS = [
  "optimal_match",
  "low_dcir",
  "mod_dcir",
  "high_dcir_outlier",
  "prismatic",
];

const CLUSTER_META = {
  optimal_match: {
    icon: "⚡",
    accent: "#34d399",
    bg: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.35)",
    criteria: "2.0–2.6 Ah  •  15–32 mΩ  •  Grade A/B",
  },
  low_dcir: {
    icon: "🔋",
    accent: "#60a5fa",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.35)",
    criteria: "DCIR < 20 mΩ (Low Impedance)",
  },
  mod_dcir: {
    icon: "🛢️",
    accent: "#fbbf24",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.35)",
    criteria: "DCIR 35–65 mΩ (Moderate ESS)",
  },
  high_dcir_outlier: {
    icon: "⚠️",
    accent: "#f87171",
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.4)",
    criteria: "DCIR > 65 mΩ  •  OCV < 2.5V  •  FAULTY",
  },
  prismatic: {
    icon: "🟩",
    accent: "#c084fc",
    bg: "rgba(168, 85, 247, 0.12)",
    border: "rgba(168, 85, 247, 0.35)",
    criteria: "Nominal Cap ≥ 40 Ah (LiFePO4 LFP)",
  },
};

const FALLBACK_LABELS = {
  optimal_match: "Optimal Assembly Match",
  low_dcir: "Low Impedance (High C-Rate)",
  mod_dcir: "Moderate Impedance (ESS)",
  high_dcir_outlier: "High-DCIR Outliers",
  prismatic: "Large Prismatic (50Ah LFP)",
};

const SHORT_NAMES = {
  optimal_match: "Optimal Match",
  low_dcir: "Low DCIR",
  mod_dcir: "Mod DCIR",
  high_dcir_outlier: "Outliers",
  prismatic: "Prismatic",
};

const colorFor = (c) => CLUSTER_META[c]?.accent || "#94a3b8";

export const PatternRibbon = ({
  data,
  selectedPattern,
  setSelectedPattern,
  onFilterCells,
}) => {
  const [hover, setHover] = useState(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [viewMode, setViewMode] = useState("18650"); // "18650" | "all"

  const analytics = data?.pattern_analytics;
  const clusters = analytics?.clusters || {};
  const metrics = analytics?.metrics || {};

  const handleCardClick = (key) => {
    const next = selectedPattern === key ? null : key;
    setSelectedPattern(next);
    onFilterCells?.(next);
  };

  const renderCard = (key) => {
    const active = selectedPattern === key;
    const info = clusters[key] || {};
    const meta = CLUSTER_META[key] || {};
    const label = info.label ?? FALLBACK_LABELS[key] ?? key;

    return (
      <div
        key={key}
        className={`${styles.patternCard} ${active ? styles.patternCardActive : ""}`}
        style={{
          background: active ? meta.bg : undefined,
          borderColor: active ? meta.accent : undefined,
          boxShadow: active ? `0 0 16px ${meta.accent}44` : undefined,
        }}
        onClick={() => handleCardClick(key)}
        title={`Click to filter passport table by ${label}`}
      >
        <div className={styles.patternCardHeader}>
          <span className={styles.patternCardIcon} style={{ color: meta.accent }}>
            {meta.icon}
          </span>
          <span className={styles.patternCardCount} style={{ color: meta.accent }}>
            {info.count ?? 0}
          </span>
        </div>
        <div className={styles.patternCardLabel} style={{ color: meta.accent }}>
          {label}
        </div>
        <div className={styles.patternCardCriteria}>{meta.criteria}</div>
        <div className={styles.patternCardPct}>
          <span>{(info.percentage ?? 0).toFixed(1)}% of inventory</span>
          {active && <span style={{ color: meta.accent, fontWeight: 800 }}>● Active</span>}
        </div>
      </div>
    );
  };

  const scatterCells = useMemo(() => {
    if (!data?.passports) return [];
    return data.passports
      .filter((c) => c.nominal_capacity_ah != null && c.dcir_mohm != null)
      .map((c) => ({
        code: c.battery_code,
        legacy: c.legacy_cell_id,
        cap: c.nominal_capacity_ah,
        dcir: c.dcir_mohm,
        grade: c.current_grade,
        cluster: c.pattern_cluster || "standard",
      }));
  }, [data]);

  const displayedCells = useMemo(() => {
    if (viewMode === "18650") {
      // Focus on 18650 cylindrical cells (cap <= 6Ah and dcir <= 150mOhm)
      return scatterCells.filter((c) => c.cap <= 6 && c.dcir <= 150);
    }
    return scatterCells;
  }, [scatterCells, viewMode]);

  const bounds = useMemo(() => {
    if (!displayedCells.length) return { maxCap: 4.0, maxDcir: 100 };
    if (viewMode === "18650") {
      return {
        maxCap: Math.max(3.5, Math.ceil(Math.max(...displayedCells.map((s) => s.cap)) * 10) / 10 + 0.5),
        maxDcir: Math.max(80, Math.ceil(Math.max(...displayedCells.map((s) => s.dcir)) / 10) * 10 + 10),
      };
    }
    return {
      maxCap: Math.max(50, Math.ceil(Math.max(...displayedCells.map((s) => s.cap)) / 10) * 10 + 5),
      maxDcir: Math.max(100, Math.ceil(Math.max(...displayedCells.map((s) => s.dcir)) / 50) * 50 + 50),
    };
  }, [displayedCells, viewMode]);

  const W = 560, H = 320;
  const padL = 56, padR = 20, padT = 20, padB = 44;
  const iW = W - padL - padR, iH = H - padT - padB;
  const xCap = (c) => padL + Math.max(0, Math.min(1, c / bounds.maxCap)) * iW;
  const yDcir = (d) => padT + iH - Math.max(0, Math.min(1, d / bounds.maxDcir)) * iH;

  const capTicks = useMemo(() => {
    if (viewMode === "18650") {
      return [0, 1, 2, 2.5, 3, 3.5, 4].filter((v) => v <= bounds.maxCap);
    }
    return [0, 10, 20, 30, 40, 50].filter((v) => v <= bounds.maxCap);
  }, [viewMode, bounds.maxCap]);

  const dcirTicks = useMemo(() => {
    if (viewMode === "18650") {
      return [0, 20, 40, 60, 80, 100, 120].filter((v) => v <= bounds.maxDcir);
    }
    return [0, 100, 200, 300, 400].filter((v) => v <= bounds.maxDcir);
  }, [viewMode, bounds.maxDcir]);

  const handlePointClick = (cell) => {
    setSelectedPattern(cell.cluster);
    onFilterCells?.(cell.cluster);
  };

  return (
    <div className={styles.patternRibbon}>
      <div className={styles.patternRibbonTitleRow}>
        <div className={styles.patternRibbonTitleLeft}>
          <div className={styles.patternRibbonTitle}>
            <span className={styles.patternRibbonTitleIcon}>🧬</span>
            <span>Pattern Identification of Cells</span>
          </div>
          <div className={styles.patternRibbonSubtitle}>
            Capacity × DCIR bivariate clustering for 8S11P pack-assembly compatibility & safety screening
          </div>
        </div>

        <div className={styles.patternRibbonControls}>
          {selectedPattern && (
            <div className={styles.patternActiveIndicator}>
              <span>Cluster: <b>{clusters[selectedPattern]?.label || FALLBACK_LABELS[selectedPattern] || selectedPattern}</b></span>
              <button
                className={styles.patternActiveClear}
                onClick={(e) => { e.stopPropagation(); handleCardClick(selectedPattern); }}
                title="Clear pattern cluster filter"
              >
                ✕
              </button>
            </div>
          )}
          <button
            className={styles.patternToggleBtn}
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse Bivariate Scatter & Assembly Guide" : "Expand Bivariate Scatter & Assembly Guide"}
          >
            {isExpanded ? "▲ Collapse Analysis" : "▼ Expand Bivariate & Guide"}
          </button>
        </div>
      </div>

      <div className={styles.patternCardsGrid}>
        {CLUSTER_KEYS.map((key) => renderCard(key))}

        <div className={`${styles.patternCard} ${styles.patternCardVitals}`}>
          <div className={styles.patternCardHeader}>
            <span className={styles.patternCardIcon} style={{ color: "#a78bfa" }}>📊</span>
            <span className={styles.patternCardCount} style={{ color: "#a78bfa" }}>
              {metrics.total_analyzed ?? 0}
            </span>
          </div>
          <div className={styles.patternCardLabel} style={{ color: "#a78bfa" }}>
            All Analyzed Vitals
          </div>
          <div className={styles.vitalsRow}>
            <span className={styles.vitalsLabel}>Mean DCIR</span>
            <span className={styles.vitalsValue}>
              {metrics.dcir?.mean_mohm != null ? `${metrics.dcir.mean_mohm} mΩ` : "--"}
            </span>
          </div>
          <div className={styles.vitalsRow}>
            <span className={styles.vitalsLabel}>Mean Cap</span>
            <span className={styles.vitalsValue}>
              {metrics.capacity?.mean_ah != null ? `${metrics.capacity.mean_ah} Ah` : "--"}
            </span>
          </div>
          <div className={styles.vitalsRow}>
            <span className={styles.vitalsLabel}>Correlation</span>
            <span className={styles.vitalsValue}>
              {metrics.capacity_dcir_correlation != null
                ? `r = ${metrics.capacity_dcir_correlation}`
                : "--"}
            </span>
          </div>
          <div className={styles.vitalsRow}>
            <span className={styles.vitalsLabel}>Paired Sets</span>
            <span className={styles.vitalsValue}>
              {metrics.paired_cap_dcir_count ?? 0}
            </span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className={styles.scatterAndInterpretation}>
          <div className={styles.scatterCard}>
            <div className={styles.scatterHeader}>
              <div className={styles.scatterTitle}>
                <span>📈</span>
                <span>Bivariate Distribution: Capacity (Ah) × DCIR (mΩ)</span>
              </div>
              <div className={styles.scatterHeaderActions}>
                <div className={styles.scatterViewToggle}>
                  <button
                    className={`${styles.scatterViewBtn} ${viewMode === "18650" ? styles.scatterViewBtnActive : ""}`}
                    onClick={() => setViewMode("18650")}
                    title="Focus on 18650 cylindrical cells for 8S11P assembly"
                  >
                    18650 Focus (≤ 5 Ah)
                  </button>
                  <button
                    className={`${styles.scatterViewBtn} ${viewMode === "all" ? styles.scatterViewBtnActive : ""}`}
                    onClick={() => setViewMode("all")}
                    title="Include 50Ah LFP prismatics and extreme outliers"
                  >
                    All Formats
                  </button>
                </div>
                <div className={styles.scatterLegend}>
                  {CLUSTER_KEYS.map((k) => {
                    const active = selectedPattern === k;
                    const short = SHORT_NAMES[k] || (clusters[k]?.label || k).split(" ")[0];
                    return (
                      <span
                        key={k}
                        className={`${styles.legendDot} ${active ? styles.legendDotActive : ""}`}
                        onClick={() => handleCardClick(k)}
                        title={`Filter by: ${clusters[k]?.label || k}`}
                      >
                        <span className={styles.legendSwatch} style={{ background: colorFor(k) }} />
                        <span>{short}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className={styles.scatterSvgWrap}>
              {displayedCells.length === 0 && (
                <div style={{ position: "absolute", color: "#94a3b8", fontSize: "12px", textAlign: "center" }}>
                  Awaiting passport telemetry vitals...
                </div>
              )}

              <svg viewBox={`0 0 ${W} ${H}`} className={styles.scatterSvg}>
                <defs>
                  <pattern id="gridMinor" width="40" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 30" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
                  </pattern>
                </defs>

                <rect x={padL} y={padT} width={iW} height={iH} fill="url(#gridMinor)" />

                {dcirTicks.map((d) => {
                  const y = yDcir(d);
                  return (
                    <g key={`d-${d}`}>
                      <line x1={padL} x2={padL + iW} y1={y} y2={y} stroke="rgba(148,163,184,0.2)" strokeDasharray="3 4" />
                      <text x={padL - 8} y={y + 4} fontSize="10" textAnchor="end" fill="#94a3b8">{d}</text>
                    </g>
                  );
                })}

                {capTicks.map((c) => {
                  const x = xCap(c);
                  return (
                    <g key={`c-${c}`}>
                      <line x1={x} x2={x} y1={padT} y2={padT + iH} stroke="rgba(148,163,184,0.15)" strokeDasharray="3 4" />
                      <text x={x} y={padT + iH + 18} fontSize="10" textAnchor="middle" fill="#94a3b8">{c} Ah</text>
                    </g>
                  );
                })}

                <text x={padL - 42} y={padT + iH / 2} fontSize="11" fill="#64748b"
                  transform={`rotate(-90 ${padL - 42} ${padT + iH / 2})`} textAnchor="middle">
                  DCIR (mΩ)
                </text>
                <text x={padL + iW / 2} y={H - 6} fontSize="11" fill="#64748b" textAnchor="middle">
                  Nominal Capacity (Ah)
                </text>

                {displayedCells.map((cell, idx) => {
                  const cx = xCap(cell.cap);
                  const cy = yDcir(cell.dcir);
                  const col = colorFor(cell.cluster);
                  const isHover = hover && hover.code === cell.code;
                  const active = !selectedPattern || selectedPattern === cell.cluster;
                  return (
                    <g key={`${cell.code}-${idx}`}
                      onMouseEnter={() => setHover(cell)}
                      onMouseLeave={() => setHover((h) => (h?.code === cell.code ? null : h))}
                      onClick={() => handlePointClick(cell)}
                      style={{ cursor: "pointer" }}>
                      <circle cx={cx} cy={cy} r={isHover ? 6 : active && selectedPattern ? 4.5 : 3.2}
                        fill={col} fillOpacity={active ? (isHover ? 0.95 : 0.72) : 0.12}
                        stroke={col} strokeWidth={isHover ? 2.5 : active && selectedPattern ? 1.5 : 0.5}
                        strokeOpacity={active ? 1 : 0.25} />
                    </g>
                  );
                })}

                {hover && (
                  <g pointerEvents="none">
                    <rect x={Math.min(xCap(hover.cap) + 8, W - 180)} y={Math.max(yDcir(hover.dcir) - 52, padT)}
                      width="172" height="46" rx="6"
                      fill="rgba(15,23,42,0.96)" stroke="rgba(96,165,250,0.5)" />
                    <text x={Math.min(xCap(hover.cap) + 16, W - 172)} y={Math.max(yDcir(hover.dcir) - 36, padT + 16)}
                      fontSize="11" fontWeight="700" fill="#e2e8f0">
                      {hover.code}
                    </text>
                    <text x={Math.min(xCap(hover.cap) + 16, W - 172)} y={Math.max(yDcir(hover.dcir) - 22, padT + 30)}
                      fontSize="10" fill="#94a3b8">
                      Legacy #{hover.legacy} • Grade {hover.grade}
                    </text>
                    <text x={Math.min(xCap(hover.cap) + 16, W - 172)} y={Math.max(yDcir(hover.dcir) - 10, padT + 42)}
                      fontSize="10" fill="#cbd5e1">
                      {hover.cap} Ah  •  {hover.dcir} mΩ
                    </text>
                  </g>
                )}
              </svg>
            </div>
          </div>

          <div className={styles.interpretationBox}>
            <div className={styles.interpretationHeader}>
              <span className={styles.interpretationIcon}>🔬</span>
              <span className={styles.interpretationTitle}>Pack Assembly Screening Rules</span>
            </div>

            <ul className={styles.interpretationList}>
              <li className={styles.interpretationItem} style={{ borderLeftColor: CLUSTER_META.optimal_match.accent }}>
                <b style={{ color: CLUSTER_META.optimal_match.accent }}>Tight DCIR match (15–32 mΩ × 2.0–2.6 Ah):</b> Lowest
                circulating currents within parallel strings — cells share load evenly, minimizing hot-spot formation and differential aging.
              </li>
              <li className={styles.interpretationItem} style={{ borderLeftColor: CLUSTER_META.low_dcir.accent }}>
                <b style={{ color: CLUSTER_META.low_dcir.accent }}>Low-DCIR cells grouped together:</b> Ideal for high
                C-rate discharge. Never pair a low-DCIR cell with a high-DCIR unit in the same parallel string to prevent current hogging.
              </li>
              <li className={styles.interpretationItem} style={{ borderLeftColor: CLUSTER_META.mod_dcir.accent }}>
                <b style={{ color: CLUSTER_META.mod_dcir.accent }}>Moderate-DCIR (35–65 mΩ) clusters:</b> Suitable for
                low C-rate stationary ESS storage arrays. Segregate from ultra-low impedance cells.
              </li>
              <li className={styles.interpretationItem} style={{ borderLeftColor: CLUSTER_META.high_dcir_outlier.accent }}>
                <b style={{ color: CLUSTER_META.high_dcir_outlier.accent }}>DCIR &gt; 65 mΩ or OCV &lt; 2.5 V outliers:</b> QUARANTINE.
                Units starve string current and act as resistive heating elements with elevated thermal runaway risk.
              </li>
              <li className={styles.interpretationItem} style={{ borderLeftColor: CLUSTER_META.prismatic.accent }}>
                <b style={{ color: CLUSTER_META.prismatic.accent }}>50Ah LFP prismatic cells:</b> Chemistry, form factor,
                and current-handling dynamics are incompatible with cylindrical 18650 strings. Dedicated module topology only.
              </li>
            </ul>

            <div className={styles.disclaimerBox}>
              <span className={styles.disclaimerIcon}>ℹ️</span>
              <span>
                Advisory engineering screening based on logged passport vitals. Comprehensive IR thermography and dynamic pulse validation are mandatory prior to 8S11P physical pack assembly.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatternRibbon;
