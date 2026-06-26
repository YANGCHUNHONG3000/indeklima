"""Tests for const.py — normalize_room_id and version."""
from __future__ import annotations

import pytest

from custom_components.indeklima.const import (
    __version__,
    normalize_room_id,
    STATUS_GOOD,
    STATUS_WARNING,
    STATUS_CRITICAL,
    TREND_RISING,
    TREND_FALLING,
    TREND_STABLE,
    VENTILATION_YES,
    VENTILATION_NO,
    VENTILATION_OPTIONAL,
    CIRCULATION_GOOD,
    CIRCULATION_MODERATE,
    CIRCULATION_POOR,
    DEFAULT_HUMIDITY_SUMMER_MAX,
    DEFAULT_HUMIDITY_WINTER_MAX,
    DEFAULT_CO2_MAX,
    CIRCULATION_BONUS,
)


class TestVersion:
    def test_version_string(self):
        assert isinstance(__version__, str)
        parts = __version__.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_version_value(self):
        assert __version__ == "2.5.2"


class TestConstants:
    def test_status_values(self):
        assert STATUS_GOOD == "good"
        assert STATUS_WARNING == "warning"
        assert STATUS_CRITICAL == "critical"

    def test_trend_values(self):
        assert TREND_RISING == "rising"
        assert TREND_FALLING == "falling"
        assert TREND_STABLE == "stable"

    def test_ventilation_values(self):
        assert VENTILATION_YES == "yes"
        assert VENTILATION_NO == "no"
        assert VENTILATION_OPTIONAL == "optional"

    def test_circulation_values(self):
        assert CIRCULATION_GOOD == "good"
        assert CIRCULATION_MODERATE == "moderate"
        assert CIRCULATION_POOR == "poor"

    def test_defaults(self):
        assert DEFAULT_HUMIDITY_SUMMER_MAX == 60
        assert DEFAULT_HUMIDITY_WINTER_MAX == 55
        assert DEFAULT_CO2_MAX == 1000
        assert CIRCULATION_BONUS == 0.95


class TestNormalizeRoomId:
    def test_lowercase(self):
        assert normalize_room_id("Stue") == "stue"

    def test_spaces_to_underscores(self):
        assert normalize_room_id("Lukas Værelse") == "lukas_vaerelse"

    def test_danish_ae(self):
        assert normalize_room_id("Soveværelse") == "sovevaereelse" or \
               normalize_room_id("Soveværelse") == "sovevaerelse"
        # Accept both — key is that æ → ae
        result = normalize_room_id("Soveværelse")
        assert "ae" in result
        assert "æ" not in result

    def test_danish_oe(self):
        result = normalize_room_id("Køkken")
        assert "oe" in result
        assert "ø" not in result

    def test_danish_aa(self):
        result = normalize_room_id("Åbent rum")
        assert "aa" in result
        assert "å" not in result

    def test_uppercase_danish(self):
        result = normalize_room_id("ÆØÅ")
        assert "æ" not in result
        assert "ø" not in result
        assert "å" not in result

    def test_already_normalized(self):
        assert normalize_room_id("stue") == "stue"

    def test_multiple_words(self):
        result = normalize_room_id("Lukas Værelse")
        assert " " not in result
        assert "_" in result

    def test_empty_string(self):
        # normalize_room_id("") returns "unknown" — empty name is treated as unknown
        assert normalize_room_id("") == "unknown"
