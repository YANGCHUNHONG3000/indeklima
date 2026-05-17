"""Sensor platform for Indeklima integration.

Version: 2.5.0
"""
from __future__ import annotations

import logging
from datetime import datetime

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.util import dt as dt_util

from . import IndeklimaDataCoordinator
from .const import (
    DOMAIN,
    SENSOR_TYPES,
    ROOM_SENSOR_TYPES,
    CONF_HUMIDITY_SENSORS,
    CONF_TEMPERATURE_SENSORS,
    CONF_CO2_SENSORS,
    CONF_PRESSURE_SENSORS,
    CONF_MOLD_SENSORS,
    STATUS_CRITICAL,
    STATUS_WARNING,
    CIRCULATION_POOR,
    TREND_STABLE,
    VENTILATION_NO,
    MOLD_RISK_LOW,
    normalize_room_id,
    __version__,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Indeklima sensor based on a config entry."""
    coordinator: IndeklimaDataCoordinator = entry.runtime_data
    
    entities = []
    
    # Add global sensors (attached to hub device)
    for sensor_type, config in SENSOR_TYPES.items():
        entities.append(
            IndeklimaGlobalSensor(
                coordinator,
                entry,
                sensor_type,
                config,
            )
        )
    
    # Add room sensors (attached to room devices)
    for room in coordinator.rooms:
        room_name = room.get("name")
        
        # Create room ID (normalized for device identifier)
        room_id = normalize_room_id(room_name)
        
        # Add status sensor (always)
        entities.append(
            IndeklimaRoomSensor(
                coordinator,
                entry,
                room_name,
                room_id,
                "status",
            )
        )
        
        # Add temperature sensor (if room has temperature sensors)
        if room.get(CONF_TEMPERATURE_SENSORS):
            entities.append(
                IndeklimaRoomMetricSensor(
                    coordinator,
                    entry,
                    room_name,
                    room_id,
                    "temperature",
                )
            )
        
        # Add humidity sensor (if room has humidity sensors)
        if room.get(CONF_HUMIDITY_SENSORS):
            entities.append(
                IndeklimaRoomMetricSensor(
                    coordinator,
                    entry,
                    room_name,
                    room_id,
                    "humidity",
                )
            )
        
        # Add CO2 sensor (if room has CO2 sensors)
        if room.get(CONF_CO2_SENSORS):
            entities.append(
                IndeklimaRoomMetricSensor(
                    coordinator,
                    entry,
                    room_name,
                    room_id,
                    "co2",
                )
            )
        
        # Add pressure sensor (if room has pressure sensors)
        if room.get(CONF_PRESSURE_SENSORS):
            entities.append(
                IndeklimaRoomMetricSensor(
                    coordinator,
                    entry,
                    room_name,
                    room_id,
                    "pressure",
                )
            )

        # Add mold risk sensor (always — calculated from humidity + temp even
        # without a dedicated mold sensor)
        entities.append(
            IndeklimaRoomMetricSensor(
                coordinator,
                entry,
                room_name,
                room_id,
                "mold_risk",
            )
        )
    
    async_add_entities(entities)


class IndeklimaGlobalSensor(CoordinatorEntity, SensorEntity):
    """Representation of an Indeklima global sensor."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: IndeklimaDataCoordinator,
        entry: ConfigEntry,
        sensor_type: str,
        config: dict,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._sensor_type = sensor_type
        self._config = config
        self._entry = entry
        
        # Entity naming per HA guidelines
        self._attr_unique_id = f"{entry.entry_id}_{sensor_type}"
        self._attr_name = config["name"]
        self._attr_icon = config["icon"]
        self._attr_native_unit_of_measurement = config.get("unit")
        
        # Set device class if available
        if device_class := config.get("device_class"):
            self._attr_device_class = SensorDeviceClass(device_class)
        
        # Link to hub device
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry.entry_id}_hub")},
        )

    @property
    def native_value(self) -> float | str | None:
        """Return the state of the sensor."""
        if not self.coordinator.data:
            return None
        
        if self._sensor_type == "severity":
            return self.coordinator.data.get("severity")
        elif self._sensor_type == "severity_status":
            return self.coordinator.data.get("status")
        elif self._sensor_type == "open_windows":
            return len(self.coordinator.data.get("open_windows", []))
        elif self._sensor_type == "air_circulation":
            return self.coordinator.data.get("air_circulation", CIRCULATION_POOR)
        elif self._sensor_type == "ventilation_recommendation":
            ventilation = self.coordinator.data.get("ventilation", {})
            return ventilation.get("status", VENTILATION_NO)
        elif self._sensor_type == "mold_risk_avg":
            return self.coordinator.data.get("mold_risk", MOLD_RISK_LOW)
        elif self._sensor_type.startswith("trend_"):
            # Get trend value
            trend_key = self._sensor_type.replace("trend_", "")
            return self.coordinator.data.get("trends", {}).get(trend_key, TREND_STABLE)
        elif self._sensor_type.endswith("_avg"):
            # Get average value
            key = self._sensor_type.replace("_avg", "")
            return self.coordinator.data.get("averages", {}).get(key)
        
        return None
    
    @property
    def extra_state_attributes(self) -> dict:
        """Return additional attributes."""
        if self._sensor_type == "open_windows":
            rooms = self.coordinator.data.get("open_windows", [])
            internal_rooms = self.coordinator.data.get("open_internal_doors", [])
            return {
                "rum": ", ".join(rooms) if rooms else "Ingen",
                "count": len(rooms),
                "interne_d\u00f8re_rum": ", ".join(internal_rooms) if internal_rooms else "Ingen",
                "interne_d\u00f8re_count": len(internal_rooms),
            }
        elif self._sensor_type == "air_circulation":
            internal_rooms = self.coordinator.data.get("open_internal_doors", [])
            return {
                "interne_d\u00f8re_\u00e5bne": len(internal_rooms),
                "rum_med_\u00e5bne_d\u00f8re": ", ".join(internal_rooms) if internal_rooms else "Ingen",
            }
        elif self._sensor_type == "ventilation_recommendation":
            ventilation = self.coordinator.data.get("ventilation", {})
            attrs = {
                "begrundelse": ", ".join(ventilation.get("reason", [])),
                "rum": ", ".join(ventilation.get("rooms", [])) if ventilation.get("rooms") else "Ingen specifikke",
            }
            if ventilation.get("outdoor_temp") is not None:
                attrs["ude_temperatur"] = round(ventilation["outdoor_temp"], 1)
            if ventilation.get("outdoor_humidity") is not None:
                attrs["ude_fugtighed"] = round(ventilation["outdoor_humidity"], 1)
            return attrs
        return {}


