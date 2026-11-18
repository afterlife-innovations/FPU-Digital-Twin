from fastapi import APIRouter, Query
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from app.services.frame_logger import get_recent_frames, get_frame_stats
from app.services.telemetry_store import telemetry_store

router = APIRouter(prefix="/bms", tags=["BMS Hardware & Forensics"])

@router.get("/status")
async def get_bms_status() -> Dict[str, Any]:
    """
    Returns real-time BMS connection health, protocol state, and hardware discovery info (FR-2.6).
    Reports RS485-to-TTL link status based on whether live data has been received.
    """
    stats = get_frame_stats()
    latest = await telemetry_store.get_latest()
    is_receiving_data = latest is not None

    return {
        "connected": is_receiving_data,
        "mode": "LIVE" if is_receiving_data else "AWAITING_CONNECTION",
        "active_protocol": _normalize_protocol(latest.bms_protocol if latest else None),
        "supported_protocols": ["RS485-to-TTL"],
        "frame_rate_hz": 1.0 if is_receiving_data else 0.0,
        "signal_quality": 100 if is_receiving_data else 0,
        "rs485_baudrate": 115200,
        "buffer_stats": stats,
        "last_telemetry_at": latest.timestamp if latest else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _normalize_protocol(protocol: Optional[str]) -> str:
    if protocol is None or protocol.strip().upper() in {"RS485", "RS485_MODBUS", "RS485_JK_BMS", "RS485_JK_MODBUS"}:
        return "RS485-to-TTL"
    return protocol

@router.get("/frames")
async def get_raw_bms_frames(
    limit: int = Query(50, ge=1, le=200),
    protocol: Optional[str] = Query(None, description="Filter by protocol: 'RS485'")
) -> List[Dict[str, Any]]:
    """
    Returns recent raw BMS RS485 protocol frames for forensic analysis (FR-2.8).
    """
    return get_recent_frames(limit=limit, protocol_filter=protocol)

@router.get("/frames/stats")
async def get_bms_frame_stats() -> Dict[str, Any]:
    """
    Returns aggregate statistics on raw BMS frame buffer.
    """
    return get_frame_stats()
