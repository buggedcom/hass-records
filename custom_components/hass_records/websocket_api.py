"""WebSocket API for Hass Records frontend cards."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(hass, ws_get_events)
    websocket_api.async_register_command(hass, ws_delete_event)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/events",
        vol.Optional("start_time"): str,
        vol.Optional("end_time"): str,
        vol.Optional("entity_id"): str,
    }
)
@websocket_api.async_response
async def ws_get_events(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return recorded events, with optional time/entity filters."""
    store = hass.data[DOMAIN]["store"]
    events = store.get_events(
        start=msg.get("start_time"),
        end=msg.get("end_time"),
        entity_id=msg.get("entity_id"),
    )
    connection.send_result(msg["id"], {"events": events})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/events/delete",
        vol.Required("event_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_event(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Delete a recorded event by ID."""
    store = hass.data[DOMAIN]["store"]
    deleted = await store.async_delete_event(msg["event_id"])
    connection.send_result(msg["id"], {"deleted": deleted})
