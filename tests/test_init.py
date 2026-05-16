"""Tests for IndeklimaDataCoordinator in __init__.py."""
from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch, AsyncMock
import pytest

from custom_components.indeklima.const import (
    STATUS_GOOD,
    STATUS_WARNING,
    STATUS_CRITICAL,
    TREND_RISING,
    TREND_FALLING,
    TREND_STABLE,
    SEASON_SUMMER,
    SEASON_WINTER,
    CIRCULATION_GOOD,
    CIRCULATION_MODERATE,
    CIRCULATION_POOR,
)
from .conftest import make_state, mock_hass, mock_entry


class TestGetSeason:
    """Test _get_season() month logic."""

    def _make_coordinator(self, hass, entry):
        from custom_components.indeklima import IndeklimaDataCoordinator
        with patch(
            "custom_components.indeklima.DataUpdateCoordinator.__init__",
            return_value=None,
        ):
            coord = IndeklimaDataCoordinator.__new__(IndeklimaDataCoordinator)
            coord.hass = hass
            coord.entry = entry
            coord.rooms = entry.data.get("rooms", [])
            coord.humidity_summer_max = 60
            coord.humidity_winter_max = 55
            coord.co2_max = 1000
            coord.voc_max = 3.0
            coord.formaldehyde_max = 0.15
            coord.weather_entity = None
            coord.history = {"humidity": [], "co2": [], "severity": []}
            return coord

    def test_summer_months(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        for month in [5, 6, 7, 8, 9]:
            with patch("custom_components.indeklima.datetime") as mock_dt:
                mock_dt.now.return_value = datetime(2026, month, 1)
                assert coord._get_season() == SEASON_SUMMER

    def test_winter_months(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        for month in [1, 2, 3, 4, 10, 11, 12]:
            with patch("custom_components.indeklima.datetime") as mock_dt:
                mock_dt.now.return_value = datetime(2026, month, 1)
                assert coord._get_season() == SEASON_WINTER


class TestCalculateSeverity:
    """Test severity scoring logic."""

    def _make_coordinator(self, hass, entry):
        from custom_components.indeklima import IndeklimaDataCoordinator
        with patch(
            "custom_components.indeklima.DataUpdateCoordinator.__init__",
            return_value=None,
        ):
            coord = IndeklimaDataCoordinator.__new__(IndeklimaDataCoordinator)
            coord.hass = hass
            coord.entry = entry
            coord.rooms = entry.data.get("rooms", [])
            coord.humidity_summer_max = 60
            coord.humidity_winter_max = 55
            coord.co2_max = 1000
            coord.voc_max = 3.0
            coord.formaldehyde_max = 0.15
            coord.weather_entity = None
            coord.history = {"humidity": [], "co2": [], "severity": []}
            return coord

    def test_perfect_conditions(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        severity = coord._calculate_severity({"humidity": 45, "co2": 500})
        assert severity == 0.0

    def test_high_humidity_adds_points(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        severity = coord._calculate_severity({"humidity": 70})  # 10 over max
        assert severity > 0

    def test_high_co2_adds_points(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        severity = coord._calculate_severity({"co2": 2000})  # 1000 over max
        assert severity > 0

    def test_pressure_does_not_affect_severity(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        s1 = coord._calculate_severity({"humidity": 45})
        s2 = coord._calculate_severity({"humidity": 45, "pressure": 1100})
        assert s1 == s2

    def test_severity_capped_at_100(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        severity = coord._calculate_severity({
            "humidity": 100,
            "co2": 5000,
            "voc": 10.0,
            "formaldehyde": 1.0,
        })
        assert severity <= 100.0

    def test_severity_never_negative(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        severity = coord._calculate_severity({})
        assert severity >= 0.0


class TestGetStatusFromSeverity:
    """Test status thresholds."""

    def _make_coordinator(self, hass, entry):
        from custom_components.indeklima import IndeklimaDataCoordinator
        with patch(
            "custom_components.indeklima.DataUpdateCoordinator.__init__",
            return_value=None,
        ):
            coord = IndeklimaDataCoordinator.__new__(IndeklimaDataCoordinator)
            coord.hass = hass
            coord.entry = entry
            coord.rooms = []
            coord.humidity_summer_max = 60
            coord.humidity_winter_max = 55
            coord.co2_max = 1000
            coord.voc_max = 3.0
            coord.formaldehyde_max = 0.15
            coord.weather_entity = None
            coord.history = {"humidity": [], "co2": [], "severity": []}
            return coord

    def test_good(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._get_status_from_severity(0) == STATUS_GOOD
        assert coord._get_status_from_severity(29) == STATUS_GOOD

    def test_warning(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._get_status_from_severity(30) == STATUS_WARNING
        assert coord._get_status_from_severity(59) == STATUS_WARNING

    def test_critical(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._get_status_from_severity(60) == STATUS_CRITICAL
        assert coord._get_status_from_severity(100) == STATUS_CRITICAL


class TestCalculateTrend:
    """Test trend calculation."""

    def _make_coordinator(self, hass, entry):
        from custom_components.indeklima import IndeklimaDataCoordinator
        with patch(
            "custom_components.indeklima.DataUpdateCoordinator.__init__",
            return_value=None,
        ):
            coord = IndeklimaDataCoordinator.__new__(IndeklimaDataCoordinator)
            coord.hass = hass
            coord.entry = entry
            coord.rooms = []
            coord.humidity_summer_max = 60
            coord.humidity_winter_max = 55
            coord.co2_max = 1000
            coord.voc_max = 3.0
            coord.formaldehyde_max = 0.15
            coord.weather_entity = None
            coord.history = {"humidity": [], "co2": [], "severity": []}
            return coord

    def test_single_point_is_stable(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        result = coord._calculate_trend("humidity", 50.0)
        assert result == TREND_STABLE

    def test_rising_trend(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        # Call multiple times with rising values — no datetime mock needed
        with patch("custom_components.indeklima.repairs._get_delete_issue", return_value=MagicMock()):
            coord._calculate_trend("humidity", 30.0)
            coord._calculate_trend("humidity", 50.0)
            result = coord._calculate_trend("humidity", 80.0)
        assert result == TREND_RISING

    def test_falling_trend(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        with patch("custom_components.indeklima.repairs._get_delete_issue", return_value=MagicMock()):
            coord._calculate_trend("humidity", 80.0)
            coord._calculate_trend("humidity", 55.0)
            result = coord._calculate_trend("humidity", 20.0)
        assert result == TREND_FALLING

    def test_stable_trend(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        with patch("custom_components.indeklima.repairs._get_delete_issue", return_value=MagicMock()):
            coord._calculate_trend("humidity", 50.0)
            coord._calculate_trend("humidity", 50.0)
            result = coord._calculate_trend("humidity", 50.0)
        assert result == TREND_STABLE


class TestAirCirculation:
    """Test air circulation status."""

    def _make_coordinator(self, hass, entry):
        from custom_components.indeklima import IndeklimaDataCoordinator
        with patch(
            "custom_components.indeklima.DataUpdateCoordinator.__init__",
            return_value=None,
        ):
            coord = IndeklimaDataCoordinator.__new__(IndeklimaDataCoordinator)
            coord.hass = hass
            coord.entry = entry
            coord.rooms = []
            coord.humidity_summer_max = 60
            coord.humidity_winter_max = 55
            coord.co2_max = 1000
            coord.voc_max = 3.0
            coord.formaldehyde_max = 0.15
            coord.weather_entity = None
            coord.history = {"humidity": [], "co2": [], "severity": []}
            return coord

    def test_no_doors_poor(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._calculate_air_circulation(0) == CIRCULATION_POOR

    def test_one_door_moderate(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._calculate_air_circulation(1) == CIRCULATION_MODERATE

    def test_two_doors_moderate(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._calculate_air_circulation(2) == CIRCULATION_MODERATE

    def test_three_doors_good(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._calculate_air_circulation(3) == CIRCULATION_GOOD

    def test_many_doors_good(self, mock_hass, mock_entry):
        coord = self._make_coordinator(mock_hass, mock_entry)
        assert coord._calculate_air_circulation(10) == CIRCULATION_GOOD


class TestGetSensorValues:
    """Test sensor value retrieval with repair integration."""

    def _make_coordinator(self, hass, entry):
        from custom_components.indeklima import IndeklimaDataCoordinator
        with patch(
            "custom_components.indeklima.DataUpdateCoordinator.__init__",
            return_value=None,
        ):
            coord = IndeklimaDataCoordinator.__new__(IndeklimaDataCoordinator)
            coord.hass = hass
            coord.entry = entry
            coord.rooms = []
            coord.humidity_summer_max = 60
            coord.humidity_winter_max = 55
            coord.co2_max = 1000
            coord.voc_max = 3.0
            coord.formaldehyde_max = 0.15
            coord.weather_entity = None
            coord.history = {"humidity": [], "co2": [], "severity": []}
            return coord

    def test_available_sensor_returns_value(self, mock_hass, mock_entry):
        mock_hass.states.get.return_value = make_state("42.5")
        coord = self._make_coordinator(mock_hass, mock_entry)
        with patch("custom_components.indeklima.repairs._get_delete_issue", return_value=MagicMock()):
            values = coord._get_sensor_values(["sensor.test"], "Stue")
        assert values == [42.5]

    def test_unavailable_sensor_returns_empty(self, mock_hass, mock_entry):
        mock_hass.states.get.return_value = make_state("unavailable", unavailable=True)
        coord = self._make_coordinator(mock_hass, mock_entry)
        with patch("custom_components.indeklima.repairs._get_create_issue", return_value=MagicMock()), \
             patch("custom_components.indeklima.repairs._get_issue_severity", return_value=MagicMock()):
            values = coord._get_sensor_values(["sensor.test"], "Stue")
        assert values == []

    def test_none_state_returns_empty(self, mock_hass, mock_entry):
        mock_hass.states.get.return_value = None
        coord = self._make_coordinator(mock_hass, mock_entry)
        with patch("custom_components.indeklima.repairs._get_create_issue", return_value=MagicMock()), \
             patch("custom_components.indeklima.repairs._get_issue_severity", return_value=MagicMock()):
            values = coord._get_sensor_values(["sensor.test"], "Stue")
        assert values == []

    def test_multiple_sensors_averages(self, mock_hass, mock_entry):
        def get_state(entity_id):
            return make_state("40.0") if "a" in entity_id else make_state("60.0")
        mock_hass.states.get.side_effect = get_state
        coord = self._make_coordinator(mock_hass, mock_entry)
        with patch("custom_components.indeklima.repairs._get_delete_issue", return_value=MagicMock()):
            values = coord._get_sensor_values(["sensor.a", "sensor.b"], "Stue")
        assert values == [40.0, 60.0]

    def test_no_room_name_skips_repair(self, mock_hass, mock_entry):
        mock_hass.states.get.return_value = None
        coord = self._make_coordinator(mock_hass, mock_entry)
        mock_create = MagicMock()
        with patch("custom_components.indeklima.repairs._get_create_issue", return_value=mock_create):
            coord._get_sensor_values(["sensor.test"])
        mock_create.assert_not_called()
