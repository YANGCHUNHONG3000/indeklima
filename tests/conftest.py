"""Shared pytest fixtures for Indeklima tests."""
from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest

from homeassistant.core import HomeAssistant


# ── Minimal room config used across tests ─────────────────────────────────────

ROOM_STUE = {
    "name": "Stue",
    "humidity_sensors": ["sensor.stue_humidity"],
    "temperature_sensors": ["sensor.stue_temperature"],
    "co2_sensors": ["sensor.stue_co2"],
    "voc_sensors": [],
    "formaldehyde_sensors": [],
    "pressure_sensors": ["sensor.stue_pressure"],
    "window_sensors": [],
}

ROOM_SOVEVARELSE = {
    "name": "Soveværelse",
    "humidity_sensors": ["sensor.sov_humidity"],
    "temperature_sensors": ["sensor.sov_temperature"],
    "co2_sensors": [],
    "voc_sensors": [],
    "formaldehyde_sensors": [],
    "pressure_sensors": [],
    "window_sensors": [],
}

ENTRY_DATA = {"rooms": [ROOM_STUE, ROOM_SOVEVARELSE]}
ENTRY_OPTIONS = {
    "humidity_summer_max": 60,
    "humidity_winter_max": 55,
    "co2_max": 1000,
    "voc_max": 3.0,
    "formaldehyde_max": 0.15,
}


@pytest.fixture
def mock_entry():
    """Return a minimal mock ConfigEntry."""
    entry = MagicMock()
    entry.entry_id = "test_entry_id"
    entry.data = ENTRY_DATA
    entry.options = ENTRY_OPTIONS
    return entry


@pytest.fixture
def mock_hass():
    """Return a minimal mock HomeAssistant instance."""
    hass = MagicMock()  # No spec — spec blocks attribute access we need
    hass.data = {}
    hass.states = MagicMock()
    hass.config = MagicMock()
    hass.config.config_dir = "/tmp/ha_test"

    def _get_state(entity_id):
        return None  # unavailable by default

    hass.states.get.side_effect = _get_state
    return hass


def make_state(value: str, unavailable: bool = False):
    """Create a mock HA state object."""
    state = MagicMock()
    state.state = "unavailable" if unavailable else value
    return state
