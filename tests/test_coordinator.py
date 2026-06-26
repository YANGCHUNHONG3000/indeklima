"""Tests for IndeklimaDataCoordinator._process_room, mold risk,
dehumidifier recommendation, and async update logic."""
from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, AsyncMock, patch
import pytest

from custom_components.indeklima.const import (
    MOLD_RISK_LOW,
    MOLD_RISK_MODERATE,
    MOLD_RISK_HIGH,
    MOLD_RISK_CRITICAL,
    DEHUMIDIFIER_YES,
    DEHUMIDIFIER_NO,
    DEHUMIDIFIER_OPTIONAL,
    STATUS_GOOD,
    STATUS_WARNING,
    STATUS_CRITICAL,
    CONF_HUMIDITY_SENSORS,
    CONF_TEMPERATURE_SENSORS,
    CONF_CO2_SENSORS,
    CONF_PRESSURE_SENSORS,
    CONF_MOLD_SENSORS,
    CONF_WINDOW_SENSORS,
    CONF_WINDOW_ENTITY,
    CONF_WINDOW_IS_OUTDOOR,
    CONF_DEHUMIDIFIER,
)
from .conftest import make_state, mock_hass, mock_entry


def _make_coord(hass, entry, rooms=None, weather_entity=None,
                mold_risk_humidity=70, mold_risk_temp_min=5, mold_risk_temp_max=35):
    from custom_components.indeklima import IndeklimaDataCoordinator
    with patch(
        "custom_components.indeklima.DataUpdateCoordinator.__init__",
        return_value=None,
    ):
        coord = IndeklimaDataCoordinator.__new__(IndeklimaDataCoordinator)
        coord.hass = hass
        coord.entry = entry
        coord.rooms = rooms if rooms is not None else []
        coord.humidity_summer_max = 60
        coord.humidity_winter_max = 55
        coord.co2_max = 1000
        coord.voc_max = 3.0
        coord.formaldehyde_max = 0.15
        coord.mold_risk_humidity = mold_risk_humidity
        coord.mold_risk_temp_min = mold_risk_temp_min
        coord.mold_risk_temp_max = mold_risk_temp_max
        coord.weather_entity = weather_entity
        coord.history = {"humidity": [], "co2": [], "severity": []}
        return coord


# ── _calculate_mold_risk ──────────────────────────────────────────────────────

