"""Persistent storage for Hass Records events."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_KEY, STORAGE_VERSION


class HassRecordsStore:
    """Manages persistent storage of recorded events."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] = {"events": []}

    async def async_load(self) -> None:
        """Load data from persistent storage."""
        data = await self._store.async_load()
        if data is not None:
            self._data = data

    async def async_record(
        self,
        message: str,
        annotation: str | None = None,
        entity_id: str | None = None,
        icon: str | None = None,
        color: str | None = None,
    ) -> dict[str, Any]:
        """Record a new event and persist it."""
        event: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "message": message,
            "annotation": annotation if annotation is not None else message,
            "icon": icon or "mdi:bookmark",
            "color": color or "#03a9f4",
        }
        if entity_id is not None:
            event["entity_id"] = entity_id

        self._data["events"].append(event)
        await self._store.async_save(self._data)
        return event

    def get_events(
        self,
        start: str | None = None,
        end: str | None = None,
        entity_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return events, optionally filtered by time range and entity."""
        events: list[dict[str, Any]] = self._data.get("events", [])

        if start is not None:
            events = [e for e in events if e["timestamp"] >= start]
        if end is not None:
            events = [e for e in events if e["timestamp"] <= end]
        if entity_id is not None:
            events = [
                e for e in events
                if e.get("entity_id") == entity_id or "entity_id" not in e
            ]

        return events

    async def async_delete_event(self, event_id: str) -> bool:
        """Delete an event by ID. Returns True if found and deleted."""
        original_len = len(self._data["events"])
        self._data["events"] = [
            e for e in self._data["events"] if e["id"] != event_id
        ]
        if len(self._data["events"]) < original_len:
            await self._store.async_save(self._data)
            return True
        return False
