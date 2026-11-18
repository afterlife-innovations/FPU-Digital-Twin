import asyncio
import secrets
from fastapi import APIRouter, HTTPException, Query, Depends, Header
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import io
import csv
from datetime import datetime, timezone
from typing import Dict, Any

from app.config import thresholds, settings
from app.schemas import (
    TelemetryPayload,
    RawTelemetryPayload,
    CellTelemetry,
    PackSummary,
    ObserverCellMetricsRequest,
)
from app.services.health import calculate_cell_health
from app.services.telemetry_store import telemetry_store
from app.services.telemetry_logger import telemetry_logger
from app.services.passport_client import passport_client
from app.services.anomaly import detect_anomalies
from app.services.alert_notifications import dispatch_new_anomalies
from app.database import get_db
from app.models import PackAssemblySlot, TelemetryRecord
from app.services.pack_observer import PackObserver, load_cell_metrics

router = APIRouter(prefix="/telemetry", tags=["Telemetry"])


# ─────────────────────────────────────────────────────────────────────────────
# Socket.IO server reference — set during app startup so the ingest endpoint
# can broadcast to connected clients.
# ─────────────────────────────────────────────────────────────────────────────
_sio_server = None
_observer_cell_metrics_by_pack = {}
_pack_observers = {}
_last_pack_voltage_by_pack = {}
_pack_operating_modes = {}
_pack_observer_lock = asyncio.Lock()
_PACK_VOLTAGE_DIRECTION_DEADBAND_V = 0.01
_LEGACY_MODBUS_PROTOCOL_NAMES = {"RS485_MODBUS", "RS485_JK_BMS", "RS485_JK_MODBUS"}


def _normalize_bms_protocol(protocol: str | None) -> str:
    if protocol is None or protocol.strip().upper() in _LEGACY_MODBUS_PROTOCOL_NAMES:
        return "RS485-to-TTL"
    return protocol


def _infer_operating_mode(pack_id: str, pack_voltage_v: float) -> str:
    previous_voltage = _last_pack_voltage_by_pack.get(pack_id)
    operating_mode = _pack_operating_modes.get(pack_id, "IDLE")
    if previous_voltage is not None:
        voltage_change = pack_voltage_v - previous_voltage
        if voltage_change < -_PACK_VOLTAGE_DIRECTION_DEADBAND_V:
            operating_mode = "DISCHARGING"
        elif voltage_change > _PACK_VOLTAGE_DIRECTION_DEADBAND_V:
            operating_mode = "CHARGING"
    _last_pack_voltage_by_pack[pack_id] = pack_voltage_v
    _pack_operating_modes[pack_id] = operating_mode
    return operating_mode


def register_sio(sio):
    """Called from main.py to share the Socket.IO server with this router."""
    global _sio_server
    _sio_server = sio


async def _load_assigned_cell_metrics(pack_id: str, db: AsyncSession):
    result = await db.execute(
        select(PackAssemblySlot).where(PackAssemblySlot.pack_id == pack_id)
    )
    slots = result.scalars().all()
    if not slots:
        return load_cell_metrics()

    passports = await passport_client.get_code_to_passport_map()
    cell_parameters = []
    for slot in slots:
        passport = passports.get(slot.battery_code, {})
        cell_parameters.append({
            "position": slot.position,
            "series": slot.series,
            "parallel": slot.parallel,
            "nominal_capacity_ah": passport.get("nominal_capacity_ah") or passport.get("nominal_capacity"),
            "measured_capacity_ah": passport.get("measured_capacity_ah"),
            "dcir_mohm": passport.get("dcir_mohm"),
            "soh_percent": passport.get("soh_percent"),
        })
    return load_cell_metrics(cell_parameters)


@router.post("/observer/cell-metrics")
async def configure_observer_cell_metrics(request: ObserverCellMetricsRequest):
    """Apply passport metrics from the Assembly Map's Pull Current Map action."""
    positions = [(cell.series, cell.parallel) for cell in request.cells]
    if len(positions) != len(set(positions)):
        raise HTTPException(status_code=400, detail="Cell metrics contain duplicate assembly positions.")

    metrics = [cell.model_dump() for cell in request.cells]
    cell_matrix = load_cell_metrics(metrics)
    async with _pack_observer_lock:
        _observer_cell_metrics_by_pack[request.pack_id] = cell_matrix
        _pack_observers[request.pack_id] = PackObserver(cell_matrix)

    populated_metrics = sum(
        any(value is not None for value in (
            cell.nominal_capacity_ah,
            cell.measured_capacity_ah,
            cell.dcir_mohm,
            cell.soh_percent,
        ))
        for cell in request.cells
    )
    return {
        "status": "configured",
        "pack_id": request.pack_id,
        "mapped_cells": len(request.cells),
        "cells_with_passport_metrics": populated_metrics,
    }