class TestCalculateMoldRisk:
    def test_none_humidity_returns_low(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(None, 20.0) == MOLD_RISK_LOW

    def test_low_humidity_returns_low(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(65.0, 20.0) == MOLD_RISK_LOW

    def test_at_threshold_returns_moderate(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(70.0, 20.0) == MOLD_RISK_MODERATE

    def test_above_threshold_5_returns_high(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(75.0, 20.0) == MOLD_RISK_HIGH

    def test_above_threshold_15_returns_critical(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(85.0, 20.0) == MOLD_RISK_CRITICAL

    def test_temp_too_cold_returns_low(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(85.0, 2.0) == MOLD_RISK_LOW

    def test_temp_too_hot_returns_low(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(85.0, 40.0) == MOLD_RISK_LOW

    def test_none_temperature_assumes_in_range(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        # No temp -> temp_in_range = True -> mold risk based only on humidity
        assert coord._calculate_mold_risk(70.0, None) == MOLD_RISK_MODERATE

    def test_custom_thresholds(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry, mold_risk_humidity=80)
        assert coord._calculate_mold_risk(79.0, 20.0) == MOLD_RISK_LOW
        assert coord._calculate_mold_risk(80.0, 20.0) == MOLD_RISK_MODERATE

    def test_critical_boundary(self, mock_hass, mock_entry):
        # 70 + 15 = 85 -> critical
        coord = _make_coord(mock_hass, mock_entry)
        assert coord._calculate_mold_risk(84.9, 20.0) == MOLD_RISK_HIGH
        assert coord._calculate_mold_risk(85.0, 20.0) == MOLD_RISK_CRITICAL


# ── _calculate_dehumidifier_recommendation ────────────────────────────────────

class TestCalculateDehumidifierRecommendation:
    def _base_room(self, humidity=50.0, mold_risk=MOLD_RISK_LOW,
                   outdoor_open=0, hour=12):
        return {
            "humidity": humidity,
            "mold_risk": mold_risk,
            "outdoor_windows_open": outdoor_open,
        }

    def test_outdoor_window_open_returns_no(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(outdoor_open=1, mold_risk=MOLD_RISK_HIGH)
        assert coord._calculate_dehumidifier_recommendation(room) == DEHUMIDIFIER_NO

    def test_high_mold_risk_returns_yes(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(mold_risk=MOLD_RISK_HIGH)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=12)
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_YES

    def test_critical_mold_risk_returns_yes(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(mold_risk=MOLD_RISK_CRITICAL)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=14)
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_YES

    def test_night_low_mold_returns_no(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(humidity=65.0, mold_risk=MOLD_RISK_LOW)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=2)  # 02:00 = night
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_NO

    def test_night_moderate_mold_still_optional(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(humidity=65.0, mold_risk=MOLD_RISK_MODERATE)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=2)
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_OPTIONAL

    def test_high_humidity_low_mold_returns_optional(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(humidity=65.0, mold_risk=MOLD_RISK_LOW)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=14)
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_OPTIONAL

    def test_high_humidity_moderate_mold_returns_yes(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(humidity=65.0, mold_risk=MOLD_RISK_MODERATE)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=14)
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_YES

    def test_good_conditions_returns_no(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(humidity=45.0, mold_risk=MOLD_RISK_LOW)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=14)
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_NO

    def test_moderate_mold_no_humidity_breach_returns_optional(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry)
        room = self._base_room(humidity=50.0, mold_risk=MOLD_RISK_MODERATE)
        with patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=14)
            result = coord._calculate_dehumidifier_recommendation(room)
        assert result == DEHUMIDIFIER_OPTIONAL


# ── _process_room ─────────────────────────────────────────────────────────────

class TestProcessRoom:
    def _make_state_map(self, values: dict):
        """Return a side_effect function mapping entity_id -> state value."""
        def get_state(entity_id):
            if entity_id in values:
                return make_state(str(values[entity_id]))
            return None
        return get_state

    def test_collects_scalar_sensors(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = self._make_state_map({
            "sensor.hum": "55.0",
            "sensor.temp": "21.5",
            "sensor.co2": "850",
        })
        room_cfg = {
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
            CONF_TEMPERATURE_SENSORS: ["sensor.temp"],
            CONF_CO2_SENSORS: ["sensor.co2"],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        with patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"):
            result = coord._process_room(room_cfg, data)
        assert result["humidity"] == 55.0
        assert result["temperature"] == 21.5
        assert result["co2"] == 850.0

    def test_averages_multiple_sensors(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = self._make_state_map({
            "sensor.hum1": "40.0",
            "sensor.hum2": "60.0",
        })
        room_cfg = {
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum1", "sensor.hum2"],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        with patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"):
            result = coord._process_room(room_cfg, data)
        assert result["humidity"] == 50.0
        assert result["humidity_sensors_count"] == 2

    def test_mold_risk_uses_dedicated_sensor(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = self._make_state_map({
            "sensor.hum": "55.0",
            "sensor.mold": "80.0",  # dedicated mold sensor is higher
        })
        room_cfg = {
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
            CONF_MOLD_SENSORS: ["sensor.mold"],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        with patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"):
            result = coord._process_room(room_cfg, data)
        # Dedicated mold sensor (80%) should trigger high/critical risk
        assert result["mold_risk"] in (MOLD_RISK_HIGH, MOLD_RISK_CRITICAL)
        assert result["mold_humidity"] == 80.0

    def test_mold_risk_falls_back_to_humidity(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = self._make_state_map({
            "sensor.hum": "72.0",
        })
        room_cfg = {
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        with patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"):
            result = coord._process_room(room_cfg, data)
        assert result["mold_risk"] == MOLD_RISK_HIGH

    def test_outdoor_window_counted(self, mock_hass, mock_entry):
        def get_state(entity_id):
            if entity_id == "binary_sensor.window":
                s = MagicMock()
                s.state = "on"
                return s
            return None
        mock_hass.states.get.side_effect = get_state
        room_cfg = {
            "name": "Stue",
            CONF_WINDOW_SENSORS: [{
                CONF_WINDOW_ENTITY: "binary_sensor.window",
                CONF_WINDOW_IS_OUTDOOR: True,
            }],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        result = coord._process_room(room_cfg, data)
        assert result["outdoor_windows_open"] == 1
        assert "Stue" in data["open_windows"]

    def test_internal_door_counted(self, mock_hass, mock_entry):
        def get_state(entity_id):
            if entity_id == "binary_sensor.door":
                s = MagicMock()
                s.state = "on"
                return s
            return None
        mock_hass.states.get.side_effect = get_state
        room_cfg = {
            "name": "Stue",
            CONF_WINDOW_SENSORS: [{
                CONF_WINDOW_ENTITY: "binary_sensor.door",
                CONF_WINDOW_IS_OUTDOOR: False,
            }],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        result = coord._process_room(room_cfg, data)
        assert result["internal_doors_open"] == 1
        assert "Stue" in data["open_internal_doors"]

    def test_severity_and_status_set(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = self._make_state_map({
            "sensor.hum": "45.0",
            "sensor.co2": "500.0",
        })
        room_cfg = {
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
            CONF_CO2_SENSORS: ["sensor.co2"],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        with patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"):
            result = coord._process_room(room_cfg, data)
        assert "severity" in result
        assert result["severity"] == 0.0
        assert result["status"] == STATUS_GOOD

    def test_dehumidifier_skipped_when_not_configured(self, mock_hass, mock_entry):
        room_cfg = {"name": "Stue"}
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        result = coord._process_room(room_cfg, data)
        assert result["has_dehumidifier"] is False
        assert result["dehumidifier_recommendation"] == DEHUMIDIFIER_NO

    def test_dehumidifier_calculated_when_configured(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = self._make_state_map({
            "sensor.hum": "72.0",
        })
        room_cfg = {
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
            CONF_DEHUMIDIFIER: "switch.dehumidifier",
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        with patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(hour=14)
            result = coord._process_room(room_cfg, data)
        assert result["has_dehumidifier"] is True
        assert result["dehumidifier_recommendation"] != DEHUMIDIFIER_NO

    def test_legacy_string_window_sensor(self, mock_hass, mock_entry):
        """Backward compat: window_sensors as plain string list."""
        def get_state(entity_id):
            s = MagicMock()
            s.state = "on"
            return s
        mock_hass.states.get.side_effect = get_state
        room_cfg = {
            "name": "Stue",
            CONF_WINDOW_SENSORS: ["binary_sensor.window_old"],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        result = coord._process_room(room_cfg, data)
        assert result["outdoor_windows_open"] == 1

    def test_none_entity_id_in_window_sensor_skipped(self, mock_hass, mock_entry):
        room_cfg = {
            "name": "Stue",
            CONF_WINDOW_SENSORS: [{CONF_WINDOW_ENTITY: None, CONF_WINDOW_IS_OUTDOOR: True}],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        result = coord._process_room(room_cfg, data)
        assert result["outdoor_windows_open"] == 0

    def test_pressure_sensor_collected(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = self._make_state_map({
            "sensor.pressure": "1013.25",
        })
        room_cfg = {
            "name": "Stue",
            CONF_PRESSURE_SENSORS: ["sensor.pressure"],
        }
        coord = _make_coord(mock_hass, mock_entry)
        data = {"open_windows": [], "open_internal_doors": []}
        with patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"):
            result = coord._process_room(room_cfg, data)
        assert result["pressure"] == pytest.approx(1013.25)


# ── _async_do_update integration ─────────────────────────────────────────────

class TestAsyncDoUpdate:
    async def _run_update(self, coord):
        with patch("custom_components.indeklima.raise_coordinator_failed_issue"), \
             patch("custom_components.indeklima.clear_coordinator_failed_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(month=6, hour=14)
            mock_dt.utcnow.return_value = datetime(2026, 6, 1, 12, 0, 0)
            return await coord._async_do_update()

    @pytest.mark.asyncio
    async def test_empty_rooms_returns_defaults(self, mock_hass, mock_entry):
        coord = _make_coord(mock_hass, mock_entry, rooms=[])
        result = await self._run_update(coord)
        assert result["status"] == STATUS_GOOD
        assert result["severity"] == 0
        assert result["rooms"] == {}

    @pytest.mark.asyncio
    async def test_single_room_processed(self, mock_hass, mock_entry):
        mock_hass.states.get.side_effect = None
        mock_hass.states.get.return_value = make_state("50.0")
        rooms = [{
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
            CONF_TEMPERATURE_SENSORS: ["sensor.temp"],
        }]
        coord = _make_coord(mock_hass, mock_entry, rooms=rooms)
        result = await self._run_update(coord)
        assert "Stue" in result["rooms"]
        assert result["rooms"]["Stue"]["humidity"] == 50.0

    @pytest.mark.asyncio
    async def test_room_exception_does_not_abort_update(self, mock_hass, mock_entry):
        """A broken room should be skipped; other rooms still processed."""
        good_room = {
            "name": "GodtRum",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
        }
        # Bad room: _process_room will raise because of intentionally bad config
        bad_room = {"name": "DaarligtRum", CONF_HUMIDITY_SENSORS: None}

        mock_hass.states.get.side_effect = None
        mock_hass.states.get.return_value = make_state("50.0")

        coord = _make_coord(mock_hass, mock_entry, rooms=[bad_room, good_room])

        # Patch _process_room to raise on bad_room, succeed on good_room
        original_process = coord._process_room
        def selective_process(room, data):
            if room["name"] == "DaarligtRum":
                raise ValueError("simulated bad room")
            return original_process(room, data)

        coord._process_room = selective_process

        with patch("custom_components.indeklima.raise_coordinator_failed_issue"), \
             patch("custom_components.indeklima.clear_coordinator_failed_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(month=6, hour=14)
            mock_dt.utcnow.return_value = datetime(2026, 6, 1, 12, 0, 0)
            result = await coord._async_do_update()

        # Bad room skipped, good room present
        assert "GodtRum" in result["rooms"]
        assert "DaarligtRum" not in result["rooms"]

    @pytest.mark.asyncio
    async def test_global_mold_risk_is_worst_room(self, mock_hass, mock_entry):
        def get_state(entity_id):
            if "stue" in entity_id:
                return make_state("50.0")   # low mold
            if "sov" in entity_id:
                return make_state("85.0")   # critical mold
            return None
        mock_hass.states.get.side_effect = get_state

        rooms = [
            {"name": "Stue", CONF_HUMIDITY_SENSORS: ["sensor.stue_hum"],
             CONF_TEMPERATURE_SENSORS: ["sensor.stue_temp"]},
            {"name": "Soverum", CONF_HUMIDITY_SENSORS: ["sensor.sov_hum"],
             CONF_TEMPERATURE_SENSORS: ["sensor.sov_temp"]},
        ]
        coord = _make_coord(mock_hass, mock_entry, rooms=rooms)

        with patch("custom_components.indeklima.raise_coordinator_failed_issue"), \
             patch("custom_components.indeklima.clear_coordinator_failed_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(month=6, hour=14)
            mock_dt.utcnow.return_value = datetime(2026, 6, 1, 12, 0, 0)
            result = await coord._async_do_update()

        assert result["mold_risk"] == MOLD_RISK_CRITICAL

    @pytest.mark.asyncio
    async def test_circulation_bonus_applied(self, mock_hass, mock_entry):
        def get_state(entity_id):
            if "door" in entity_id:
                s = MagicMock(); s.state = "on"; return s
            if "hum" in entity_id:
                return make_state("70.0")
            return None
        mock_hass.states.get.side_effect = get_state

        rooms = [{
            "name": "Stue",
            CONF_HUMIDITY_SENSORS: ["sensor.hum"],
            CONF_WINDOW_SENSORS: [{
                CONF_WINDOW_ENTITY: "binary_sensor.door",
                CONF_WINDOW_IS_OUTDOOR: False,
            }],
        }]
        coord = _make_coord(mock_hass, mock_entry, rooms=rooms)

        with patch("custom_components.indeklima.raise_coordinator_failed_issue"), \
             patch("custom_components.indeklima.clear_coordinator_failed_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(month=6, hour=14)
            mock_dt.utcnow.return_value = datetime(2026, 6, 1, 12, 0, 0)
            result = await coord._async_do_update()

        # Room severity without bonus would be 30; with 5% bonus -> 28.5
        room_sev = result["rooms"]["Stue"]["severity"]
        global_sev = result["severity"]
        assert global_sev < room_sev  # bonus reduces global below room score

    @pytest.mark.asyncio
    async def test_global_dehumidifier_worst_room_wins(self, mock_hass, mock_entry):
        def get_state(entity_id):
            if "sov" in entity_id:
                return make_state("85.0")
            return make_state("45.0")
        mock_hass.states.get.side_effect = get_state

        rooms = [
            {"name": "Stue", CONF_HUMIDITY_SENSORS: ["sensor.stue_hum"],
             CONF_DEHUMIDIFIER: "switch.stue_dehum"},
            {"name": "Soverum", CONF_HUMIDITY_SENSORS: ["sensor.sov_hum"],
             CONF_TEMPERATURE_SENSORS: ["sensor.sov_temp"],
             CONF_DEHUMIDIFIER: "switch.sov_dehum"},
        ]
        coord = _make_coord(mock_hass, mock_entry, rooms=rooms)

        with patch("custom_components.indeklima.raise_coordinator_failed_issue"), \
             patch("custom_components.indeklima.clear_coordinator_failed_issue"), \
             patch("custom_components.indeklima.raise_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.clear_sensor_unavailable_issue"), \
             patch("custom_components.indeklima.dt_util") as mock_dt:
            mock_dt.now.return_value = MagicMock(month=6, hour=14)
            mock_dt.utcnow.return_value = datetime(2026, 6, 1, 12, 0, 0)
            result = await coord._async_do_update()

        # Soverum at 85% -> critical mold -> dehumidifier YES wins globally
        assert result["dehumidifier_recommendation"] == DEHUMIDIFIER_YES
