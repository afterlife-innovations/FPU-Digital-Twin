import React, { useEffect, useState, useMemo, useRef } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./CellGradesModal.module.css";

// ---------------------------------------------------------------------
// Pure helpers (kept outside the component so they aren't recreated)
// ---------------------------------------------------------------------

const LETTER_GRADES = ["A", "B", "C", "D", "E"];
const UNGRADED_VALUES = ["Ungraded", "NONE", "", "UNGRADED", "N/A", "UNKNOWN"];

// Grade card definitions (order = display order)
const GRADE_CARDS = [
  { key: "ALL", label: "ALL GRADES", badge: "gradeBadgeAll", countLabel: "Total Cells" },
  { key: "A", label: "GRADE A", badge: "gradeBadgeA", countLabel: "Cells" },
  { key: "B", label: "GRADE B", badge: "gradeBadgeB", countLabel: "Cells" },
  { key: "C", label: "GRADE C", badge: "gradeBadgeC", countLabel: "Cells" },
  { key: "D", label: "GRADE D", badge: "gradeBadgeD", countLabel: "Cells" },
  { key: "E", label: "GRADE E", badge: "gradeBadgeE", countLabel: "Cells" },
  { key: "FAULTY", label: "FAULTY CELLS", badge: "gradeBadgeFaulty", countLabel: "faulty cells", faulty: true },
  { key: "Ungraded", label: "UNGRADED / INTAKE", badge: "gradeBadgeUngraded", countLabel: "Cells" },
];

