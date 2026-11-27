from typing import Any, Dict, List

VOLTAGE_MIN_WARNING_V = 3.0
VOLTAGE_MAX_WARNING_V = 4.2
VOLTAGE_MIN_CRITICAL_V = 2.8
VOLTAGE_MAX_CRITICAL_V = 4.25
VOLTAGE_DRIFT_WARNING_MV = 50.0
TEMPERATURE_WARNING_C = 45.0
TEMPERATURE_CRITICAL_C = 55.0
SOH_ANOMALY_THRESHOLD_PERCENT = 60.0

ANOMALY_THRESHOLDS = {
    "voltage_min_warning_v": VOLTAGE_MIN_WARNING_V,
    "voltage_max_warning_v": VOLTAGE_MAX_WARNING_V,
    "voltage_min_critical_v": VOLTAGE_MIN_CRITICAL_V,
    "voltage_max_critical_v": VOLTAGE_MAX_CRITICAL_V,
    "voltage_drift_warning_mv": VOLTAGE_DRIFT_WARNING_MV,
    "temperature_warning_c": TEMPERATURE_WARNING_C,
    "temperature_critical_c": TEMPERATURE_CRITICAL_C,
    "soh_anomaly_threshold_percent": SOH_ANOMALY_THRESHOLD_PERCENT,
    "dcir_anomaly_detection": False,
}


def evaluate_cell_thresholds(
    cell: Dict[str, Any],
    mean_voltage_v: float | None = None,
) -> tuple[List[str], str, str | None]:
    """Return exact threshold breaches, their display status, and primary metric."""
    breaches: List[str] = []
    status = "green"
    trigger_metric = None

    def add_breach(severity: str, metric: str, message: str) -> None:
        nonlocal status, trigger_metric
        breaches.append(f"{severity}: {message}")
        if severity == "CRITICAL":
            if status != "red":
                trigger_metric = metric
            status = "red"
        elif status == "green":
            status = "yellow"
            trigger_metric = metric

    voltage = cell.get("voltage_v")
    if voltage is not None:
        voltage = float(voltage)
        if voltage < VOLTAGE_MIN_CRITICAL_V:
            add_breach(
                "CRITICAL",
                "voltage_v",
                f"Voltage {voltage:.3f} V is below {VOLTAGE_MIN_CRITICAL_V:.2f} V",
            )
        elif voltage > VOLTAGE_MAX_CRITICAL_V:
            add_breach(
                "CRITICAL",
                "voltage_v",
                f"Voltage {voltage:.3f} V is above {VOLTAGE_MAX_CRITICAL_V:.2f} V",
            )
        elif voltage < VOLTAGE_MIN_WARNING_V:
            add_breach(
                "WARNING",
                "voltage_v",
                f"Voltage {voltage:.3f} V is below {VOLTAGE_MIN_WARNING_V:.2f} V",
            )
        elif voltage > VOLTAGE_MAX_WARNING_V:
            add_breach(
                "WARNING",
                "voltage_v",
                f"Voltage {voltage:.3f} V is above {VOLTAGE_MAX_WARNING_V:.2f} V",
            )

        if mean_voltage_v is not None:
            drift_mv = abs(voltage - mean_voltage_v) * 1000.0
            if drift_mv > VOLTAGE_DRIFT_WARNING_MV:
                add_breach(
                    "WARNING",
                    "voltage_drift",
                    f"Voltage drift {drift_mv:.1f} mV exceeds "
                    f"{VOLTAGE_DRIFT_WARNING_MV:.1f} mV",
                )

    temperature = cell.get("temperature_c")
    if temperature is not None:
        temperature = float(temperature)
        if temperature >= TEMPERATURE_CRITICAL_C:
            add_breach(
                "CRITICAL",
                "temperature_c",
                f"Temperature {temperature:.1f} C is at/above "
                f"{TEMPERATURE_CRITICAL_C:.1f} C",
            )
        elif temperature >= TEMPERATURE_WARNING_C:
            add_breach(
                "WARNING",
                "temperature_c",
                f"Temperature {temperature:.1f} C is at/above "
                f"{TEMPERATURE_WARNING_C:.1f} C",
            )

    soh = cell.get("soh_percent")
    if soh is not None:
        soh = float(soh)
        if soh < SOH_ANOMALY_THRESHOLD_PERCENT:
            add_breach(
                "CRITICAL",
                "soh_percent",
                f"SOH {soh:.1f}% is below {SOH_ANOMALY_THRESHOLD_PERCENT:.1f}%",
            )

    return breaches, status, trigger_metric


def evaluate_cells(
    cells: List[Dict[str, Any]],
) -> tuple[Dict[str, List[str]], Dict[str, str], Dict[str, str | None]]:
    voltages = [
        float(cell["voltage_v"])
        for cell in cells
        if cell.get("voltage_v") is not None
    ]
    mean_voltage_v = sum(voltages) / len(voltages) if voltages else None
    anomalies: Dict[str, List[str]] = {}
    statuses: Dict[str, str] = {}
    triggers: Dict[str, str | None] = {}

    for cell in cells:
        position = cell.get("position", "")
        breaches, status, trigger_metric = evaluate_cell_thresholds(cell, mean_voltage_v)
        if breaches:
            anomalies[position] = breaches
        statuses[position] = status
        triggers[position] = trigger_metric

    return anomalies, statuses, triggers


def detect_anomalies(cells: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """Return exact warning and critical threshold breaches by cell position."""
    anomalies, _, _ = evaluate_cells(cells)
    return anomalies
