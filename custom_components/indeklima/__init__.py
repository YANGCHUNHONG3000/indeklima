"""Indeklima integration for Home Assistant.

Version: 2.5.0
"""
from __future__ import annotations

import logging
from datetime import timedelta, datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigEntryNotReady
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.helpers import device_registry as dr

from .const import (
    normalize_room_id,
    DOMAIN,
    CONF_ROOMS,
    CONF_HUMIDITY_SENSORS,
    CONF_TEMPERATURE_SENSORS,
    CONF_CO2_SENSORS,
    CONF_VOC_SENSORS,
    CONF_FORMALDEHYDE_SENSORS,
    CONF_PRESSURE_SENSORS,
    CONF_MOLD_SENSORS,
    CONF_WINDOW_SENSORS,
    CONF_WINDOW_ENTITY,
    CONF_WINDOW_IS_OUTDOOR,
    CONF_WEATHER_ENTITY,
    CONF_HUMIDITY_SUMMER_MAX,
    CONF_HUMIDITY_WINTER_MAX,
    CONF_CO2_MAX,
    CONF_VOC_MAX,
    CONF_FORMALDEHYDE_MAX,
    CONF_MOLD_RISK_HUMIDITY,
    CONF_MOLD_RISK_TEMP_MIN,
    CONF_MOLD_RISK_TEMP_MAX,
    DEFAULT_HUMIDITY_SUMMER_MAX,
    DEFAULT_HUMIDITY_WINTER_MAX,
    DEFAULT_CO2_MAX,
    DEFAULT_VOC_MAX,
    DEFAULT_FORMALDEHYDE_MAX,
    DEFAULT_MOLD_RISK_HUMIDITY,
    DEFAULT_MOLD_RISK_TEMP_MIN,
    DEFAULT_MOLD_RISK_TEMP_MAX,
    MOLD_RISK_LOW,
    MOLD_RISK_MODERATE,
    MOLD_RISK_HIGH,
    MOLD_RISK_CRITICAL,
    SCAN_INTERVAL,
    TREND_WINDOW,
    STATUS_GOOD,
    STATUS_WARNING,
    STATUS_CRITICAL,
    SEASON_SUMMER,
    SEASON_WINTER,
    TREND_RISING,
    TREND_FALLING,
    TREND_STABLE,
    VENTILATION_YES,
    VENTILATION_NO,
    VENTILATION_OPTIONAL,
    CIRCULATION_GOOD,
    CIRCULATION_MODERATE,
    CIRCULATION_POOR,
    CIRCULATION_BONUS,
    __version__,
)
from .panel import async_register_panel, async_unregister_panel, async_unregister_cards_resource
from .websocket import async_register_websocket_commands
from .repairs import (
    raise_coordinator_failed_issue,
    clear_coordinator_failed_issue,
    raise_sensor_unavailable_issue,
    clear_sensor_unavailable_issue,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Indeklima from a config entry."""
    coordinator = IndeklimaDataCoordinator(hass, entry)

    # Attempt first refresh but do not block setup if sensors are temporarily
    # unavailable (e.g. right after an HA restart). Sensors will be picked up
    # on the next 30-second poll cycle instead.
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning(
            "Indeklima first refresh incomplete — sensors may be unavailable at boot "
            "(will retry in %s seconds): %s",
            SCAN_INTERVAL,
            err,
        )

    # Modern HA pattern: use entry.runtime_data instead of hass.data
    entry.runtime_data = coordinator

    # Keep hass.data for backwards compatibility with websocket/diagnostics helpers
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Register devices
    device_registry = dr.async_get(hass)

    # Register hub device
    device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, f"{entry.entry_id}_hub")},
        name="Indeklima Hub",
        manufacturer="Indeklima",
        model="Climate Monitor v2",
        sw_version=__version__,
    )

    # Register room devices
    for room in coordinator.rooms:
        room_name = room.get("name")
        room_id = normalize_room_id(room_name)

        device_registry.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, f"{entry.entry_id}_room_{room_id}")},
            name=f"Indeklima {room_name}",
            manufacturer="Indeklima",
            model="Room Monitor",
            sw_version=__version__,
            via_device=(DOMAIN, f"{entry.entry_id}_hub"),
        )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # ── Register panel and WebSocket API (v2.4.0) ──────────────────────────
    async_register_websocket_commands(hass)
    await async_register_panel(hass)

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    _LOGGER.info("Indeklima integration v%s setup completed", __version__)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # ── Unregister panel and cards resource (v2.4.0) ───────────────────────
    async_unregister_panel(hass)
    await async_unregister_cards_resource(hass)

    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry."""
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)