# ─────────────────────────────────────────────────────────────────────────────
# REST Polling & Live Ingest
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/latest", response_model=TelemetryPayload)
async def get_latest_telemetry():
    """
    REST polling fallback endpoint (FR-2.9).
    Returns the latest telemetry snapshot.
    """
    payload = await telemetry_store.get_latest()
    if not payload:
        raise HTTPException(status_code=503, detail="Telemetry data not available yet — no live data received.")
    return payload


@router.post("/ingest")
async def ingest_telemetry(payload: TelemetryPayload):
    """
    Live telemetry ingestion endpoint.

    Accepts a full TelemetryPayload from the BMS hardware bridge,
    persists it in the telemetry store, and broadcasts it to all
    connected Socket.IO clients in real-time.

    Usage:
        POST /telemetry/ingest
        Content-Type: application/json
        Body: { ...TelemetryPayload... }
    """
    payload.bms_protocol = _normalize_bms_protocol(payload.bms_protocol)
    if payload.anomaly_flags is None:
        payload.anomaly_flags = detect_anomalies(
            [cell.model_dump() for cell in payload.cells],
            thresholds=thresholds,
        )
    await telemetry_store.update(payload)
    await telemetry_logger.log_telemetry_snapshot(payload)
    await dispatch_new_anomalies(
        payload.pack_id, payload.timestamp, payload.anomaly_flags or {}
    )

    # Broadcast to all connected Socket.IO clients
    if _sio_server:
        await _sio_server.emit("telemetry", payload.model_dump(mode="json"))

    return {
        "status": "ok",
        "timestamp": payload.timestamp,
        "cells_received": len(payload.cells),
        "pack_id": payload.pack_id,
    }


