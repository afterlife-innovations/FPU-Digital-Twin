import os
import csv
import io
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy import insert, select

from app.models import PackAssemblySlot, TelemetryRecord, telemetry_export_table
from app.schemas import TelemetryPayload
from app.database import AsyncSessionLocal
from app.services.passport_client import passport_client

logger = logging.getLogger(__name__)

FLOAT_EXPORT_COLUMNS = {
    "Timestamp_Epoch_s",
    "Delta_Time_s",
    "Pack_Voltage_V",
    "Pack_Current_A",
    "Pack_Current_Abs_A",
    "Charge_Current_A",
    "Discharge_Current_A",
    "Pack_Power_W",
    "Cumulative_Charge_Ah",
    "Cumulative_Discharge_Ah",
    "Cumulative_Charge_Wh",
    "Cumulative_Discharge_Wh",
    "Pack_Avg_Bank_Voltage_V",
    "Pack_Min_Bank_Voltage_V",
    "Pack_Max_Bank_Voltage_V",
    "Pack_Voltage_Delta_mV",
    "Pack_NTC_Temperature_C",
    "Series_Bank_Voltage_V",
    "Series_Bank_Voltage_mV",
    "Cell_Nominal_Capacity_Ah",
    "Cell_Measured_Capacity_Ah",
    "Balancing_Current_A",
    "Remaining_Capacity_Ah",
    "Cell_SOC_Percent",
    "Cell_SOH_Percent",
    "Cell_Estimated_Capacity_Ah",
    "Cell_DCIR_mOhm",
}
INTEGER_EXPORT_COLUMNS = {"Cell_Series", "Cell_Parallel"}

CSV_HEADERS = [
    "Timestamp",
    "Timestamp_Epoch_s",
    "Delta_Time_s",
    "Pack_ID",
    "BMS_Protocol",
    "Operating_Mode",
    "Pack_Voltage_V",
    "Pack_Current_A",
    "Pack_Current_Abs_A",
    "Charge_Current_A",
    "Discharge_Current_A",
    "Pack_Power_W",
    "Cumulative_Charge_Ah",
    "Cumulative_Discharge_Ah",
    "Cumulative_Charge_Wh",
    "Cumulative_Discharge_Wh",
    "Pack_Avg_Bank_Voltage_V",
    "Pack_Min_Bank_Voltage_V",
    "Pack_Max_Bank_Voltage_V",
    "Pack_Voltage_Delta_mV",
    "Pack_NTC_Temperature_C",
    "Telemetry_Measurement_Level",
    "Series_Group",
    "Series_Bank_Voltage_V",
    "Series_Bank_Voltage_mV",
    "Cell_Slot_Position",
    "Cell_Series",
    "Cell_Parallel",
    "Battery_Code",
    "Legacy_Cell_ID",
    "Cell_Nominal_Capacity_Ah",
    "Cell_Measured_Capacity_Ah",
    "Cell_Health_Status",
    "Balancing_Current_A",
    "Remaining_Capacity_Ah",
    "Cell_SOC_Percent",
    "Cell_SOH_Percent",
    "Cell_Estimated_Capacity_Ah",
    "Cell_DCIR_mOhm",
]

