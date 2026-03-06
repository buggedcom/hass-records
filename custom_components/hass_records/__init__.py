"""Hass Records - Record custom events with chart annotations."""
from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_ANNOTATION,
    ATTR_COLOR,
    ATTR_ENTITY_ID,
    ATTR_ICON,
    ATTR_MESSAGE,
    DOMAIN,
    EVENT_RECORDED,
    FRONTEND_URL,
    SERVICE_RECORD,
)
from .store import HassRecordsStore
from . import websocket_api as ws_api

CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Schema({})}, extra=vol.ALLOW_EXTRA)

SERVICE_RECORD_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_MESSAGE): cv.string,
        vol.Optional(ATTR_ANNOTATION): cv.string,
        vol.Optional(ATTR_ENTITY_ID): cv.entity_id,
        vol.Optional(ATTR_ICON): cv.string,
        vol.Optional(ATTR_COLOR): cv.string,
    }
)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Hass Records integration."""
    store = HassRecordsStore(hass)
    await store.async_load()

    hass.data[DOMAIN] = {"store": store}

    # Serve the frontend card JS file
    await hass.http.async_register_static_paths([
        StaticPathConfig(
            FRONTEND_URL,
            str(Path(__file__).parent / "hass-records-cards.js"),
            cache_headers=False,
        )
    ])

    # Auto-register as a Lovelace module resource so cards are immediately available
    add_extra_js_url(hass, FRONTEND_URL)

    # Register the record service
    async def handle_record(call: ServiceCall) -> None:
        event_data = await store.async_record(
            message=call.data[ATTR_MESSAGE],
            annotation=call.data.get(ATTR_ANNOTATION),
            entity_id=call.data.get(ATTR_ENTITY_ID),
            icon=call.data.get(ATTR_ICON),
            color=call.data.get(ATTR_COLOR),
        )
        hass.bus.async_fire(EVENT_RECORDED, event_data)

    hass.services.async_register(
        DOMAIN, SERVICE_RECORD, handle_record, schema=SERVICE_RECORD_SCHEMA
    )

    # Register websocket commands used by the frontend cards
    ws_api.async_register_commands(hass)

    return True
