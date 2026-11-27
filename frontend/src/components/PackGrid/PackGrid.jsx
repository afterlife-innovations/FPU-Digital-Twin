import React, { useRef, useCallback, useState } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { Pack3DView } from "./Pack3DView";
import styles from "./PackGrid.module.css";
import { getCellDisplayStatus } from "./cellDisplayStatus";

// Helper color function for 2D mode
function get2DCellColor(cellData, position, anomalyFlags) {
  const status = getCellDisplayStatus(cellData, position, anomalyFlags);
  if (!status) {
    return { fill: "#334155", stroke: "#475569" };
  }
  if (status === "red") {
    return { fill: "#FF0000", stroke: "#FF0000" };
  }
  if (status === "yellow") {
    return { fill: "#FFFF00", stroke: "#FFFF00" };
  }
  return { fill: "#008000", stroke: "#008000" };
}

// Grid layout constants
const SERIES_COUNT = 8;
const PARALLEL_COUNT = 11;
const CELL_W = 44;
const CELL_H = 44;
const GAP_X = 14;
const GAP_Y = 16;
const PAD_LEFT = 56;
const PAD_TOP = 44;
const SVG_W = PAD_LEFT + PARALLEL_COUNT * (CELL_W + GAP_X) + 20;
const SVG_H = PAD_TOP + SERIES_COUNT * (CELL_H + GAP_Y) + 30;