class IndeklimaRoomSensor(CoordinatorEntity, SensorEntity):
    """Representation of an Indeklima room status sensor."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: IndeklimaDataCoordinator,
        entry: ConfigEntry,
        room_name: str,
        room_id: str,
        sensor_type: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._room_name = room_name
        self._room_id = room_id
        self._sensor_type = sensor_type
        self._entry = entry
        self._last_notified: datetime | None = None
        
        # Entity naming per HA guidelines
        self._attr_unique_id = f"{entry.entry_id}_room_{room_id}_status"
        self._attr_name = "Status"  # Will show as "Indeklima Stue Status"
        
        # Link to room device
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry.entry_id}_room_{room_id}")},
        )

    @property
    def native_value(self) -> str | None:
        """Return the state of the sensor."""
        if not self.coordinator.data:
            return None
        
        room_data = self.coordinator.data.get("rooms", {}).get(self._room_name, {})
        return room_data.get("status", "unknown")
    
    @property
    def icon(self) -> str:
        """Return the icon based on status."""
        status = self.native_value
        if status == CIRCULATION_POOR:
            return "mdi:alert-circle"
        elif status == STATUS_WARNING:
            return "mdi:alert"
        return "mdi:check-circle"
    
    @property
    def extra_state_attributes(self) -> dict:
        """Return room-specific attributes."""
        if not self.coordinator.data:
            return {}
        
        room_data = self.coordinator.data.get("rooms", {}).get(self._room_name, {})
        
        attrs = {}
        
        # Add sensor values (backward compatible - keep these in attributes)
        if "humidity" in room_data:
            attrs["fugtighed"] = round(room_data["humidity"], 1)
            if "humidity_sensors_count" in room_data:
                attrs["fugtighed_sensorer"] = room_data["humidity_sensors_count"]
        
        if "temperature" in room_data:
            attrs["temperatur"] = round(room_data["temperature"], 1)
            if "temperature_sensors_count" in room_data:
                attrs["temperatur_sensorer"] = room_data["temperature_sensors_count"]
        
        if "co2" in room_data:
            attrs["co2"] = round(room_data["co2"], 0)
            if "co2_sensors_count" in room_data:
                attrs["co2_sensorer"] = room_data["co2_sensors_count"]
        
        if "voc" in room_data:
            attrs["voc"] = round(room_data["voc"], 0)
            if "voc_sensors_count" in room_data:
                attrs["voc_sensorer"] = room_data["voc_sensors_count"]
        
        if "formaldehyde" in room_data:
            attrs["formaldehyd"] = round(room_data["formaldehyde"], 0)
            if "formaldehyde_sensors_count" in room_data:
                attrs["formaldehyd_sensorer"] = room_data["formaldehyde_sensors_count"]
        
        if "pressure" in room_data:
            attrs["lufttryk"] = round(room_data["pressure"], 1)
            if "pressure_sensors_count" in room_data:
                attrs["lufttryk_sensorer"] = room_data["pressure_sensors_count"]
        
        # Add window/door status
        if "outdoor_windows_open" in room_data:
            attrs["vinduer_udend\u00f8rs_\u00e5bne"] = room_data["outdoor_windows_open"]
        
        if "internal_doors_open" in room_data:
            attrs["d\u00f8re_interne_\u00e5bne"] = room_data["internal_doors_open"]
            # Add indicator if room has good air circulation
            if room_data["internal_doors_open"] > 0:
                attrs["luftcirkulation_bonus"] = True
        
        # Add last_notified timestamp for cooldown logic
        if self._last_notified:
            attrs["last_notified"] = self._last_notified.isoformat()
        
        return attrs
    
    def set_last_notified(self, timestamp: datetime | None = None) -> None:
        """Set the last notified timestamp."""
        self._last_notified = timestamp or dt_util.utcnow()
        self.async_write_ha_state()


class IndeklimaRoomMetricSensor(CoordinatorEntity, SensorEntity):
    """Representation of an Indeklima room metric sensor (temperature, humidity, CO2, pressure)."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: IndeklimaDataCoordinator,
        entry: ConfigEntry,
        room_name: str,
        room_id: str,
        sensor_type: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._room_name = room_name
        self._room_id = room_id
        self._sensor_type = sensor_type
        self._entry = entry
        
        # Get configuration from ROOM_SENSOR_TYPES
        config = ROOM_SENSOR_TYPES[sensor_type]
        
        # Entity naming per HA guidelines
        self._attr_unique_id = f"{entry.entry_id}_room_{room_id}_{sensor_type}"
        self._attr_name = config["name"]
        self._attr_icon = config["icon"]
        self._attr_native_unit_of_measurement = config.get("unit")
        
        # Set device class if available
        if device_class := config.get("device_class"):
            self._attr_device_class = SensorDeviceClass(device_class)
        
        # Link to room device
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry.entry_id}_room_{room_id}")},
        )

    @property
    def native_value(self) -> float | None:
        """Return the state of the sensor."""
        if not self.coordinator.data:
            return None
        
        room_data = self.coordinator.data.get("rooms", {}).get(self._room_name, {})
        
        # Get the value based on sensor type
        value = room_data.get(self._sensor_type)
        
        if value is None:
            return None

        # Round based on sensor type
        if self._sensor_type == "co2":
            return round(value, 0)
        elif self._sensor_type == "pressure":
            return round(value, 1)
        elif self._sensor_type == "mold_risk":
            # mold_risk is a string level — return as-is
            return value
        else:
            return round(value, 1)
    
    @property
    def extra_state_attributes(self) -> dict:
        """Return additional attributes showing individual sensor values."""
        if not self.coordinator.data:
            return {}
        
        room_data = self.coordinator.data.get("rooms", {}).get(self._room_name, {})
        
        attrs = {}
        
        # Add count of sensors used
        count_key = f"{self._sensor_type}_sensors_count"
        if count_key in room_data:
            attrs["sensorer_brugt"] = room_data[count_key]
        
        return attrs
