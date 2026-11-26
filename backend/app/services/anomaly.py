"""
Phase 3: 2-Sigma Anomaly Detection Engine (FR-8.4)

Analyzes each telemetry snapshot for health-threshold violations and metrics
that deviate more than 2 standard deviations from their series-group mean.
"""
import math
import logging
from typing import Dict, List, Any
from app.config import HealthThresholds, thresholds as default_thresholds

logger = logging.getLogger(__name__)
SOH_ANOMALY_THRESHOLD_PERCENT = 60.0

def detect_anomalies(
    cells: List[Dict[str, Any]],
    thresholds: HealthThresholds = default_thresholds,
) -> Dict[str, List[str]]:
    """
    Return position -> readable threshold alerts and 2-sigma outlier details.

    Uses per-series-group statistics so each S-group is compared
    against its own parallel-cell population.
    """
    anomalies: Dict[str, List[str]] = {}
    metric_labels = {
        "temperature_c": "Temperature",
        "soh_percent": "SOH",
    }

    def threshold_alert(metric: str, value: float) -> str | None:
        if metric == "temperature_c" and value > thresholds.temp_max_green:
            return f"Temperature >{thresholds.temp_max_green:g}C by {value - thresholds.temp_max_green:.1f}C"
        if metric == "soh_percent" and value < SOH_ANOMALY_THRESHOLD_PERCENT:
            return (
                f"SOH <{SOH_ANOMALY_THRESHOLD_PERCENT:g}% by "
                f"{SOH_ANOMALY_THRESHOLD_PERCENT - value:.1f}%"
            )
        return None

    # Group cells by series
    series_groups: Dict[int, List[Dict[str, Any]]] = {}
    for cell in cells:
        s = cell.get("series", 1)
        series_groups.setdefault(s, []).append(cell)

    for group in series_groups.values():
        for metric, label in metric_labels.items():
            available_cells = [
                (cell, float(cell[metric]))
                for cell in group
                if cell.get(metric) is not None
            ]
            for cell, value in available_cells:
                alert = threshold_alert(metric, value)
                if alert:
                    anomalies.setdefault(cell.get("position", ""), []).append(alert)

            if len(available_cells) < 3:
                continue
            values = [value for _, value in available_cells]
            n = len(values)
            mean = sum(values) / n
            variance = sum((v - mean) ** 2 for v in values) / n
            std_dev = math.sqrt(variance) if variance > 0 else 0.0

            if std_dev < 1e-3:
                continue

            for cell, val in available_cells:
                pos = cell.get("position", "")
                difference = val - mean
                z_score = abs(difference) / std_dev

                if z_score > 2.0 and not threshold_alert(metric, val):
                    direction = "above" if difference > 0 else "below"
                    message = (
                        f"{label} {val:.1f} is {z_score:.1f}σ {direction} "
                        f"series mean ({mean:.1f})"
                    )
                    anomalies.setdefault(pos, []).append(message)
                    logger.debug(
                        "Anomaly: %s %s", pos, message
                    )

    return anomalies
