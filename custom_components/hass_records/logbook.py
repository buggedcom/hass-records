"""Logbook integration for Hass Records."""
from __future__ import annotations

from homeassistant.core import Event, HomeAssistant, callback

from .const import DOMAIN, EVENT_RECORDED, ATTR_MESSAGE


def async_describe_events(
    hass: HomeAssistant,
    async_describe_event: callback,
) -> None:
    """Describe how Hass Records events appear in the logbook."""

    @callback
    def async_describe_hass_records_event(event: Event) -> dict:
        data = event.data
        message = data.get(ATTR_MESSAGE, "Event recorded")
        entity_id = data.get("entity_id")

        result: dict = {
            "name": "Hass Records",
            "message": message,
        }
        if entity_id:
            result["entity_id"] = entity_id

        return result

    async_describe_event(DOMAIN, EVENT_RECORDED, async_describe_hass_records_event)
