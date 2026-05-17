# File Name: websocket.py
# Version: 2.5.0
# Description: WebSocket API for the Indeklima panel.
#              Exposes coordinator data to the frontend panel via HA WebSocket API.
# Last Updated: March 2026

from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.core import HomeAssistant, callback
from homeassistant.components import websocket_api

from .const import DOMAIN, __version__

_LOGGER = logging.getLogger(__name__)


def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register all WebSocket commands for the Indeklima panel."""
    websocket_api.async_register_command(hass, ws_get_climate_data)
    websocket_api.async_register_command(hass, ws_get_room_data)
    _LOGGER.info("Indeklima WebSocket API registered (2 commands)")


def _get_coordinator(hass: HomeAssistant):
    """Find the active Indeklima coordinator."""
    for value in hass.data.get(DOMAIN, {}).values():
        if hasattr(value, "data") and hasattr(value, "rooms"):
            return value
    return None


# ── Global climate data ────────────────────────────────────────────────────────

@websocket_api.websocket_command({"type": f"{DOMAIN}/get_climate_data"})
@callback
def ws_get_climate_data(hass: HomeAssistant, connection, msg) -> None:
    """Return full climate data: hub averages, severity, trends, ventilation, all rooms."""
    coordinator = _get_coordinator(hass)
    if not coordinator:
        connection.send_error(msg["id"], "not_ready", "Integration not ready")
        return
    try:
        data = coordinator.data or {}
        rooms_raw = data.get("rooms", {})

        # Build per-room summary list
        rooms_out = []
        for room_name, room_data in rooms_raw.items():
            rooms_out.append({
                "name":              room_name,
                "status":            room_data.get("status", "good"),
                "severity":          round(room_data.get("severity", 0), 1),
                "temperature":       room_data.get("temperature"),
                "humidity":          room_data.get("humidity"),
                "co2":               room_data.get("co2"),
                "pressure":          room_data.get("pressure"),
                "mold_risk":         room_data.get("mold_risk", "low"),
                "outdoor_windows_open": room_data.get("outdoor_windows_open", 0),
                "internal_doors_open":  room_data.get("internal_doors_open", 0),
                "temperature_sensors_count": room_data.get("temperature_sensors_count", 0),
                "humidity_sensors_count":    room_data.get("humidity_sensors_count", 0),
                "co2_sensors_count":         room_data.get("co2_sensors_count", 0),
                "pressure_sensors_count":    room_data.get("pressure_sensors_count", 0),
                "mold_sensors_count":        room_data.get("mold_sensors_count", 0),
            })

        # Sort rooms: critical first, then warning, then good
        status_order = {"critical": 0, "warning": 1, "good": 2}
        rooms_out.sort(key=lambda r: (status_order.get(r["status"], 3), -r["severity"]))

        averages = data.get("averages", {})
        trends   = data.get("trends", {})
        ventilation = data.get("ventilation", {})

        connection.send_result(msg["id"], {
            "version":          __version__,
            "severity":         round(data.get("severity", 0), 1),
            "status":           data.get("status", "good"),
            "open_windows":     data.get("open_windows", []),
            "open_windows_count": len(data.get("open_windows", [])),
            "open_internal_doors": data.get("open_internal_doors", []),
            "air_circulation":  data.get("air_circulation", "poor"),
            "averages": {
                "humidity":    averages.get("humidity"),
                "temperature": averages.get("temperature"),
                "co2":         averages.get("co2"),
                "pressure":    averages.get("pressure"),
            },
            "mold_risk": data.get("mold_risk", "low"),
            "trends": {
                "humidity": trends.get("humidity", "stable"),
                "co2":      trends.get("co2", "stable"),
                "severity": trends.get("severity", "stable"),
            },
            "ventilation": {
                "status":           ventilation.get("status", "no"),
                "reason":           ventilation.get("reason", []),
                "rooms":            ventilation.get("rooms", []),
                "outdoor_temp":     ventilation.get("outdoor_temp"),
                "outdoor_humidity": ventilation.get("outdoor_humidity"),
                "weather_configured": bool(coordinator.weather_entity),
            },
            "rooms":   rooms_out,
            "room_count": len(rooms_out),
        })
    except Exception as err:
        _LOGGER.error("Error in ws_get_climate_data: %s", err)
        connection.send_error(msg["id"], "unknown_error", str(err))


# ── Per-room detail data ───────────────────────────────────────────────────────

@websocket_api.websocket_command({
    "type": f"{DOMAIN}/get_room_data",
    vol.Required("room_name"): str,
})
@callback
def ws_get_room_data(hass: HomeAssistant, connection, msg) -> None:
    """Return detailed data for a specific room."""
    coordinator = _get_coordinator(hass)
    if not coordinator:
        connection.send_error(msg["id"], "not_ready", "Integration not ready")
        return
    try:
        data = coordinator.data or {}
        room_name = msg["room_name"]
        rooms = data.get("rooms", {})

        if room_name not in rooms:
            connection.send_error(msg["id"], "room_not_found", f"Room '{room_name}' not found")
            return

        room = rooms[room_name]

        connection.send_result(msg["id"], {
            "name":     room_name,
            "status":   room.get("status", "good"),
            "severity": round(room.get("severity", 0), 1),
            "temperature":       room.get("temperature"),
            "humidity":          room.get("humidity"),
            "co2":               room.get("co2"),
            "pressure":          room.get("pressure"),
            "mold_risk":         room.get("mold_risk", "low"),
            "mold_humidity":     room.get("mold_humidity"),
            "mold_sensors_count": room.get("mold_sensors_count", 0),
            "outdoor_windows_open": room.get("outdoor_windows_open", 0),
            "internal_doors_open":  room.get("internal_doors_open", 0),
            "air_circulation_bonus": room.get("air_circulation_bonus", False),
            "last_notified":     room.get("last_notified"),
            "temperature_sensors_count": room.get("temperature_sensors_count", 0),
            "humidity_sensors_count":    room.get("humidity_sensors_count", 0),
            "co2_sensors_count":         room.get("co2_sensors_count", 0),
            "pressure_sensors_count":    room.get("pressure_sensors_count", 0),
        })
    except Exception as err:
        _LOGGER.error("Error in ws_get_room_data: %s", err)
        connection.send_error(msg["id"], "unknown_error", str(err))
