from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class CellTelemetry(BaseModel):
    position: str = Field(..., description="Position string, e.g. S1-P1")
    series: int
    parallel: int
    battery_code: Optional[str] = None
    legacy_cell_id: Optional[str] = None
    voltage_v: float
    temperature_c: float
    dcir_mohm: float
    soh_percent: Optional[float] = None
    soc_percent: Optional[float] = None
    capacity_ah: Optional[float] = None
    nominal_capacity_ah: Optional[float] = None
    measured_capacity_ah: Optional[float] = None
    health_status: str = "green"  # "green", "yellow", "red"
    trigger_metric: Optional[str] = None  # e.g., "dcir_mohm"

class PackSummary(BaseModel):
    total_voltage_v: float
    avg_cell_voltage_v: float
    min_cell_voltage_v: float
    max_cell_voltage_v: float
    voltage_delta_mv: float
    avg_temperature_c: float
    pack_current_a: float = Field(
        ..., description="Signed current: positive while charging, negative while discharging."
    )
    charging_current_limit_a: Optional[float] = None
    is_charging_limit_exceeded: bool = False
    green_count: int
    yellow_count: int
    red_count: int
    # RTE & CE metrics
    operating_mode: Optional[str] = "CHARGING"
    pack_power_w: Optional[float] = 0.0
    cumulative_charge_ah: Optional[float] = 0.0
    cumulative_discharge_ah: Optional[float] = 0.0
    cumulative_charge_wh: Optional[float] = 0.0
    cumulative_discharge_wh: Optional[float] = 0.0
    coulombic_efficiency_pct: Optional[float] = None
    round_trip_efficiency_pct: Optional[float] = None

class TelemetryPayload(BaseModel):
    pack_id: str
    timestamp: str
    pack_current_a: float = Field(
        ..., description="Signed current: positive while charging, negative while discharging."
    )
    pack_voltage_v: float
    balancing_current_a: Optional[float] = None
    remaining_capacity_ah: Optional[float] = None
    bms_protocol: str = "RS485-to-TTL"
    summary: PackSummary
    cells: List[CellTelemetry]
    anomaly_flags: Optional[Dict[str, List[str]]] = None  # Phase 3: position -> list of anomalous metrics

class RawTelemetryPayload(BaseModel):
    pack_id: Optional[str] = "PACK-8S11P-001"
    bms_protocol: Optional[str] = "RS485-to-TTL"
    pack_voltage_v: Optional[float] = None
    pack_current_a: Optional[float] = Field(
        0.0,
        description="Raw BMS current magnitude; the API applies charge/discharge sign to published telemetry.",
    )
    balancing_current_a: Optional[float] = None
    remaining_capacity_ah: Optional[float] = None
    cell_voltages_v: Optional[List[float]] = Field(None, description="Array of 8 series group voltages or 88 cell voltages (V or mV)")
    series_voltages_mv: Optional[List[float]] = Field(None, description="Array of 8 series group voltages directly in mV")
    temperatures_c: Optional[List[float]] = None
    dcir_mohm: Optional[List[float]] = None
    soh_percent: Optional[List[float]] = None
    soc_percent: Optional[float | List[float]] = None
    timestamp: Optional[str] = None

class ObserverCellMetric(BaseModel):
    position: str
    series: int = Field(ge=1, le=8)
    parallel: int = Field(ge=1, le=11)
    manufacturer: Optional[str] = None
    nominal_capacity_ah: Optional[float] = Field(None, gt=0)
    measured_capacity_ah: Optional[float] = Field(None, gt=0)
    dcir_mohm: Optional[float] = Field(None, gt=0)
    soh_percent: Optional[float] = Field(None, ge=0, le=100)

class ObserverCellMetricsRequest(BaseModel):
    pack_id: str = Field(..., min_length=1)
    cells: List[ObserverCellMetric] = Field(..., min_length=1)

import re
from pydantic import BaseModel, Field, model_validator

class SlotAssignmentRequest(BaseModel):
    series: Optional[int] = Field(None, ge=1, le=8)
    parallel: Optional[int] = Field(None, ge=1, le=11)
    position: Optional[str] = None
    battery_code: str

    @model_validator(mode="before")
    @classmethod
    def parse_position_or_coords(cls, data: Any) -> Any:
        if isinstance(data, dict):
            code = data.get("battery_code") or data.get("batteryCode") or data.get("code")
            if code is not None:
                data["battery_code"] = str(code).strip()
            
            pos = data.get("position")
            s = data.get("series")
            p = data.get("parallel")

            if (s is None or p is None) and pos:
                match = re.search(r"S(\d+)-P(\d+)", str(pos), re.IGNORECASE)
                if match:
                    data["series"] = int(match.group(1))
                    data["parallel"] = int(match.group(2))
                else:
                    raise ValueError(f"Invalid position format '{pos}', expected format like 'S1-P1'")
            
            if data.get("series") is None or data.get("parallel") is None:
                raise ValueError("Both 'series' (1-8) and 'parallel' (1-11) or 'position' (e.g. 'S1-P1') are required.")
            
            data["series"] = int(data["series"])
            data["parallel"] = int(data["parallel"])
        return data

class BulkSlotAssignmentRequest(BaseModel):
    mappings: List[SlotAssignmentRequest]


class SlotResponse(BaseModel):
    series: int
    parallel: int
    position: str
    battery_code: Optional[str]
    assigned_at: Optional[str]
    passport_data: Optional[Dict[str, Any]] = None
    legacy_cell_id: Optional[str] = None

class ProgressResponse(BaseModel):
    pack_id: str
    total_slots: int = 88
    assigned_slots: int
    unassigned_slots: int
    completion_percentage: float

class CellSwapRequest(BaseModel):
    position: str = Field(..., description="Position string e.g. S3-P14")
    old_battery_code: str
    new_battery_code: str
    operator: Optional[str] = "Field Technician"
    reason: Optional[str] = "Elevated internal resistance (DCIR)"

class MaintenanceEventResponse(BaseModel):
    id: int
    timestamp: str
    pack_id: str
    position: str
    old_battery_code: str
    new_battery_code: str
    operator: Optional[str]
    reason: Optional[str]