class IndeklimaDataCoordinator(DataUpdateCoordinator):
    """Class to manage fetching Indeklima data."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize."""
        self.hass = hass
        self.entry = entry
        self.rooms = entry.data.get(CONF_ROOMS, [])

        # Get thresholds from options
        self.humidity_summer_max = entry.options.get(
            CONF_HUMIDITY_SUMMER_MAX, DEFAULT_HUMIDITY_SUMMER_MAX
        )
        self.humidity_winter_max = entry.options.get(
            CONF_HUMIDITY_WINTER_MAX, DEFAULT_HUMIDITY_WINTER_MAX
        )
        self.co2_max = entry.options.get(CONF_CO2_MAX, DEFAULT_CO2_MAX)
        self.voc_max = entry.options.get(CONF_VOC_MAX, DEFAULT_VOC_MAX)
        self.formaldehyde_max = entry.options.get(
            CONF_FORMALDEHYDE_MAX, DEFAULT_FORMALDEHYDE_MAX
        )

        # Mold risk thresholds
        self.mold_risk_humidity = entry.options.get(
            CONF_MOLD_RISK_HUMIDITY, DEFAULT_MOLD_RISK_HUMIDITY
        )
        self.mold_risk_temp_min = entry.options.get(
            CONF_MOLD_RISK_TEMP_MIN, DEFAULT_MOLD_RISK_TEMP_MIN
        )
        self.mold_risk_temp_max = entry.options.get(
            CONF_MOLD_RISK_TEMP_MAX, DEFAULT_MOLD_RISK_TEMP_MAX
        )

        # Weather entity
        self.weather_entity = entry.options.get(CONF_WEATHER_ENTITY)

        # History for trends
        self.history: dict[str, list[tuple[datetime, float]]] = {
            "humidity": [],
            "co2": [],
            "severity": [],
        }

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=SCAN_INTERVAL),
        )

    def _get_season(self) -> str:
        """Determine current season."""
        month = datetime.now().month
        if 5 <= month <= 9:
            return SEASON_SUMMER
        return SEASON_WINTER

    def _get_humidity_max(self) -> float:
        """Get max humidity based on season."""
        season = self._get_season()
        if season == SEASON_SUMMER:
            return self.humidity_summer_max
        return self.humidity_winter_max

    def _get_sensor_values(self, entity_ids: list[str], room_name: str = "") -> list[float]:
        """Get numeric values from multiple sensors."""
        values = []
        for entity_id in entity_ids:
            state = self.hass.states.get(entity_id)
            if state and state.state not in ("unknown", "unavailable"):
                try:
                    values.append(float(state.state))
                    # Clear any existing repair issue for this sensor
                    if room_name:
                        clear_sensor_unavailable_issue(
                            self.hass, self.entry.entry_id, entity_id
                        )
                except (ValueError, TypeError):
                    pass
            else:
                # Sensor is unavailable — raise a repair issue
                if room_name:
                    raise_sensor_unavailable_issue(
                        self.hass, self.entry.entry_id, room_name, entity_id
                    )
        return values

    def _calculate_mold_risk(self, humidity: float | None, temperature: float | None) -> str:
        """Calculate mold risk level from humidity and temperature.

        Mold growth is favoured when:
          - Relative humidity is sustained above ~70 %
          - Temperature is between 5 °C and 35 °C

        Returns one of: MOLD_RISK_LOW / MODERATE / HIGH / CRITICAL.
        """
        if humidity is None:
            return MOLD_RISK_LOW

        temp_in_range = True
        if temperature is not None:
            temp_in_range = self.mold_risk_temp_min <= temperature <= self.mold_risk_temp_max

        if not temp_in_range:
            return MOLD_RISK_LOW

        if humidity >= self.mold_risk_humidity + 15:   # ≥85 %
            return MOLD_RISK_CRITICAL
        elif humidity >= self.mold_risk_humidity + 5:  # ≥75 %
            return MOLD_RISK_HIGH
        elif humidity >= self.mold_risk_humidity:       # ≥70 %
            return MOLD_RISK_MODERATE
        return MOLD_RISK_LOW

    def _calculate_severity(self, room_data: dict) -> float:
        """Calculate severity score for a room (0-100, lower is better)."""
        severity = 0.0
        humidity_max = self._get_humidity_max()

        # Humidity severity (0-30 points)
        if "humidity" in room_data:
            humidity = room_data["humidity"]
            if humidity > humidity_max:
                excess = humidity - humidity_max
                severity += min(30, excess * 3)

        # CO2 severity (0-30 points)
        if "co2" in room_data:
            co2 = room_data["co2"]
            if co2 > self.co2_max:
                excess = co2 - self.co2_max
                severity += min(30, (excess / 1000) * 30)

        # VOC severity (0-20 points)
        if "voc" in room_data:
            voc = room_data["voc"]
            if voc > self.voc_max:
                excess = voc - self.voc_max
                severity += min(20, excess * 5)

        # Formaldehyde severity (0-20 points)
        if "formaldehyde" in room_data:
            formaldehyde = room_data["formaldehyde"]
            if formaldehyde > self.formaldehyde_max:
                excess = formaldehyde - self.formaldehyde_max
                severity += min(20, excess * 50)

        # Note: Pressure does NOT affect severity scoring.
        # It is informational only (barometric pressure is not an indoor
        # climate quality metric that users can control).

        return min(100, severity)

    def _get_status_from_severity(self, severity: float) -> str:
        """Convert severity score to status."""
        if severity < 30:
            return STATUS_GOOD
        elif severity < 60:
            return STATUS_WARNING
        return STATUS_CRITICAL

    def _calculate_trend(self, key: str, current_value: float) -> str:
        """Calculate trend for a metric."""
        now = datetime.now()

        # Add current value to history
        self.history[key].append((now, current_value))

        # Remove old entries (older than TREND_WINDOW)
        cutoff = now - timedelta(seconds=TREND_WINDOW)
        self.history[key] = [
            (ts, val) for ts, val in self.history[key] if ts > cutoff
        ]

        # Need at least 2 data points
        if len(self.history[key]) < 2:
            return TREND_STABLE

        # Calculate linear regression slope
        timestamps = [(ts - now).total_seconds() for ts, _ in self.history[key]]
        values = [val for _, val in self.history[key]]

        n = len(timestamps)
        sum_x = sum(timestamps)
        sum_y = sum(values)
        sum_xy = sum(x * y for x, y in zip(timestamps, values))
        sum_xx = sum(x * x for x in timestamps)

        denominator = n * sum_xx - sum_x * sum_x
        if denominator == 0:
            return TREND_STABLE

        slope = (n * sum_xy - sum_x * sum_y) / denominator

        # Determine trend based on slope
        threshold = 0.1
        if slope > threshold:
            return TREND_RISING
        elif slope < -threshold:
            return TREND_FALLING
        return TREND_STABLE

    def _get_weather_data(self) -> dict[str, float]:
        """Get weather data for ventilation recommendation.

        Tries multiple attribute keys to support different HA weather integrations.
        Standard weather entities use 'temperature' and 'humidity'.
        Some integrations also expose 'current_temperature'.
        """
        weather_data = {}

        if not self.weather_entity:
            return weather_data

        state = self.hass.states.get(self.weather_entity)
        if not state or state.state in ("unknown", "unavailable"):
            return weather_data

        attrs = state.attributes

        # Temperature — try multiple keys
        for temp_key in ("temperature", "current_temperature"):
            val = attrs.get(temp_key)
            if val is not None:
                try:
                    weather_data["temperature"] = float(val)
                    break
                except (ValueError, TypeError):
                    pass

        # Humidity — try multiple keys
        for hum_key in ("humidity", "current_humidity"):
            val = attrs.get(hum_key)
            if val is not None:
                try:
                    weather_data["humidity"] = float(val)
                    break
                except (ValueError, TypeError):
                    pass

        return weather_data

    def _calculate_ventilation_recommendation(self, data: dict) -> dict:
        """Calculate ventilation recommendation."""
        recommendation = {
            "status": VENTILATION_NO,
            "reason": [],
            "rooms": [],
            "outdoor_temp": None,
            "outdoor_humidity": None,
        }

        # Check if any outdoor windows are open
        if data.get("open_windows"):
            recommendation["status"] = VENTILATION_OPTIONAL
            recommendation["reason"].append("Vinduer allerede \u00e5bne")
            return recommendation

        # Analyze indoor climate issues
        issues = []
        problem_rooms = []

        humidity_max = self._get_humidity_max()

        for room_name, room_data in data.get("rooms", {}).items():
            room_issues = []

            if "humidity" in room_data and room_data["humidity"] > humidity_max:
                room_issues.append("H\u00f8j fugtighed")

            if "co2" in room_data and room_data["co2"] > self.co2_max:
                room_issues.append("H\u00f8j CO2")

            if "voc" in room_data and room_data["voc"] > self.voc_max:
                room_issues.append("H\u00f8j VOC")

            if room_issues:
                issues.extend(room_issues)
                problem_rooms.append(room_name)

        # Always fetch weather data so outdoor conditions are shown in panel
        # regardless of whether there are indoor issues or not
        weather = self._get_weather_data()
        if weather:
            recommendation["outdoor_temp"] = weather.get("temperature")
            recommendation["outdoor_humidity"] = weather.get("humidity")

        if not issues:
            recommendation["status"] = VENTILATION_NO
            recommendation["reason"].append("Indeklima er OK")
            return recommendation

        # There are indoor issues — now decide whether to recommend ventilation
        temp     = weather.get("temperature", 20) if weather else 20
        humidity = weather.get("humidity",    50) if weather else 50

        if weather:
            if temp < 5:
                recommendation["status"] = VENTILATION_OPTIONAL
                recommendation["reason"].extend(issues)
                recommendation["reason"].append("For koldt ude")
            elif humidity > humidity_max:
                recommendation["status"] = VENTILATION_NO
                recommendation["reason"].extend(issues)
                recommendation["reason"].append("For fugtigt ude")
            else:
                recommendation["status"] = VENTILATION_YES
                recommendation["reason"].extend(issues)
        else:
            # No weather data — recommend based on indoor issues only
            recommendation["status"] = VENTILATION_YES
            recommendation["reason"].extend(issues)

        recommendation["rooms"] = problem_rooms
        return recommendation

    def _calculate_air_circulation(self, total_internal_doors: int) -> str:
        """Calculate air circulation status based on open internal doors."""
        if total_internal_doors >= 3:
            return CIRCULATION_GOOD
        elif total_internal_doors >= 1:
            return CIRCULATION_MODERATE
        return CIRCULATION_POOR

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data from sensors."""
        try:
            result = await self._async_do_update()
            # Clear coordinator-failed issue on successful update
            clear_coordinator_failed_issue(self.hass, self.entry.entry_id)
            return result
        except UpdateFailed:
            raise
        except Exception as err:
            raise_coordinator_failed_issue(self.hass, self.entry.entry_id, str(err))
            raise UpdateFailed(f"Unexpected error: {err}") from err

    async def _async_do_update(self) -> dict[str, Any]:
        """Internal update implementation."""
        data = {
            "rooms": {},
            "averages": {},
            "severity": 0,
            "status": STATUS_GOOD,
            "open_windows": [],
            "open_internal_doors": [],
            "air_circulation": CIRCULATION_POOR,
            "trends": {},
            "ventilation": {},
        }

        all_humidity = []
        all_temperature = []
        all_co2 = []
        all_voc = []
        all_formaldehyde = []
        all_pressure = []
        all_severity = []
        all_mold_risk_scores: list[int] = []  # numeric representation for averaging

        # Helper: map mold risk level to sortable int
        _MOLD_SCORE = {
            MOLD_RISK_LOW: 0,
            MOLD_RISK_MODERATE: 1,
            MOLD_RISK_HIGH: 2,
            MOLD_RISK_CRITICAL: 3,
        }
        _MOLD_FROM_SCORE = [MOLD_RISK_LOW, MOLD_RISK_MODERATE, MOLD_RISK_HIGH, MOLD_RISK_CRITICAL]

        total_outdoor_windows_open = 0
        total_internal_doors_open = 0

        # Process each room
        for room in self.rooms:
            room_name = room.get("name")
            room_data = {}

            # Humidity sensors
            if humidity_sensors := room.get(CONF_HUMIDITY_SENSORS):
                values = self._get_sensor_values(humidity_sensors, room_name)
                if values:
                    avg = sum(values) / len(values)
                    room_data["humidity"] = avg
                    room_data["humidity_sensors_count"] = len(values)
                    all_humidity.append(avg)

            # Temperature sensors
            if temp_sensors := room.get(CONF_TEMPERATURE_SENSORS):
                values = self._get_sensor_values(temp_sensors, room_name)
                if values:
                    avg = sum(values) / len(values)
                    room_data["temperature"] = avg
                    room_data["temperature_sensors_count"] = len(values)
                    all_temperature.append(avg)

            # CO2 sensors
            if co2_sensors := room.get(CONF_CO2_SENSORS):
                values = self._get_sensor_values(co2_sensors, room_name)
                if values:
                    avg = sum(values) / len(values)
                    room_data["co2"] = avg
                    room_data["co2_sensors_count"] = len(values)
                    all_co2.append(avg)

            # VOC sensors
            if voc_sensors := room.get(CONF_VOC_SENSORS):
                values = self._get_sensor_values(voc_sensors, room_name)
                if values:
                    avg = sum(values) / len(values)
                    room_data["voc"] = avg
                    room_data["voc_sensors_count"] = len(values)
                    all_voc.append(avg)

            # Formaldehyde sensors
            if formaldehyde_sensors := room.get(CONF_FORMALDEHYDE_SENSORS):
                values = self._get_sensor_values(formaldehyde_sensors, room_name)
                if values:
                    avg = sum(values) / len(values)
                    room_data["formaldehyde"] = avg
                    room_data["formaldehyde_sensors_count"] = len(values)
                    all_formaldehyde.append(avg)

            # Pressure sensors
            if pressure_sensors := room.get(CONF_PRESSURE_SENSORS):
                values = self._get_sensor_values(pressure_sensors, room_name)
                if values:
                    avg = sum(values) / len(values)
                    room_data["pressure"] = avg
                    room_data["pressure_sensors_count"] = len(values)
                    all_pressure.append(avg)

            # Mold sensors (dedicated mold/moisture sensors, optional)
            if mold_sensors := room.get(CONF_MOLD_SENSORS):
                values = self._get_sensor_values(mold_sensors, room_name)
                if values:
                    avg = sum(values) / len(values)
                    room_data["mold_humidity"] = avg  # raw humidity from mold sensor
                    room_data["mold_sensors_count"] = len(values)

            # Calculate mold risk using best available data:
            # prefer dedicated mold sensor humidity, fall back to room humidity
            mold_humidity = room_data.get("mold_humidity", room_data.get("humidity"))
            mold_temp = room_data.get("temperature")
            room_data["mold_risk"] = self._calculate_mold_risk(mold_humidity, mold_temp)

            # Collect mold risk for global average
            all_mold_risk_scores.append(_MOLD_SCORE[room_data["mold_risk"]])

            # Window/door sensors
            if window_sensors := room.get(CONF_WINDOW_SENSORS, []):
                room_outdoor_open = 0
                room_internal_open = 0

                for window in window_sensors:
                    if isinstance(window, str):
                        entity_id = window
                        is_outdoor = True  # Backward compatibility
                    elif isinstance(window, dict):
                        entity_id = window.get(CONF_WINDOW_ENTITY)
                        is_outdoor = window.get(CONF_WINDOW_IS_OUTDOOR, True)
                    else:
                        continue

                    state = self.hass.states.get(entity_id)
                    if state and state.state == "on":  # on = open
                        if is_outdoor:
                            room_outdoor_open += 1
                            total_outdoor_windows_open += 1
                            if room_name not in data["open_windows"]:
                                data["open_windows"].append(room_name)
                        else:
                            room_internal_open += 1
                            total_internal_doors_open += 1
                            if room_name not in data["open_internal_doors"]:
                                data["open_internal_doors"].append(room_name)

                room_data["outdoor_windows_open"] = room_outdoor_open
                room_data["internal_doors_open"] = room_internal_open

            # Calculate room severity
            severity = self._calculate_severity(room_data)
            room_data["severity"] = severity
            room_data["status"] = self._get_status_from_severity(severity)
            all_severity.append(severity)

            data["rooms"][room_name] = room_data

        # Calculate global averages
        if all_humidity:
            data["averages"]["humidity"] = sum(all_humidity) / len(all_humidity)
        if all_temperature:
            data["averages"]["temperature"] = sum(all_temperature) / len(all_temperature)
        if all_co2:
            data["averages"]["co2"] = sum(all_co2) / len(all_co2)
        if all_voc:
            data["averages"]["voc"] = sum(all_voc) / len(all_voc)
        if all_formaldehyde:
            data["averages"]["formaldehyde"] = sum(all_formaldehyde) / len(all_formaldehyde)
        if all_pressure:
            data["averages"]["pressure"] = sum(all_pressure) / len(all_pressure)

        # Calculate global severity
        if all_severity:
            global_severity = sum(all_severity) / len(all_severity)

            # Apply air circulation bonus
            if total_internal_doors_open > 0:
                global_severity *= CIRCULATION_BONUS  # 5% reduction

            data["severity"] = round(global_severity, 1)
            data["status"] = self._get_status_from_severity(global_severity)

        # Calculate air circulation
        data["air_circulation"] = self._calculate_air_circulation(total_internal_doors_open)

        # Calculate global mold risk (worst-room level)
        if all_mold_risk_scores:
            worst = max(all_mold_risk_scores)
            data["mold_risk"] = _MOLD_FROM_SCORE[worst]
        else:
            data["mold_risk"] = MOLD_RISK_LOW

        # Calculate trends
        if all_humidity:
            data["trends"]["humidity"] = self._calculate_trend(
                "humidity", sum(all_humidity) / len(all_humidity)
            )
        if all_co2:
            data["trends"]["co2"] = self._calculate_trend(
                "co2", sum(all_co2) / len(all_co2)
            )
        if all_severity:
            data["trends"]["severity"] = self._calculate_trend(
                "severity", data["severity"]
            )

        # Calculate ventilation recommendation
        data["ventilation"] = self._calculate_ventilation_recommendation(data)

        return data
