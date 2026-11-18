"""
Phase 3: BMS Raw Frame Logger (FR-2.8)

Captures and stores raw RS485 protocol frames for forensic analysis.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# In-memory ring buffer for recent frames (persisted to DB asynchronously)
_frame_buffer: list = []
MAX_BUFFER_SIZE = 500


def log_frame(
    protocol: str = "RS485",
    raw_hex: str = "",
    decoded_json: Optional[dict] = None,
    frame_type: str = "telemetry",
) -> dict:
    """
    Log a raw BMS RS485 frame to the in-memory buffer.
    Returns the frame record dict.
    """
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "protocol": protocol,
        "raw_hex": raw_hex,
        "decoded_json": json.dumps(decoded_json) if decoded_json else None,
        "frame_type": frame_type,
    }

    _frame_buffer.append(record)

    # Trim buffer to max size (ring buffer behavior)
    if len(_frame_buffer) > MAX_BUFFER_SIZE:
        _frame_buffer.pop(0)

    return record


def get_recent_frames(limit: int = 50, protocol_filter: Optional[str] = None) -> list:
    """
    Returns the most recent frames from the in-memory buffer.
    Optionally filters by protocol ('RS485').
    """
    frames = _frame_buffer
    if protocol_filter:
        frames = [f for f in frames if f["protocol"] == protocol_filter]
    return list(reversed(frames[-limit:]))


def get_frame_stats() -> dict:
    """Returns aggregate stats about the frame buffer."""
    total = len(_frame_buffer)
    rs485_count = sum(1 for f in _frame_buffer if f["protocol"] == "RS485")
    last_frame = _frame_buffer[-1] if _frame_buffer else None

    return {
        "total_frames_buffered": total,
        "rs485_frames": rs485_count,
        "buffer_capacity": MAX_BUFFER_SIZE,
        "last_frame_at": last_frame["timestamp"] if last_frame else None,
        "last_protocol": last_frame["protocol"] if last_frame else None,
    }


def clear_buffer():
    """Clears the in-memory frame buffer."""
    _frame_buffer.clear()