class TelemetryLogger:
    def __init__(self, csv_filename: str = "telemetry_export.csv"):
        # Put the CSV log in the backend directory
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.csv_path = os.path.join(backend_dir, csv_filename)
        self._ensure_csv_initialized()

    @staticmethod
    def _database_values_for_csv_row(row: List[Any]) -> Dict[str, Any]:
        if len(row) != len(CSV_HEADERS):
            raise ValueError(
                f"Expected {len(CSV_HEADERS)} telemetry export values, got {len(row)}."
            )

        values = {}
        for column, value in zip(CSV_HEADERS, row):
            if value is None or value == "":
                values[column] = None
            elif column == "Timestamp":
                timestamp = str(value).strip()
                try:
                    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                except ValueError:
                    epoch_s = float(timestamp)
                    if abs(epoch_s) >= 1e12:
                        epoch_s /= 1000.0
                    parsed = datetime.fromtimestamp(epoch_s, timezone.utc)
                values[column] = (
                    parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
                )
            elif column in FLOAT_EXPORT_COLUMNS:
                values[column] = float(value)
            elif column in INTEGER_EXPORT_COLUMNS:
                values[column] = int(float(value))
            else:
                values[column] = str(value)
        return values

    async def _persist_export_rows(self, rows: List[List[Any]]) -> None:
        if not rows:
            return
        values = [self._database_values_for_csv_row(row) for row in rows]
        async with AsyncSessionLocal() as session:
            await session.execute(insert(telemetry_export_table), values)
            await session.commit()

    def _ensure_csv_initialized(self):
        """Create or safely extend the CSV schema while preserving existing rows."""
        try:
            if not os.path.exists(self.csv_path) or os.path.getsize(self.csv_path) == 0:
                with open(self.csv_path, mode="w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow(CSV_HEADERS)
                logger.info(f"Initialized telemetry CSV log file at {self.csv_path}")
                return

            with open(self.csv_path, mode="r", newline="", encoding="utf-8") as source:
                reader = csv.reader(source)
                existing_headers = next(reader, [])
                if existing_headers == CSV_HEADERS:
                    return
                existing_rows = list(reader)
                merged_headers = existing_headers + [
                    header for header in CSV_HEADERS if header not in existing_headers
                ]

            temp_path = f"{self.csv_path}.tmp"
            with open(temp_path, mode="w", newline="", encoding="utf-8") as target:
                writer = csv.writer(target)
                writer.writerow(merged_headers)
                for row in existing_rows:
                    writer.writerow(row + [""] * (len(merged_headers) - len(row)))
            os.replace(temp_path, self.csv_path)
            logger.info(f"Updated telemetry CSV headers at {self.csv_path}")
        except Exception as e:
            logger.error(f"Error initializing CSV log file: {e}")

    async def log_telemetry_snapshot(self, payload: TelemetryPayload):
        """
        Logs a telemetry snapshot to:
        1. The persistent CSV export file (append mode)
        2. The configured database (`telemetry_records` and `telemetry_export`)
        """
        self._ensure_csv_initialized()

        # 1. Fetch assembly mappings and passport metadata
        assigned_slots: Dict[str, str] = {}
        legacy_lookup: Dict[str, str] = {}
        passports_map: Dict[str, Dict[str, Any]] = {}

        try:
            async with AsyncSessionLocal() as session:
                slots_res = await session.execute(
                    select(PackAssemblySlot).where(PackAssemblySlot.pack_id == payload.pack_id)
                )
                assigned_slots = {
                    f"S{s.series}-P{s.parallel}": s.battery_code for s in slots_res.scalars().all()
                }

                # Also insert TelemetryRecord rows in database
                for cell in payload.cells:
                    if cell.soh_percent is None:
                        continue
                    bcode = assigned_slots.get(cell.position) or cell.battery_code
                    record = TelemetryRecord(
                        pack_id=payload.pack_id,
                        position=cell.position,
                        battery_code=bcode,
                        voltage_v=cell.voltage_v,
                        temperature_c=cell.temperature_c,
                        dcir_mohm=cell.dcir_mohm,
                        soh_percent=cell.soh_percent,
                        health_status=cell.health_status,
                    )
                    session.add(record)
                await session.commit()
        except Exception as e:
            logger.error(f"Error persisting telemetry to DB: {e}")

        try:
            legacy_lookup = await passport_client.get_code_to_legacy_map()
            passports_map = await passport_client.get_code_to_passport_map()
        except Exception as e:
            logger.warning(f"Error fetching passport metadata for telemetry logger: {e}")

        # 2. Build rows shared by the CSV file and telemetry_export database table
        try:
            ts = payload.timestamp
            try:
                epoch_s = datetime.fromisoformat(ts).timestamp()
            except Exception:
                epoch_s = datetime.now(timezone.utc).timestamp()

            summary = payload.summary
            mode = getattr(summary, "operating_mode", None) or "CHARGING"
            chg_curr = payload.pack_current_a if mode == "CHARGING" else 0.0
            dis_curr = payload.pack_current_a if mode == "DISCHARGING" else 0.0
            signed_curr = chg_curr - dis_curr

            cum_chg_ah = getattr(summary, "cumulative_charge_ah", None) or 0.0
            cum_dis_ah = getattr(summary, "cumulative_discharge_ah", None) or 0.0
            cum_chg_wh = getattr(summary, "cumulative_charge_wh", None) or 0.0
            cum_dis_wh = getattr(summary, "cumulative_discharge_wh", None) or 0.0
            pwr_w = getattr(summary, "pack_power_w", None) or round(payload.pack_voltage_v * signed_curr, 2)

            rows_to_append = []
            for cell in payload.cells:
                pos = cell.position
                bcode = assigned_slots.get(pos) or cell.battery_code or ""
                leg_id = legacy_lookup.get(bcode) if bcode else ""
                leg_id = leg_id or getattr(cell, "legacy_cell_id", None) or ""
                passport = passports_map.get(bcode, {})
                leg_id = leg_id or (passport.get("legacy_cell_id") if passport else None) or ""
                nom_cap = passport.get("nominal_capacity_ah") if passport else None
                meas_cap = passport.get("measured_capacity_ah") if passport else None

                rows_to_append.append([
                    ts,
                    round(epoch_s, 3),
                    1.0,
                    payload.pack_id,
                    payload.bms_protocol,
                    mode,
                    round(payload.pack_voltage_v, 3),
                    round(signed_curr, 3),
                    round(payload.pack_current_a, 3),
                    round(chg_curr, 3),
                    round(dis_curr, 3),
                    round(pwr_w, 2),
                    round(cum_chg_ah, 4),
                    round(cum_dis_ah, 4),
                    round(cum_chg_wh, 2),
                    round(cum_dis_wh, 2),
                    round(summary.avg_cell_voltage_v, 3),
                    round(summary.min_cell_voltage_v, 3),
                    round(summary.max_cell_voltage_v, 3),
                    round(summary.voltage_delta_mv, 1),
                    round(summary.avg_temperature_c, 1),
                    "8S_SERIES_GROUP_MEASURED",
                    f"S{cell.series}",
                    round(cell.voltage_v, 3),
                    round(cell.voltage_v * 1000.0, 1),
                    cell.position,
                    cell.series,
                    cell.parallel,
                    bcode,
                    leg_id,
                    round(float(nom_cap), 2) if nom_cap is not None else "",
                    round(float(meas_cap), 3) if meas_cap is not None else "",
                    cell.health_status,
                    round(payload.balancing_current_a, 3) if payload.balancing_current_a is not None else "",
                    round(payload.remaining_capacity_ah, 3) if payload.remaining_capacity_ah is not None else "",
                    round(cell.soc_percent, 2) if cell.soc_percent is not None else "",
                    round(cell.soh_percent, 2) if cell.soh_percent is not None else "",
                    round(cell.capacity_ah, 4) if cell.capacity_ah is not None else "",
                    round(cell.dcir_mohm, 2),
                ])

        except Exception as e:
            logger.error(f"Error building telemetry export rows: {e}")
            return

        try:
            await self._persist_export_rows(rows_to_append)
            logger.info("Persisted %d telemetry export rows to telemetry_export.", len(rows_to_append))
        except Exception as e:
            sqlstate = getattr(getattr(e, "orig", None), "sqlstate", None)
            logger.error(
                "Error persisting telemetry_export rows (%s, SQLSTATE %s).",
                type(e).__name__,
                sqlstate or "unavailable",
            )

        try:
            with open(self.csv_path, mode="a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(rows_to_append)
                f.flush()

            logger.info(f"Logged {len(rows_to_append)} rows to telemetry CSV export: {self.csv_path}")
        except Exception as e:
            logger.error(f"Error appending to CSV log file: {e}")

    def get_csv_content(self) -> str:
        """Reads the full persistent CSV file content."""
        self._ensure_csv_initialized()
        try:
            with open(self.csv_path, mode="r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error reading CSV file: {e}")
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(CSV_HEADERS)
            return output.getvalue()

    def get_csv_headers_string(self) -> str:
        """Returns just the CSV headers line."""
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(CSV_HEADERS)
        return output.getvalue()


telemetry_logger = TelemetryLogger()
