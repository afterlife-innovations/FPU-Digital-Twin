import asyncio
from typing import Optional, List
from collections import deque
from app.schemas import TelemetryPayload

class TelemetryStore:
    def __init__(self, max_history: int = 1200):
        self._latest_payload: Optional[TelemetryPayload] = None
        self._history = deque(maxlen=max_history)
        self._lock = asyncio.Lock()

    async def update(self, payload: TelemetryPayload):
        async with self._lock:
            self._latest_payload = payload
            self._history.append(payload)

    async def get_latest(self) -> Optional[TelemetryPayload]:
        async with self._lock:
            return self._latest_payload

    def get_latest_sync(self) -> Optional[TelemetryPayload]:
        return self._latest_payload

    async def get_history(self) -> List[TelemetryPayload]:
        async with self._lock:
            return list(self._history)

telemetry_store = TelemetryStore()