@router.post("/ingest/raw")
async def ingest_raw_telemetry(
    raw: RawTelemetryPayload,
    api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
):
    """
    Lightweight raw telemetry ingestion endpoint for ESP32 microcontrollers or serial bridges.

    Accepts raw voltage, current, and temperature arrays and automatically builds
    the full 88-cell 8S11P matrix, computes cell health (green/yellow/red),
    pack aggregates, and broadcasts live to connected WebGL/UI clients.

    Usage from ESP32:
        POST /telemetry/ingest/raw
        Content-Type: application/json
        Body: {
            "pack_voltage_v": 29.6,
            "pack_current_a": 1.2,
            "cell_voltages_v": [3.71, 3.70, 3.72, ...] // 88 cell voltages or 8 series string voltages
        }
    """
    if not settings.twin_api_key:
        raise HTTPException(
            status_code=503,
            detail="Raw telemetry ingestion is not configured.",
        )
    if not api_key or not secrets.compare_digest(api_key, settings.twin_api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing API key.")

    now_iso = raw.timestamp or datetime.now(timezone.utc).isoformat()
    pack_id = raw.pack_id or settings.pack_id
    bms_protocol = _normalize_bms_protocol(raw.bms_protocol)

    v_raw = raw.series_voltages_mv if raw.series_voltages_mv else raw.cell_voltages_v
    if not v_raw:
        raise HTTPException(status_code=400, detail="Either cell_voltages_v or series_voltages_mv must be provided")

    # Convert to Volts if given in mV (e.g. 3492 -> 3.492)
    v_list = [(v / 1000.0 if v > 100.0 else v) for v in v_raw]
    num_v = len(v_list)

    cells = []
    voltages = []
    temps = []
    green_cnt, yellow_cnt, red_cnt = 0, 0, 0

    # Accept either one voltage per series bank or per-cell measurements.
    if num_v >= settings.total_cells:
        series_voltages = [
            sum(v_list[(s - 1) * settings.parallel_count:s * settings.parallel_count])
            / settings.parallel_count
            for s in range(1, settings.series_count + 1)
        ]
    else:
        series_voltages = [
            v_list[s - 1] if s - 1 < num_v else 3.7
            for s in range(1, settings.series_count + 1)
        ]
    avg_string_v = sum(series_voltages) / len(series_voltages)

    # Temperatures from NTC probes
    ntc_temps = raw.temperatures_c or []
    avg_temp = round(sum(ntc_temps) / len(ntc_temps), 1) if ntc_temps else 25.0
    try:
        observer_ts = datetime.fromisoformat(now_iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        observer_ts = datetime.now(timezone.utc).timestamp()
    pack_current = abs(raw.pack_current_a or 0.0)
    balancing_current = raw.balancing_current_a or 0.0
    if pack_id not in _observer_cell_metrics_by_pack:
        loaded_metrics = await _load_assigned_cell_metrics(pack_id, db)
        async with _pack_observer_lock:
            if pack_id not in _observer_cell_metrics_by_pack:
                _observer_cell_metrics_by_pack[pack_id] = loaded_metrics
                _pack_observers[pack_id] = PackObserver(loaded_metrics)

    async with _pack_observer_lock:
        observer_cell_metrics = _observer_cell_metrics_by_pack.get(pack_id)
        if observer_cell_metrics is None:
            observer_cell_metrics = load_cell_metrics()
            _observer_cell_metrics_by_pack[pack_id] = observer_cell_metrics
        pack_observer = _pack_observers.get(pack_id)
        if pack_observer is None:
            pack_observer = PackObserver(observer_cell_metrics)
            _pack_observers[pack_id] = pack_observer
        observed_pack_voltage = (
            raw.pack_voltage_v
            if raw.pack_voltage_v is not None
            else sum(series_voltages)
        )
        operating_mode = _infer_operating_mode(pack_id, observed_pack_voltage)
        balance_on = abs(balancing_current) >= pack_observer.p.bal_on_a
        observer_result = pack_observer.ingest(
            observer_ts,
            series_voltages,
            pack_current,
            ntc_temps or [25.0],
            balance_on,
            raw.remaining_capacity_ah,
            operating_mode=operating_mode,
        )
        observer_current = observer_result["i_pack_discharge_pos"]

    for s in range(1, settings.series_count + 1):  # 1..8
        bank_v = series_voltages[s - 1]
        for p in range(1, settings.parallel_count + 1):  # 1..11
            pos = f"S{s}-P{p}"
            cell_index = p - 1
            observer_bank = observer_result["banks"][s - 1]
            passport_cell = observer_cell_metrics[s - 1][cell_index]
            v_val = bank_v

            # Pack ambient / NTC temperature for the cell slot
            t_val = avg_temp

            dcir_val = passport_cell.dcir_ohm * 1000.0
            soh_val = observer_bank["cell_soh_pct"][cell_index]
            soc_val = observer_bank["cell_soc_pct"][cell_index]
            capacity_val = observer_bank["cell_capacity_ah"][cell_index]

            voltages.append(v_val)
            temps.append(t_val)

            # Evaluate cell health
            status, trigger = calculate_cell_health(
                voltage_v=v_val,
                temperature_c=t_val,
                dcir_mohm=dcir_val,
                soh_percent=soh_val,
                string_mean_voltage_v=avg_string_v,
                t=thresholds
            )

            if status == "green":
                green_cnt += 1
            elif status == "yellow":
                yellow_cnt += 1
            else:
                red_cnt += 1

            cells.append(CellTelemetry(
                position=pos,
                series=s,
                parallel=p,
                voltage_v=round(v_val, 3),
                temperature_c=round(t_val, 1),
                dcir_mohm=round(dcir_val, 1),
                soh_percent=round(soh_val, 1) if passport_cell.has_soh_baseline else None,
                soc_percent=round(soc_val, 1),
                capacity_ah=round(capacity_val, 3) if passport_cell.has_capacity_baseline else None,
                nominal_capacity_ah=(
                    passport_cell.nominal_ah if passport_cell.has_nominal_capacity else None
                ),
                measured_capacity_ah=passport_cell.measured_ah,
                health_status=status,
                trigger_metric=trigger
            ))

    # Aggregates across the 8 series banks
    avg_v = sum(series_voltages) / len(series_voltages)
    min_v = min(series_voltages)
    max_v = max(series_voltages)
    v_delta_mv = round((max_v - min_v) * 1000.0, 1)
    total_v = raw.pack_voltage_v if raw.pack_voltage_v is not None else round(sum(series_voltages), 2)
    summary = PackSummary(
        total_voltage_v=round(total_v, 2),
        avg_cell_voltage_v=round(avg_v, 3),
        min_cell_voltage_v=round(min_v, 3),
        max_cell_voltage_v=round(max_v, 3),
        voltage_delta_mv=v_delta_mv,
        avg_temperature_c=round(avg_temp, 1),
        pack_current_a=round(abs(pack_current), 2),
        charging_current_limit_a=None,
        is_charging_limit_exceeded=False,
        green_count=green_cnt,
        yellow_count=yellow_cnt,
        red_count=red_cnt,
        operating_mode=operating_mode,
        pack_power_w=round(total_v * observer_current, 2)
    )

    payload = TelemetryPayload(
        pack_id=pack_id,
        timestamp=now_iso,
        pack_current_a=round(abs(pack_current), 2),
        pack_voltage_v=round(total_v, 2),
        balancing_current_a=round(balancing_current, 3),
        remaining_capacity_ah=raw.remaining_capacity_ah,
        bms_protocol=bms_protocol,
        summary=summary,
        cells=cells,
        anomaly_flags=detect_anomalies(
            [cell.model_dump() for cell in cells],
            thresholds=thresholds,
        )
    )

    await telemetry_store.update(payload)
    await telemetry_logger.log_telemetry_snapshot(payload)
    await dispatch_new_anomalies(
        payload.pack_id, payload.timestamp, payload.anomaly_flags or {}
    )

    if _sio_server:
        await _sio_server.emit("telemetry", payload.model_dump(mode="json"))

    return {
        "status": "ok",
        "pack_id": pack_id,
        "cells_processed": len(cells),
        "total_voltage_v": round(total_v, 2),
        "voltage_delta_mv": v_delta_mv,
        "health": {"green": green_cnt, "yellow": yellow_cnt, "red": red_cnt}
    }


# ─────────────────────────────────────────────────────────────────────────────
# Cell History (from stored telemetry snapshots)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/history/{position}")
async def get_cell_telemetry_history(
    position: str,
    window: str = Query("1h", description="Time window: 1h, 24h, 7d, 30d, all"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns time-series historical telemetry for an individual cell position (FR-8.2).
    Data is sourced from the in-memory rolling history buffer with fallback to persisted DB records.
    """
    history_snapshots = await telemetry_store.get_history()

    datapoints = []
    if history_snapshots:
        for snap in history_snapshots:
            for cell in snap.cells:
                if cell.position == position:
                    datapoints.append({
                        "timestamp": snap.timestamp,
                        "voltage_v": round(cell.voltage_v, 3),
                        "temperature_c": round(cell.temperature_c, 1),
                        "dcir_mohm": round(cell.dcir_mohm, 1),
                        "soh_percent": (
                            round(cell.soh_percent, 1)
                            if cell.soh_percent is not None else None
                        ),
                    })
                    break
    else:
        try:
            res = await db.execute(
                select(TelemetryRecord).where(
                    TelemetryRecord.position == position
                ).order_by(TelemetryRecord.timestamp.asc()).limit(120)
            )
            for r in res.scalars().all():
                datapoints.append({
                    "timestamp": r.timestamp.isoformat() if hasattr(r.timestamp, "isoformat") else str(r.timestamp),
                    "voltage_v": round(r.voltage_v, 3),
                    "temperature_c": round(r.temperature_c, 1),
                    "dcir_mohm": round(r.dcir_mohm, 1),
                    "soh_percent": round(r.soh_percent, 1),
                })
        except Exception:
            pass

    return {
        "position": position,
        "window": window,
        "datapoints": datapoints,
        "message": "Telemetry history loaded" if datapoints else "No historical data available yet — awaiting live telemetry."
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pack Trends (from live data)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/trends")
async def get_pack_trends():
    """
    Returns aggregate pack-level trend metrics (FR-8.3).
    """
    latest = await telemetry_store.get_latest()
    if not latest:
        return {
            "pack_id": settings.pack_id,
            "pack_voltage_v": None,
            "pack_current_a": None,
            "avg_temperature_c": None,
            "voltage_delta_mv": None,
            "message": "No live data received yet."
        }
    return {
        "pack_id": settings.pack_id,
        "pack_voltage_v": latest.pack_voltage_v,
        "pack_current_a": latest.pack_current_a,
        "avg_temperature_c": latest.summary.avg_temperature_c,
        "voltage_delta_mv": latest.summary.voltage_delta_mv,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Health Thresholds Config
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/config/thresholds")
async def get_health_thresholds():
    """
    Returns configured health thresholds and pack parameters.
    """
    return {
        "thresholds": thresholds.model_dump(),
        "pack_config": {
            "pack_id": settings.pack_id,
            "series_count": settings.series_count,
            "parallel_count": settings.parallel_count,
            "total_cells": settings.total_cells,
            "charging_current_limit_a": None
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# Anomaly Flags
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/anomalies")
async def get_pack_anomalies():
    """
    FR-8.4: Returns cells flagged by 2-sigma deviation engine in the current telemetry snapshot.
    """
    latest = await telemetry_store.get_latest()
    if not latest or not latest.anomaly_flags:
        return {"anomaly_count": 0, "anomalies": {}}

    return {
        "pack_id": latest.pack_id,
        "timestamp": latest.timestamp,
        "anomaly_count": len(latest.anomaly_flags),
        "anomalies": latest.anomaly_flags
    }


# ─────────────────────────────────────────────────────────────────────────────
# CSV / JSON Export
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/export")
async def export_telemetry_data(
    format: str = Query("csv", description="Export format: 'csv' or 'json'"),
    db: AsyncSession = Depends(get_db)
):
    """
    FR-8.6: Export pack telemetry data for offline analysis.
    """
    pack_id = settings.pack_id
    latest = await telemetry_store.get_latest()

    if format.lower() == "json":
        json_content = latest.model_dump_json(indent=2) if latest else "{}"
        return Response(
            content=json_content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=telemetry_export_{pack_id}.json"}
        )

    # Read persistent logged telemetry CSV
    csv_content = telemetry_logger.get_csv_content()

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=telemetry_export_{pack_id}.csv"}
    )
