import logging
from typing import Dict, List

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_active_alert_categories: Dict[str, set[tuple[str, str]]] = {}


def _category(message: str) -> str:
    parts = message.split(maxsplit=2)
    if len(parts) > 1 and parts[0].rstrip(":") in {"CRITICAL", "WARNING"}:
        return parts[1].rstrip(":")
    return parts[0].rstrip(":")


async def dispatch_new_anomalies(
    pack_id: str,
    timestamp: str,
    anomaly_flags: Dict[str, List[str]],
) -> None:
    current_alerts = {
        (position, _category(message)): message
        for position, messages in anomaly_flags.items()
        for message in messages
    }
    previous_alerts = _active_alert_categories.get(pack_id, set())
    new_alerts = [
        (position, message)
        for (position, category), message in current_alerts.items()
        if (position, category) not in previous_alerts
    ]

    if not new_alerts:
        _active_alert_categories[pack_id] = set(current_alerts)
        return

    if not settings.callmebot_api_key or not settings.callmebot_phone:
        logger.error(
            "WhatsApp alert dispatch is not configured; set CALLMEBOT_API_KEY "
            "and CALLMEBOT_PHONE."
        )
        return

    body = "\n".join(f"{position}: {message}" for position, message in new_alerts)
    message_body = (
        f"Battery pack alert: {pack_id}\n"
        f"Time: {timestamp}\n\n"
        f"New anomalies:\n{body}"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://api.callmebot.com/whatsapp.php",
                params={
                    "phone": settings.callmebot_phone,
                    "text": message_body,
                    "apikey": settings.callmebot_api_key,
                },
            )
    except httpx.HTTPError as exc:
        logger.error(
            "Could not dispatch WhatsApp alert through CallMeBot (%s)",
            type(exc).__name__,
        )
        return

    if response.is_error:
        logger.error(
            "CallMeBot rejected WhatsApp alert request (HTTP %d)",
            response.status_code,
        )
        return

    _active_alert_categories[pack_id] = set(current_alerts)
    logger.info(
        "CallMeBot accepted %d new anomaly alert(s) for WhatsApp delivery",
        len(new_alerts),
    )
