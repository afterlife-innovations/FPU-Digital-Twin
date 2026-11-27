from app.services.anomaly import evaluate_cell_thresholds

def calculate_cell_health(
    voltage_v: float,
    temperature_c: float,
    soh_percent: float,
    string_mean_voltage_v: float,
) -> tuple[str, str | None]:
    _, status, trigger_metric = evaluate_cell_thresholds(
        {
            "voltage_v": voltage_v,
            "temperature_c": temperature_c,
            "soh_percent": soh_percent,
        },
        string_mean_voltage_v,
    )
    return status, trigger_metric
