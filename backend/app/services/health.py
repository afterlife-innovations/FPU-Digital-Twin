from app.config import HealthThresholds

def calculate_cell_health(
    voltage_v: float,
    temperature_c: float,
    dcir_mohm: float,
    soh_percent: float,
    string_mean_voltage_v: float,
    t: HealthThresholds
) -> tuple[str, str | None]:
    """
    Evaluates health status for a cell based on configured thresholds.
    Returns a tuple of (status, triggering_metric).
    Status priority: red > yellow > green.
    """
    # Check Red (Critical) conditions first
    if voltage_v < t.voltage_min_yellow or voltage_v > t.voltage_max_yellow:
        return "red", "voltage_v"
    if dcir_mohm >= t.dcir_max_yellow:
        return "red", "dcir_mohm"
    if soh_percent < t.soh_min_yellow:
        return "red", "soh_percent"
    if temperature_c >= t.temp_max_yellow:
        return "red", "temperature_c"

    # Check Yellow (Warning) conditions
    drift_mv = abs(voltage_v - string_mean_voltage_v) * 1000.0
    if drift_mv > t.voltage_drift_yellow_mv:
        return "yellow", "voltage_drift"
    if dcir_mohm >= t.dcir_max_green:
        return "yellow", "dcir_mohm"
    if soh_percent < t.soh_min_green:
        return "yellow", "soh_percent"
    if temperature_c >= t.temp_max_green:
        return "yellow", "temperature_c"

    return "green", None
