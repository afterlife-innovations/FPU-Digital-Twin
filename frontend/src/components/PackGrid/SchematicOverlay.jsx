import React from "react";
import styles from "./SchematicOverlay.module.css";

export const SchematicOverlay = () => {
  const seriesCount = 8;
  const parallelCount = 11;

  // Generate SVG lines for parallel links & series connections
  const seriesLines = [];
  const parallelBusbars = [];

  for (let s = 1; s <= seriesCount; s++) {
    parallelBusbars.push(
      <rect
        key={`busbar-${s}`}
        x="20"
        y={s * 70 - 15}
        width="480"
        height="6"
        rx="3"
        className={styles.busbarLine}
      />
    );
  }

  for (let s = 1; s < seriesCount; s++) {
    seriesLines.push(
      <line
        key={`series-${s}`}
        x1="500"
        y1={s * 70 - 12}
        x2="20"
        y2={(s + 1) * 70 - 12}
        className={styles.seriesJumperLine}
      />
    );
  }

  return (
    <div className={styles.overlayContainer}>
      <svg viewBox="0 0 520 580" className={styles.schematicSvg}>
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Busbars (Parallel Links) */}
        {parallelBusbars}

        {/* Series Connection Jumpers */}
        {seriesLines}

        {/* Series Group Labels */}
        {Array.from({ length: seriesCount }).map((_, idx) => (
          <text key={idx} x="4" y={(idx + 1) * 70 - 8} className={styles.labelText}>
            S{idx + 1}
          </text>
        ))}
      </svg>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.busbarBox} /> Parallel Copper Busbar (11P)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.seriesBox} /> Series Inter-Group Bridge Link (8S)
        </span>
      </div>
    </div>
  );
};

export default SchematicOverlay;
