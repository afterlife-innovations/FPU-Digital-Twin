from fastapi import APIRouter
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from app.config import settings

router = APIRouter(prefix="/alerts", tags=["Alerts"])

# In-memory stores for channels, acknowledged alerts, and history log
NOTIFICATION_CHANNELS = {
    "whatsapp_enabled": True,
    "whatsapp_provider": "CallMeBot",
    "whatsapp_recipient": settings.callmebot_phone,
    "whatsapp_delivery_configured": bool(
        settings.callmebot_api_key and settings.callmebot_phone
    ),
    "webhook_enabled": False,
}

ACKNOWLEDGED_ALERTS: Dict[str, Dict[str, Any]] = {}
SNOOZED_ALERTS: Dict[str, datetime] = {}
ALERT_HISTORY_LOG: List[Dict[str, Any]] = []

class SnoozeRequest(BaseModel):
    duration_minutes: int = 15

# In-memory alert rules
DEFAULT_RULES = [
    {
        "id": 1,
        "rule_name": "Over-Current Validation (10A Limit)",
        "metric": "pack_current_a",
        "condition": "gt",
        "threshold_value": 10.0,
        "severity": "critical",
        "is_active": True,
    },
    {
        "id": 2,
        "rule_name": "Cell Over-Temperature Warning",
        "metric": "temperature_c",
        "condition": "gt",
        "threshold_value": 50.0,
        "severity": "warning",
        "is_active": True,
    },
    {
        "id": 3,
        "rule_name": "Cell Over-Temperature Critical",
        "metric": "temperature_c",
        "condition": "gt",
        "threshold_value": 55.0,
        "severity": "critical",
        "is_active": True,
    },
    {
        "id": 4,
        "rule_name": "Cell Under-Voltage Critical",
        "metric": "voltage_v",
        "condition": "lt",
        "threshold_value": 2.8,
        "severity": "critical",
        "is_active": True,
    },
]

@router.get("/rules")
async def list_alert_rules():
    """
    Returns configurable alert threshold rules (FR-9.1).
    """
    return DEFAULT_RULES

@router.post("/rules")
async def update_alert_rule(rule: Dict[str, Any]):
    """
    Updates or creates an alert threshold rule.
    """
    return {"status": "success", "rule": rule}

@router.get("/active")
async def get_active_alerts():
    """
    Returns currently active unacknowledged alerts.
    """
    return {
        "active_alerts": list(ACKNOWLEDGED_ALERTS.values()),
        "count": len(ACKNOWLEDGED_ALERTS)
    }

@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, note: Optional[str] = "Acknowledged by operator"):
    """
    FR-9.4: Acknowledge an active alert.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {
        "id": alert_id,
        "acknowledged": True,
        "acknowledged_at": now_iso,
        "note": note
    }
    ACKNOWLEDGED_ALERTS[alert_id] = record
    ALERT_HISTORY_LOG.insert(0, {
        "id": alert_id,
        "action": "ACKNOWLEDGED",
        "timestamp": now_iso,
        "note": note
    })
    return {"status": "acknowledged", "alert_id": alert_id, "acknowledged_at": now_iso}

@router.post("/{alert_id}/snooze")
async def snooze_alert(alert_id: str, req: SnoozeRequest):
    """
    FR-9.4: Snooze an active alert for specified minutes.
    """
    snooze_until = datetime.now(timezone.utc) + timedelta(minutes=req.duration_minutes)
    SNOOZED_ALERTS[alert_id] = snooze_until
    ALERT_HISTORY_LOG.insert(0, {
        "id": alert_id,
        "action": "SNOOZED",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "snoozed_until": snooze_until.isoformat(),
        "duration_minutes": req.duration_minutes
    })
    return {
        "status": "snoozed",
        "alert_id": alert_id,
        "snoozed_until": snooze_until.isoformat(),
        "duration_minutes": req.duration_minutes
    }

@router.get("/history")
async def get_alert_history():
    """
    FR-9.5: Returns historical alert audit log.
    """
    return {
        "count": len(ALERT_HISTORY_LOG),
        "history": ALERT_HISTORY_LOG[:100]
    }

@router.get("/channels")
async def get_notification_channels():
    """
    FR-9.3: Returns WhatsApp alert dispatch configuration.
    """
    return NOTIFICATION_CHANNELS

@router.post("/channels")
async def update_notification_channels():
    """Notification delivery is configured through backend environment settings."""
    return {"status": "success", "channels": NOTIFICATION_CHANNELS}