export const PackGrid = () => {
  const cells = useTelemetryStore((state) => state.cells);
  const assemblyMap = useTelemetryStore((state) => state.assemblyMap);
  const selectedPosition = useTelemetryStore((state) => state.selectedPosition);
  const setSelectedPosition = useTelemetryStore((state) => state.setSelectedPosition);
  const setHoveredCell = useTelemetryStore((state) => state.setHoveredCell);
  const clearHoveredCell = useTelemetryStore((state) => state.clearHoveredCell);
  const viewMode = useTelemetryStore((state) => state.viewMode);
  const setViewMode = useTelemetryStore((state) => state.setViewMode);
  const anomalyFlags = useTelemetryStore((state) => state.anomalyFlags);
  const legacyMap = useTelemetryStore((state) => state.legacyMap) || {};

  const [hoveredPosition, setHoveredPositionLocal] = useState(null);
  const svgRef = useRef(null);

  const handlePointerHover = useCallback(
    (e, pos, cellData) => {
      setHoveredPositionLocal(pos);
      setHoveredCell(pos, cellData, { x: e.clientX, y: e.clientY });
    },
    [setHoveredCell]
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredPositionLocal(null);
    clearHoveredCell();
  }, [clearHoveredCell]);

  const handleSvgLeave = useCallback((e) => {
    if (!e.relatedTarget || !svgRef.current?.contains(e.relatedTarget)) {
      setHoveredPositionLocal(null);
      clearHoveredCell();
    }
  }, [clearHoveredCell]);

  const handleCellClick = useCallback((pos) => {
    setSelectedPosition(pos);
  }, [setSelectedPosition]);

  return (
    <div className={styles.gridContainer} style={{ position: "relative" }}>
      {/* Control Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.leftToolbar}>
          <h2 className={styles.gridTitle}>8S11P SPATIAL MATRIX RENDER (88 CELLS)</h2>
        </div>

        <div className={styles.rightToolbar}>
          {/* View Mode Toggle */}
          <div className={styles.toggleGroup}>
            <button
              className={`${styles.toggleBtn} ${viewMode === "2d" ? styles.toggleActive : ""}`}
              onClick={() => setViewMode("2d")}
            >
              2D SVG Grid
            </button>
            <button
              className={`${styles.toggleBtn} ${viewMode === "3d" ? styles.toggleActive : ""}`}
              onClick={() => setViewMode("3d")}
            >
              3D WebGL Model
            </button>
          </div>

        </div>
      </div>

      {/* View Switcher */}
      {viewMode === "3d" ? (
        <Pack3DView />
      ) : (
        <div className={styles.svgWrapper} onMouseLeave={handleSvgLeave}>
          <svg
            ref={svgRef}
            width={SVG_W}
            height={SVG_H}
            className={styles.svgGrid}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          >
            {/* Parallel Axis Labels (P1 to P11) */}
            {Array.from({ length: PARALLEL_COUNT }, (_, pIdx) => {
              const pNum = pIdx + 1;
              const x = PAD_LEFT + pIdx * (CELL_W + GAP_X) + CELL_W / 2;
              return (
                <text
                  key={`p-label-${pNum}`}
                  x={x}
                  y={24}
                  className={styles.axisLabel}
                  textAnchor="middle"
                >
                  P{pNum}
                </text>
              );
            })}

            {/* Series Groups (S1 to S8) */}
            {Array.from({ length: SERIES_COUNT }, (_, sIdx) => {
              const sNum = sIdx + 1;
              const y = PAD_TOP + sIdx * (CELL_H + GAP_Y) + CELL_H / 2;

              return (
                <g key={`series-group-${sNum}`}>
                  {/* Series Axis Label */}
                  <text
                    x={24}
                    y={y + 5}
                    className={styles.axisLabel}
                    textAnchor="middle"
                  >
                    S{sNum}
                  </text>

                  {/* 11 Parallel Cells */}
                  {Array.from({ length: PARALLEL_COUNT }, (_, pIdx) => {
                    const pNum = pIdx + 1;
                    const pos = `S${sNum}-P${pNum}`;
                    const cellData = cells[pos] || {
                      position: pos,
                      series: sNum,
                      parallel: pNum,
                    };

                    const assignedCode = assemblyMap[pos];
                    const isAssigned = !!assignedCode;
                    const isSelected = selectedPosition === pos;
                    const isHovered = hoveredPosition === pos;

                    const cx = PAD_LEFT + pIdx * (CELL_W + GAP_X);
                    const cy = PAD_TOP + sIdx * (CELL_H + GAP_Y);

                    const colors = get2DCellColor(cellData, pos, anomalyFlags);

                    return (
                      <g
                        key={pos}
                        transform={`translate(${cx}, ${cy})`}
                        className={`${styles.cellGroup} ${isSelected ? styles.cellSelected : ""}`}
                        onPointerEnter={(e) =>
                          handlePointerHover(e, pos, {
                            ...cellData,
                            battery_code: assignedCode,
                            legacy_cell_id: legacyMap[pos] || null,
                          })
                        }
                        onPointerMove={(e) =>
                          handlePointerHover(e, pos, {
                            ...cellData,
                            battery_code: assignedCode,
                            legacy_cell_id: legacyMap[pos] || null,
                          })
                        }
                        onPointerLeave={() => handlePointerLeave(pos)}
                        onClick={() => handleCellClick(pos)}
                      >
                        <rect
                          x={0}
                          y={0}
                          width={CELL_W}
                          height={CELL_H}
                          rx={10}
                          ry={10}
                          fill={colors.fill}
                          stroke={colors.stroke}
                          strokeWidth={isSelected ? 3.5 : 2}
                          className={styles.cellBody}
                        />

                        <circle
                          cx={CELL_W / 2}
                          cy={CELL_H / 2}
                          r={7}
                          fill="rgba(255, 255, 255, 0.3)"
                          stroke="rgba(255, 255, 255, 0.5)"
                          strokeWidth={1}
                        />

                        {/* React-controlled hover highlight (replaces CSS transform: scale) */}
                        {isHovered && (
                          <rect
                            x={-4}
                            y={-4}
                            width={CELL_W + 8}
                            height={CELL_H + 8}
                            rx={13}
                            ry={13}
                            fill="none"
                            stroke="rgba(96, 165, 250, 0.7)"
                            strokeWidth={2}
                            className={styles.hoverHighlight}
                          />
                        )}

                        {isSelected && (
                          <rect
                            x={-5}
                            y={-5}
                            width={CELL_W + 10}
                            height={CELL_H + 10}
                            rx={14}
                            ry={14}
                            fill="none"
                            stroke="#60a5fa"
                            strokeWidth={2.5}
                            className={styles.glowRect}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
};

export default PackGrid;
