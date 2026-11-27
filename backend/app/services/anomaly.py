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

    available_voltages = [
        float(cell["voltage_v"])
        for cell in cells
        if cell.get("voltage_v") is not None
    ]
    mean_voltage = (
        sum(available_voltages) / len(available_voltages)
        if available_voltages
        else None
    )

    def health_warning_alerts(cell: Dict[str, Any]) -> List[str]:
        status = cell.get("health_status")
        if status not in {"yellow", "red"}:
            return []

        warnings = []
        voltage = cell.get("voltage_v")
        temperature = cell.get("temperature_c")

        if voltage is not None:
            voltage = float(voltage)
            if voltage < thresholds.voltage_min_yellow or voltage > thresholds.voltage_max_yellow:
                warnings.append(
                    f"Voltage {voltage:.3f}V outside critical range "
                    f"{thresholds.voltage_min_yellow:g}-{thresholds.voltage_max_yellow:g}V"
                )
            elif mean_voltage is not None:
                drift_mv = abs(voltage - mean_voltage) * 1000.0
                if drift_mv > thresholds.voltage_drift_yellow_mv:
                    warnings.append(
                        f"Voltage drift {drift_mv:.1f}mV exceeds "
                        f"{thresholds.voltage_drift_yellow_mv:g}mV"
                    )

        if temperature is not None:
            temperature = float(temperature)
            if temperature >= thresholds.temp_max_yellow:
                if not threshold_alert("temperature_c", temperature):
                    warnings.append(
                        f"Temperature {temperature:.1f}C exceeds critical limit "
                        f"{thresholds.temp_max_yellow:g}C"
                    )
            elif temperature >= thresholds.temp_max_green:
                if not threshold_alert("temperature_c", temperature):
                    warnings.append(
                        f"Temperature {temperature:.1f}C exceeds warning limit "
                        f"{thresholds.temp_max_green:g}C"
                    )

        return warnings

    # Group cells by series
    series_groups: Dict[int, List[Dict[str, Any]]] = {}
    for cell in cells:
        s = cell.get("series", 1)
        series_groups.setdefault(s, []).append(cell)

    for group in series_groups.values():
        for cell in group:
            position = cell.get("position", "")
            for warning in health_warning_alerts(cell):
                anomalies.setdefault(position, []).append(warning)

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