// Measured capacity from the cell's latest test (derived_metrics.measured_capacity_ah).
// Returns null when the cell has never been capacity-tested.
const getMeasuredCapacity = (cell) => {
  if (cell?.measured_capacity_ah == null) return null;
  const n = Number(cell.measured_capacity_ah);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Same bucketing rules as the grade filter, so card stats always match the table
const getGradeBucket = (c) => {
  const grade = String(c.current_grade || "").trim();
  const state = String(c.current_state || "").trim().toLowerCase();

  if (grade === "FAULTY" || state === "faulty") return "FAULTY";
  if (LETTER_GRADES.includes(grade) && ["graded", "in_pack", "deployed"].includes(state)) return grade;
  if (
    state === "intake" ||
    UNGRADED_VALUES.includes(grade) ||
    (state === "tested" && ![...LETTER_GRADES, "FAULTY"].includes(grade))
  ) {
    return "Ungraded";
  }
  return null;
};

const getLegacyNumeric = (legacyId) => {
  if (!legacyId || legacyId === "N/A") return 999999;
  const num = parseInt(String(legacyId).replace(/[^0-9]/g, ""), 10);
  return isNaN(num) ? 999999 : num;
};

const getSearchNumber = (text) => {
  const match = String(text || "").match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
};

const parseMetricSearch = (rawQ, cleanQ) => {
  const query = String(rawQ || cleanQ || "").trim().toLowerCase();
  const labelMatch = query.match(
    /^(capacity|cap|measured capacity|nominal capacity|dcir|internal resistance|soh|state of health)\s*[:=]?\s*(.+)$/
  );

  if (labelMatch) {
    return {
      metric: labelMatch[1].replace(/\s+/g, " ").trim(),
      valueText: labelMatch[2].replace(/\b(ah|a h|mohm|mΩ|percent|%)\b/g, "").trim(),
    };
  }

  return { metric: "all", valueText: cleanQ };
};

const numericMetricMatches = (values, valueText) => {
  const queryValue = getSearchNumber(valueText);
  if (queryValue == null) return false;

  return values.some((value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue === queryValue;
  });
};

const matchesCellMetrics = (cell, rawQ, cleanQ) => {
  const { metric, valueText } = parseMetricSearch(rawQ, cleanQ);
  const nominalCapacity = cell.nominal_capacity_ah;
  const measuredCapacity = getMeasuredCapacity(cell);
  const capacities = [nominalCapacity, measuredCapacity].filter((value) => value != null);
  const dcir = cell.dcir_mohm;
  const soh = cell.soh_percent;

  const capacityMetric =
    metric === "all" ||
    metric === "capacity" ||
    metric === "cap" ||
    metric === "measured capacity" ||
    metric === "nominal capacity";
  const dcirMetric = metric === "all" || metric === "dcir" || metric === "internal resistance";
  const sohMetric = metric === "all" || metric === "soh" || metric === "state of health";

  const numericMatches =
    (capacityMetric && numericMetricMatches(capacities, valueText)) ||
    (dcirMetric && numericMetricMatches([dcir], valueText)) ||
    (sohMetric && numericMetricMatches([soh], valueText));
  if (numericMatches) return true;

  const metricText = [
    ...capacities.map((value) => `${value} ah`),
    dcir != null ? `${dcir} mohm` : "",
    soh != null ? `${soh} percent` : "",
  ].join(" ").toLowerCase();

  if (!String(valueText || "").trim()) return false;
  if (metric === "all") return metricText.includes(String(valueText).toLowerCase());

  const selectedText =
    metric === "capacity" || metric === "cap" ||
    metric === "measured capacity" || metric === "nominal capacity"
      ? capacities.map((value) => `${value} ah`).join(" ")
      : dcirMetric && dcir != null
        ? `${dcir} mohm`
        : sohMetric && soh != null
          ? `${soh} percent`
          : "";
  return String(selectedText).toLowerCase().includes(String(valueText).toLowerCase());
};

const getSearchRelevanceScore = (cell, rawQ, cleanQ) => {
  const legacy = String(cell.legacy_cell_id || "").toLowerCase().trim();
  const legacyWithHash = `#${legacy}`;
  const code = String(cell.battery_code || "").toLowerCase().trim();
  const codeSuffix = (code.split("-").pop() || "").toLowerCase();
  const brand = String(cell.brand || "").toLowerCase().trim();
  const mfr = String(cell.manufacturer || "").toLowerCase().trim();
  const chem = String(cell.chemistry || "").toLowerCase().trim();

  if (legacy === cleanQ || legacyWithHash === rawQ || legacy === rawQ) return 100000;
  if (!isNaN(cleanQ) && !isNaN(legacy) && parseInt(cleanQ, 10) === parseInt(legacy, 10)) return 95000;
  if (code === rawQ || code === cleanQ) return 90000;
  if (codeSuffix === cleanQ) return 85000;
  if (code.endsWith(cleanQ) && cleanQ.length >= 3) return 80000;
  if (legacy.startsWith(cleanQ)) return 70000 - (legacy.length - cleanQ.length) * 100;
  if (code.startsWith(cleanQ) || code.startsWith(rawQ)) return 60000;
  if (legacy.includes(cleanQ)) return 50000;
  if (code.includes(cleanQ)) {
    const isGeneric = ["18650", "21700", "liio", "afi", "afi-liio"].includes(cleanQ);
    return isGeneric ? 10000 : 40000;
  }
  const { metric, valueText } = parseMetricSearch(rawQ, cleanQ);
  const capacityValues = [
    cell.nominal_capacity_ah,
    getMeasuredCapacity(cell),
  ].filter((value) => value != null);
  const dcirValue = cell.dcir_mohm;
  const sohValue = cell.soh_percent;

  if (
    (metric === "all" || ["capacity", "cap", "measured capacity", "nominal capacity"].includes(metric)) &&
    numericMetricMatches(capacityValues, valueText)
  ) return 56000;
  if (
    (metric === "all" || ["dcir", "internal resistance"].includes(metric)) &&
    numericMetricMatches([dcirValue], valueText)
  ) return 55000;
  if (
    (metric === "all" || ["soh", "state of health"].includes(metric)) &&
    numericMetricMatches([sohValue], valueText)
  ) return 54000;
  if (matchesCellMetrics(cell, rawQ, cleanQ)) return 52000;
  if (brand === cleanQ || mfr === cleanQ) return 35000;
  if (brand.startsWith(cleanQ) || mfr.startsWith(cleanQ)) return 30000;
  if (brand.includes(cleanQ) || mfr.includes(cleanQ) || chem.includes(cleanQ)) return 20000;

  return 1000;
};

// ---------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------

export const CellGradesModal = () => {
  const isOpen = useTelemetryStore((state) => state.isGradeInventoryOpen);
  const closeModal = () => useTelemetryStore.getState().setGradeInventoryOpen(false);
  const setAssemblyModalOpen = useTelemetryStore((state) => state.setAssemblyModalOpen);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Table wrapper ref for auto-scrolling to top on search/filter changes
  const tableWrapperRef = useRef(null);

  // Filter States
  const [selectedGrade, setSelectedGrade] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [selectedManufacturer, setSelectedManufacturer] = useState("ALL");
  const [selectedChemistry, setSelectedChemistry] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const resetFilters = () => {
    setSelectedGrade("ALL");
    setSelectedStatus("ALL");
    setSelectedManufacturer("ALL");
    setSelectedChemistry("ALL");
    setSearchQuery("");
    setCurrentPage(1);
  };

  const selectGrade = (key) => {
    setSelectedGrade(key);
    setSelectedManufacturer("ALL");
    setCurrentPage(1);
  };

  const fetchInventory = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getGradesInventory(forceRefresh);
      setData(res);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching grades inventory:", err);
      setError(err.message || "Failed to query Afterlife Intelligence API");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchInventory(false);
    }
  }, [isOpen]);

  // Automatically scroll table and modal body to top whenever search query or filters change
  useEffect(() => {
    if (tableWrapperRef.current) {
      tableWrapperRef.current.scrollTop = 0;
    }
    const modalBody = document.getElementById("grades-modal-body");
    if (modalBody) {
      modalBody.scrollTop = 0;
    }
  }, [searchQuery, selectedGrade, selectedStatus, selectedManufacturer, selectedChemistry, currentPage]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCopy = (text, label = "Code") => {
    navigator.clipboard.writeText(text);
    showToast(`Copied ${label}: ${text}`);
  };

  const getBadgeClass = (grade) => {
    switch (grade) {
      case "A": return styles.gradeBadgeA;
      case "B": return styles.gradeBadgeB;
      case "C": return styles.gradeBadgeC;
      case "D": return styles.gradeBadgeD;
      case "E": return styles.gradeBadgeE;
      case "FAULTY": return styles.gradeBadgeFaulty;
      case "ALL": return styles.gradeBadgeAll;
      default: return styles.gradeBadgeUngraded;
    }
  };

  const isExactMatch = (cell) => {
    if (!searchQuery.trim()) return false;
    const rawQ = searchQuery.trim().toLowerCase();
    const cleanQ = rawQ.replace(/^cell\s*#?\s*/i, "").replace(/^#\s*/, "").trim();
    const legacy = String(cell.legacy_cell_id || "").toLowerCase().trim();
    const code = String(cell.battery_code || "").toLowerCase().trim();
    const codeSuffix = (code.split("-").pop() || "").toLowerCase();

    return (
      legacy === cleanQ || `#${legacy}` === rawQ || legacy === rawQ ||
      code === cleanQ || code === rawQ || codeSuffix === cleanQ ||
      matchesCellMetrics(cell, rawQ, cleanQ)
    );
  };

  // -------------------------------------------------------------------
  // Filtering / sorting
  // -------------------------------------------------------------------

  const filteredCells = useMemo(() => {
    if (!data || !data.passports) return [];
    let list = data.passports;

    const gradeIsLetter = LETTER_GRADES.includes(selectedGrade);

    if (selectedGrade !== "ALL") {
      list = list.filter((c) => {
        const grade = String(c.current_grade || "").trim();
        const state = String(c.current_state || "").trim().toLowerCase();

        if (selectedGrade === "FAULTY") {
          return grade === "FAULTY" || state === "faulty";
        }
        if (selectedGrade === "Ungraded") {
          return (
            state === "intake" ||
            UNGRADED_VALUES.includes(grade) ||
            (state === "tested" && ![...LETTER_GRADES, "FAULTY"].includes(grade))
          );
        }
        if (gradeIsLetter) {
          return (
            grade === selectedGrade &&
            ["graded", "in_pack", "deployed"].includes(state) &&
            grade !== "FAULTY" && state !== "intake"
          );
        }
        return grade === selectedGrade;
      });
    }

    if (selectedStatus !== "ALL") {
      list = list.filter((c) => String(c.current_state || "").trim().toLowerCase() === selectedStatus);
    }

    if (selectedManufacturer !== "ALL") {
      list = list.filter(
        (c) => c.brand === selectedManufacturer || String(c.manufacturer || "").includes(selectedManufacturer)
      );
    }

    if (selectedChemistry !== "ALL") {
      list = list.filter((c) => c.chemistry === selectedChemistry);
    }

    const trimmed = searchQuery.trim();
    if (trimmed) {
      const rawQ = trimmed.toLowerCase();
      const cleanQ = rawQ.replace(/^cell\s*#?\s*/i, "").replace(/^#\s*/, "").trim();

      list = list.filter((c) => {
        const legacy = String(c.legacy_cell_id || "").toLowerCase();
        const code = String(c.battery_code || "").toLowerCase();
        const mfr = String(c.manufacturer || "").toLowerCase();
        const brand = String(c.brand || "").toLowerCase();
        const chem = String(c.chemistry || "").toLowerCase();

        return (
          legacy.includes(cleanQ) || legacy.includes(rawQ) || (`#${legacy}`).includes(rawQ) ||
          (`cell ${legacy}`).includes(rawQ) || code.includes(cleanQ) || code.includes(rawQ) ||
          mfr.includes(cleanQ) || brand.includes(cleanQ) || chem.includes(cleanQ) ||
          matchesCellMetrics(c, rawQ, cleanQ)
        );
      });

      list = [...list].sort((a, b) => {
        const scoreA = getSearchRelevanceScore(a, rawQ, cleanQ);
        const scoreB = getSearchRelevanceScore(b, rawQ, cleanQ);

        if (scoreA !== scoreB) return scoreB - scoreA;
        const numA = getLegacyNumeric(a.legacy_cell_id);
        const numB = getLegacyNumeric(b.legacy_cell_id);
        if (numA !== numB) return numA - numB;
        return String(a.battery_code).localeCompare(String(b.battery_code));
      });
    } else {
      list = [...list].sort((a, b) => {
        const numA = getLegacyNumeric(a.legacy_cell_id);
        const numB = getLegacyNumeric(b.legacy_cell_id);
        if (numA !== numB) return numA - numB;
        return String(a.battery_code).localeCompare(String(b.battery_code));
      });
    }

    return list;
  }, [data, selectedGrade, selectedStatus, selectedManufacturer, selectedChemistry, searchQuery]);

  const availableManufacturers = useMemo(() => {
    if (!data || !data.passports) return [];
    const sourceList = selectedGrade === "ALL"
      ? data.passports
      : data.passports.filter((c) => c.current_grade === selectedGrade);

    const mfrMap = {};
    sourceList.forEach((c) => {
      const name = c.brand || "Other";
      mfrMap[name] = (mfrMap[name] || 0) + 1;
    });

    return Object.entries(mfrMap).sort((a, b) => b[1] - a[1]);
  }, [data, selectedGrade]);

  const uniqueChemistries = useMemo(() => {
    if (!data || !data.passports) return [];
    const set = new Set(data.passports.map((c) => c.chemistry).filter(Boolean));
    return Array.from(set);
  }, [data]);

  const paginatedCells = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCells.slice(start, start + pageSize);
  }, [filteredCells, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredCells.length / pageSize) || 1;

  // -------------------------------------------------------------------
  // Measured-capacity statistics per grade (computed from the passports,
  // using the same bucketing as the grade filter)
  // -------------------------------------------------------------------

  const measuredStats = useMemo(() => {
    const acc = {};
    const ensure = (k) => {
      if (!acc[k]) acc[k] = { sum: 0, n: 0, min: Infinity, max: -Infinity, cells: 0 };
      return acc[k];
    };

    (data?.passports || []).forEach((c) => {
      const keys = ["ALL"];
      const bucket = getGradeBucket(c);
      if (bucket) keys.push(bucket);

      const m = getMeasuredCapacity(c);
      keys.forEach((k) => {
        const s = ensure(k);
        s.cells += 1;
        if (m !== null) {
          s.sum += m;
          s.n += 1;
          s.min = Math.min(s.min, m);
          s.max = Math.max(s.max, m);
        }
      });
    });

    return acc;
  }, [data]);

  // True when the inventory response includes the measured_capacity_ah key at all
  // (false = backend hasn't been updated to return it yet)
  const inventoryHasMeasuredField = useMemo(() => {
    const first = data?.passports?.[0];
    return !first || "measured_capacity_ah" in first;
  }, [data]);

  // -------------------------------------------------------------------
  // Toolbar actions
  // -------------------------------------------------------------------

  const handleCopyFilteredCodes = () => {
    const codes = filteredCells.map((c) => c.battery_code).join("\n");
    navigator.clipboard.writeText(codes);
    showToast(`Copied ${filteredCells.length} battery codes to clipboard!`);
  };

  const handleExportCSV = () => {
    if (!filteredCells.length) return;
    const headers = [
      "Battery Code", "Legacy Cell ID", "Grade", "Manufacturer", "Brand",
      "Batch", "Chemistry", "Form Factor", "Nominal Capacity (Ah)", "Measured Capacity (Ah)",
      "DCIR (mOhm)", "Intake OCV (V)", "SOH (%)", "Current State"
    ];

    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const rows = filteredCells.map((c) => [
      q(c.battery_code), q(c.legacy_cell_id), q(c.current_grade),
      q(c.manufacturer), q(c.brand), q(c.batch_family),
      q(c.chemistry), q(c.form_factor),
      c.nominal_capacity_ah ?? "",
      getMeasuredCapacity(c) ?? "",
      c.dcir_mohm ?? "", c.intake_ocv_v ?? "", c.soh_percent ?? "", q(c.current_state)
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Afterlife_Cell_Grades_${selectedGrade}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${filteredCells.length} records to CSV!`);
  };

  // -------------------------------------------------------------------
  // Grade card helpers
  // -------------------------------------------------------------------

  const renderMeasuredMeta = (key) => {
    const s = measuredStats[key];
    if (!s || s.n === 0) {
      return (
        <div className={styles.gradeMeta}>
          <span>--</span>
          <span>No measured data</span>
        </div>
      );
    }
    return (
      <>
        <div className={styles.gradeMeta}>
          <span>Avg {(s.sum / s.n).toFixed(2)} Ah</span>
          <span>{s.min.toFixed(2)}–{s.max.toFixed(2)} Ah</span>
        </div>
        <div className={styles.gradeMeta} style={{ fontSize: "10px", opacity: 0.7 }}>
          <span>Measured</span>
          <span>{s.n}/{s.cells} cells</span>
        </div>
      </>
    );
  };

  const getCardCount = (key) => (key === "ALL" ? data?.total_cells || 0 : data?.grade_counts?.[key] || 0);
  const getCardPct = (key) => (key === "ALL" ? 100 : data?.grade_breakdown?.[key]?.percentage || 0);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={closeModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>🔬</div>
            <div>
              <h2 className={styles.title}>AFTERLIFE INTELLIGENCE — CELL GRADES & PASSPORT INVENTORY</h2>
              <div className={styles.subtitleRow}>
                <span className={styles.subtitle}>API: https://afterlife-int-production.up.railway.app</span>
                <span className={styles.apiStatusPill}>
                  <span className={styles.statusDot} />
                  {data ? `Live Inventory (${data.total_cells} Cells)` : "Connecting..."}
                </span>
                {data?.queried_at && (
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                    Last Queried: {new Date(data.queried_at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={styles.headerActions}>
            <button
              className={styles.refreshBtn}
              onClick={() => fetchInventory(true)}
              disabled={loading}
              title="Query fresh data from Afterlife Intelligence API"
            >
              <span className={loading ? styles.spinning : ""}>🔄</span>
              {loading ? "Querying API..." : "Query Afterlife API"}
            </button>
            <button className={styles.closeBtn} onClick={closeModal}>✕</button>
          </div>
        </div>

        {/* Modal Body Container */}
        <div id="grades-modal-body" className={styles.body}>
          {error && (
            <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#f87171", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", flexShrink: 0 }}>
              ⚠️ {error}
            </div>
          )}

          {data && !inventoryHasMeasuredField && (
            <div style={{ background: "rgba(251, 191, 36, 0.12)", border: "1px solid rgba(251, 191, 36, 0.4)", color: "#fbbf24", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", flexShrink: 0 }}>
              ⚠️ The inventory response has no <code>measured_capacity_ah</code> field yet, so measured capacity shows as
              "Untested" everywhere. Add it to the Afterlife Intelligence inventory query and response model.
            </div>
          )}

          {/* Grade Distribution Summary Ribbon Container */}
          <div className={styles.gradesSection}>
            <div className={styles.gradesSectionHeader}>
              <div className={styles.gradesSectionTitleGroup}>
                <span className={styles.gradesSectionIcon}>🏷️</span>
                <span className={styles.gradesSectionTitle}>Cell Grade Classification & Inventory Tiering</span>
                <span className={styles.gradesCountPill}>
                  {data?.total_cells || 0} Passports
                </span>
              </div>
              {selectedGrade !== "ALL" && (
                <button
                  className={styles.clearGradeFilterBtn}
                  onClick={() => selectGrade("ALL")}
                  title="Clear grade filter and show all"
                >
                  ✕ Clear Grade Filter ({selectedGrade})
                </button>
              )}
            </div>

            <div className={styles.gradesGrid}>
              {GRADE_CARDS.map((card) => {
                const isActive = selectedGrade === card.key;
                const activeClass = card.faulty ? styles.gradeCardActiveFaulty : styles.gradeCardActive;
                return (
                  <div
                    key={card.key}
                    className={`${styles.gradeCard} ${card.faulty ? styles.gradeCardFaulty : ""} ${isActive ? activeClass : ""}`}
                    onClick={() => selectGrade(card.key)}
                  >
                    <div className={styles.gradeCardHeader}>
                      <span className={`${styles.gradeBadge} ${styles[card.badge]}`}>{card.label}</span>
                      <span className={styles.gradePct}>{getCardPct(card.key)}%</span>
                    </div>
                    <div className={styles.gradeCountRow}>
                      <span className={styles.gradeCountNum}>{getCardCount(card.key)}</span>
                      <span className={styles.gradeCountLabel}>{card.countLabel}</span>
                    </div>
                    {renderMeasuredMeta(card.key)}
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.mfrBar}>
            <span className={styles.mfrBarLabel}>
              {selectedGrade === "ALL" ? "All Manufacturers" : selectedGrade === "FAULTY" ? "Faulty Cells Manufacturers" : `Grade ${selectedGrade} Manufacturers`}
            </span>
            <div className={styles.mfrBarPills}>
              <button
                className={`${styles.mfrPill} ${selectedManufacturer === "ALL" ? styles.mfrPillActive : ""}`}
                onClick={() => { setSelectedManufacturer("ALL"); setCurrentPage(1); }}
              >
                All ({filteredCells.length})
              </button>
              {availableManufacturers.map(([mfrName, mfrCount]) => (
                <button
                  key={mfrName}
                  className={`${styles.mfrPill} ${selectedManufacturer === mfrName ? styles.mfrPillActive : ""}`}
                  onClick={() => { setSelectedManufacturer(mfrName); setCurrentPage(1); }}
                >
                  {mfrName} ({mfrCount})
                </button>
              ))}
            </div>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <div style={{ position: "relative", flex: 1, minWidth: "280px" }}>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="🔍 Search by Legacy ID (e.g. 320, #320), Battery Code, Brand..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                />
                {searchQuery && (
                  <button className={styles.clearSearchBtn} onClick={() => { setSearchQuery(""); setCurrentPage(1); }} title="Clear search">
                    ✕
                  </button>
                )}
              </div>

              <select
                className={styles.filterSelect}
                value={selectedGrade}
                onChange={(e) => selectGrade(e.target.value)}
              >
                <option value="ALL">All Grades ({data?.total_cells || 0})</option>
                <option value="A">Grade A ({data?.grade_counts?.A || 0})</option>
                <option value="B">Grade B ({data?.grade_counts?.B || 0})</option>
                <option value="C">Grade C ({data?.grade_counts?.C || 0})</option>
                <option value="D">Grade D ({data?.grade_counts?.D || 0})</option>
                <option value="E">Grade E ({data?.grade_counts?.E || 0})</option>
                <option value="FAULTY">Faulty Cells ({data?.grade_counts?.FAULTY || 0})</option>
                <option value="Ungraded">Ungraded / Intake ({data?.grade_counts?.Ungraded || 0})</option>
              </select>

              <select
                className={styles.filterSelect}
                value={selectedChemistry}
                onChange={(e) => { setSelectedChemistry(e.target.value); setCurrentPage(1); }}
              >
                <option value="ALL">All Chemistries</option>
                {uniqueChemistries.map((chem) => (
                  <option key={chem} value={chem}>{chem}</option>
                ))}
              </select>

              <select
                className={styles.filterSelect}
                value={selectedStatus}
                onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
              >
                <option value="ALL">All States</option>
                <option value="graded">graded ({data?.status_counts?.graded || 0})</option>
                <option value="in_pack">in_pack ({data?.status_counts?.in_pack || 0})</option>
                <option value="deployed">deployed ({data?.status_counts?.deployed || 0})</option>
                <option value="tested">tested ({data?.status_counts?.tested || 0})</option>
                <option value="intake">intake ({data?.status_counts?.intake || 0})</option>
                <option value="faulty">faulty ({data?.status_counts?.faulty || 0})</option>
              </select>
            </div>

            <div className={styles.toolbarRight}>
              <button className={styles.toolBtn} onClick={handleCopyFilteredCodes} title="Copy all matching battery codes">
                📋 Copy ({filteredCells.length})
              </button>
              <button className={styles.toolBtn} onClick={handleExportCSV} title="Export filtered rows to CSV">
                📥 Export CSV
              </button>
            </div>
          </div>

          <div className={styles.tableCard}>
            <div className={styles.tableWrapper} ref={tableWrapperRef}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>GRADE</th>
                    <th>BATTERY CODE</th>
                    <th>LEGACY ID</th>
                    <th>MANUFACTURER & SOURCE</th>
                    <th>CHEMISTRY</th>
                    <th>MEASURED CAP (Ah)</th>
                    <th>OCV (V)</th>
                    <th>DCIR (mΩ)</th>
                    <th>SOH (%)</th>
                    <th>STATUS</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedCells.map((cell, idx) => {
                    const exact = isExactMatch(cell);
                    const measured = getMeasuredCapacity(cell);
                    return (
                      <tr key={`${cell.battery_code}-${idx}`} className={exact ? styles.exactMatchRow : ""}>
                        <td>
                          <span className={`${styles.gradeBadge} ${getBadgeClass(cell.current_grade)}`}>
                            {cell.current_grade === "Ungraded" ? "INTAKE" : cell.current_grade === "FAULTY" ? "FAULTY" : `GRADE ${cell.current_grade}`}
                          </span>
                        </td>
                        <td>
                          <div className={styles.codeCell}>
                            <span className={exact ? styles.exactCodeHighlight : ""}>{cell.battery_code}</span>
                            <button className={styles.copyCodeBtn} onClick={() => handleCopy(cell.battery_code, "Battery Code")} title="Copy Battery Code">
                              📋
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className={`${styles.legacyIdBadge} ${exact ? styles.legacyIdBadgeHighlight : ""}`}>
                            #{cell.legacy_cell_id}
                            {exact && <span className={styles.topMatchPill}>TOP MATCH</span>}
                          </span>
                        </td>
                        <td>
                          <div className={styles.mfrName}>{cell.manufacturer}</div>
                          <div className={styles.mfrBatch}>{cell.raw_source}</div>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", color: "#cbd5e1" }}>
                            {cell.chemistry} ({cell.form_factor})
                          </span>
                        </td>
                        <td>
                          <div>
                            <span
                              className={styles.vitalPill}
                              style={{
                                color: measured === null
                                  ? "#64748b"
                                  : cell.soh_percent != null && cell.soh_percent >= 80 ? "#34d399" : "#fbbf24",
                              }}
                              title={measured === null ? "No capacity test on record" : "Measured in the latest capacity test"}
                            >
                              {measured !== null ? `${measured.toFixed(2)} Ah` : "Untested"}
                            </span>
                            <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>
                              Nom: {cell.nominal_capacity_ah != null ? `${cell.nominal_capacity_ah} Ah` : "--"}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.vitalPill}>
                            {cell.intake_ocv_v != null ? `${cell.intake_ocv_v} V` : "--"}
                          </span>
                        </td>
                        <td>
                          <span className={styles.vitalPill} style={{ color: cell.dcir_mohm && cell.dcir_mohm < 30 ? "#34d399" : "#cbd5e1" }}>
                            {cell.dcir_mohm != null ? `${cell.dcir_mohm} mΩ` : "--"}
                          </span>
                        </td>
                        <td>
                          <span className={styles.vitalPill} style={{ color: cell.soh_percent && cell.soh_percent >= 80 ? "#34d399" : "#fbbf24" }}>
                            {cell.soh_percent != null ? `${cell.soh_percent}%` : "--"}
                          </span>
                        </td>
                        <td>
                          <span className={`${styles.statusTag} ${cell.current_state === "graded" ? styles.statusGraded
                              : cell.current_state === "deployed" ? styles.statusDeployed
                                : cell.current_state === "tested" ? styles.statusTested
                                  : styles.statusIntake
                            }`}>
                            {cell.current_state}
                          </span>
                        </td>
                        <td>
                          <button
                            className={styles.actionBtn}
                            onClick={() => {
                              if (cell.current_grade === "FAULTY") showToast(`⚠️ Warning: Cell #${cell.legacy_cell_id} is marked FAULTY!`);
                              handleCopy(cell.battery_code, "Battery Code");
                              closeModal();
                              setAssemblyModalOpen(true);
                            }}
                            title={cell.current_grade === "FAULTY" ? "Caution: Faulty Cell (Defective)" : "Copy code and open Assembly Map"}
                            style={cell.current_grade === "FAULTY" ? { borderColor: "rgba(239, 68, 68, 0.5)", color: "#f87171" } : {}}
                          >
                            {cell.current_grade === "FAULTY" ? "⚠️ Assign" : "⚙️ Assign"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {paginatedCells.length === 0 && (
                    <tr>
                      <td colSpan={11}>
                        {loading ? (
                          <div className={styles.emptyState}>
                            Querying Afterlife Intelligence API...
                          </div>
                        ) : (
                          <div className={styles.emptyStateDetailed}>
                            <div className={styles.emptyStateIcon}>🔍</div>
                            <div className={styles.emptyStateTitle}>
                              No cells match the current filter combination
                            </div>
                            <div className={styles.emptyStateSubtext}>
                              {selectedGrade !== "ALL" && <span><b>Grade:</b> {selectedGrade} &nbsp;•&nbsp; </span>}
                              {selectedStatus !== "ALL" && <span><b>Status:</b> {selectedStatus} &nbsp;•&nbsp; </span>}
                              {selectedManufacturer !== "ALL" && <span><b>Brand:</b> {selectedManufacturer} &nbsp;•&nbsp; </span>}
                              {selectedChemistry !== "ALL" && <span><b>Chemistry:</b> {selectedChemistry} &nbsp;•&nbsp; </span>}
                              {searchQuery && <span><b>Search:</b> "{searchQuery}"</span>}
                            </div>
                            <button className={styles.emptyStateClearBtn} onClick={resetFilters}>
                              ✕ Clear All Filters
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.footer}>
              <span>
                Showing {filteredCells.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
                {Math.min(currentPage * pageSize, filteredCells.length)} of {filteredCells.length} matching cells (Total Inventory: {data?.total_cells || 0})
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <select
                  className={styles.filterSelect}
                  style={{ padding: "4px 8px", fontSize: "12px" }}
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                >
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                  <option value={500}>All / page</option>
                </select>

                <button
                  className={styles.toolBtn}
                  style={{ padding: "4px 10px" }}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  ◀ Prev
                </button>
                <span style={{ fontWeight: "700", color: "#60a5fa" }}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  className={styles.toolBtn}
                  style={{ padding: "4px 10px" }}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {toastMessage && <div className={styles.copiedToast}>{toastMessage}</div>}
    </div>
  );
};

export default CellGradesModal;