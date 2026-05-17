"""Config flow for Indeklima integration.

Version: 2.5.0
"""
from __future__ import annotations

import logging
from typing import Any
import copy

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers import entity_registry as er

from .const import (
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
    CONF_DEHUMIDIFIER,
    CONF_FAN,
    CONF_WEATHER_ENTITY,
    CONF_NOTIFICATION_TARGETS,
    CONF_HUMIDITY_SUMMER_MAX,
    CONF_HUMIDITY_WINTER_MAX,
    CONF_CO2_MAX,
    CONF_VOC_MAX,
    CONF_FORMALDEHYDE_MAX,
    DEFAULT_HUMIDITY_SUMMER_MAX,
    DEFAULT_HUMIDITY_WINTER_MAX,
    DEFAULT_CO2_MAX,
    DEFAULT_VOC_MAX,
    DEFAULT_FORMALDEHYDE_MAX,
)

_LOGGER = logging.getLogger(__name__)


class IndeklimaConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Indeklima."""

    VERSION = 2

    def __init__(self) -> None:
        """Initialize the config flow."""
        self.rooms: list[dict[str, Any]] = []
        self._name: str = "Indeklima"
        self._temp_window_sensors: list[str] = []
        self._temp_room_config: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Handle the initial step."""
        if user_input is not None:
            await self.async_set_unique_id("indeklima")
            self._abort_if_unique_id_configured()
            
            self._name = user_input.get("name", "Indeklima")
            return await self.async_step_room_menu()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Optional("name", default="Indeklima"): str,
            }),
        )

    async def async_step_room_menu(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Room management menu."""
        errors: dict[str, str] = {}

        if user_input is not None:
            action = user_input.get("action")
            
            if action == "add":
                return await self.async_step_room_config()
            elif action == "done":
                if not self.rooms:
                    errors["base"] = "no_rooms"
                else:
                    return self.async_create_entry(
                        title=self._name,
                        data={CONF_ROOMS: self.rooms},
                        options={
                            CONF_HUMIDITY_SUMMER_MAX: DEFAULT_HUMIDITY_SUMMER_MAX,
                            CONF_HUMIDITY_WINTER_MAX: DEFAULT_HUMIDITY_WINTER_MAX,
                            CONF_CO2_MAX: DEFAULT_CO2_MAX,
                            CONF_VOC_MAX: DEFAULT_VOC_MAX,
                            CONF_FORMALDEHYDE_MAX: DEFAULT_FORMALDEHYDE_MAX,
                            CONF_WEATHER_ENTITY: None,
                        },
                    )

        rooms_text = "\n".join([f"{r['name']}" for r in self.rooms]) if self.rooms else "Ingen rum tilf\u00f8jet"

        return self.async_show_form(
            step_id="room_menu",
            data_schema=vol.Schema({
                vol.Required("action", default="add" if not self.rooms else "done"): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            {"label": "Tilf\u00f8j nyt rum", "value": "add"},
                            {"label": "F\u00e6rdig - Gem konfiguration", "value": "done"},
                        ],
                        mode=selector.SelectSelectorMode.LIST,
                    )
                ),
            }),
            description_placeholders={"rooms": rooms_text},
            errors=errors,
        )

    async def async_step_room_config(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Configure a room - step 1: basic info."""
        if user_input is not None:
            self._temp_room_config = {"name": user_input["name"]}
            
            # Store basic sensors
            for key in [CONF_HUMIDITY_SENSORS, CONF_TEMPERATURE_SENSORS,
                       CONF_CO2_SENSORS, CONF_VOC_SENSORS, 
                       CONF_FORMALDEHYDE_SENSORS, CONF_PRESSURE_SENSORS,
                       CONF_MOLD_SENSORS,
                       CONF_NOTIFICATION_TARGETS]:
                val = user_input.get(key)
                if val:
                    self._temp_room_config[key] = val if isinstance(val, list) else [val]
            
            # Store devices - ONLY if valid
            for key in [CONF_DEHUMIDIFIER, CONF_FAN]:
                val = user_input.get(key)
                if val and isinstance(val, str) and "." in val:
                    self._temp_room_config[key] = val
            
            # Store window sensors for next step
            self._temp_window_sensors = user_input.get(CONF_WINDOW_SENSORS, [])
            
            if self._temp_window_sensors:
                return await self.async_step_window_config()
            else:
                self.rooms.append(self._temp_room_config)
                return await self.async_step_room_menu()

        return self.async_show_form(
            step_id="room_config",
            data_schema=self._get_room_schema(),
        )

    async def async_step_window_config(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Configure window sensors - step 2: outdoor/indoor classification."""
        if user_input is not None:
            window_config = []
            for entity_id in self._temp_window_sensors:
                is_outdoor = user_input.get(f"outdoor_{entity_id}", True)
                window_config.append({
                    CONF_WINDOW_ENTITY: entity_id,
                    CONF_WINDOW_IS_OUTDOOR: is_outdoor,
                })
            
            self._temp_room_config[CONF_WINDOW_SENSORS] = window_config
            self.rooms.append(self._temp_room_config)
            
            self._temp_window_sensors = []
            self._temp_room_config = {}
            
            return await self.async_step_room_menu()
        
        schema_dict = {}
        entity_reg = er.async_get(self.hass)
        
        for entity_id in self._temp_window_sensors:
            entity = entity_reg.async_get(entity_id)
            friendly_name = entity.name if entity else entity_id.split(".")[-1]
            
            schema_dict[vol.Optional(f"outdoor_{entity_id}", default=True)] = selector.BooleanSelector()

        return self.async_show_form(
            step_id="window_config",
            data_schema=vol.Schema(schema_dict),
            description_placeholders={
                "info": "Marker hvilke vinduer/d\u00f8re der f\u00f8rer til udend\u00f8rs. Interne d\u00f8re mellem rum skal IKKE markeres."
            }
        )

    def _get_room_schema(self, defaults: dict | None = None) -> vol.Schema:
        """Get schema for room configuration."""
        defaults = defaults or {}
        
        window_sensors_default = defaults.get(CONF_WINDOW_SENSORS, [])
        if window_sensors_default and isinstance(window_sensors_default[0], dict):
            window_sensors_default = [w[CONF_WINDOW_ENTITY] for w in window_sensors_default]
        
        schema_dict = {
            vol.Required("name", default=defaults.get("name", "")): str,
            vol.Optional(CONF_HUMIDITY_SENSORS, default=defaults.get(CONF_HUMIDITY_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="humidity", multiple=True)
            ),
            vol.Optional(CONF_TEMPERATURE_SENSORS, default=defaults.get(CONF_TEMPERATURE_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="temperature", multiple=True)
            ),
            vol.Optional(CONF_CO2_SENSORS, default=defaults.get(CONF_CO2_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], multiple=True)
            ),
            vol.Optional(CONF_VOC_SENSORS, default=defaults.get(CONF_VOC_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], multiple=True)
            ),
            vol.Optional(CONF_FORMALDEHYDE_SENSORS, default=defaults.get(CONF_FORMALDEHYDE_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], multiple=True)
            ),
            vol.Optional(CONF_PRESSURE_SENSORS, default=defaults.get(CONF_PRESSURE_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="atmospheric_pressure", multiple=True)
            ),
            vol.Optional(CONF_MOLD_SENSORS, default=defaults.get(CONF_MOLD_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="humidity", multiple=True)
            ),
            vol.Optional(CONF_WINDOW_SENSORS, default=window_sensors_default): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["binary_sensor"], multiple=True)
            ),
            vol.Optional(CONF_NOTIFICATION_TARGETS, default=defaults.get(CONF_NOTIFICATION_TARGETS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["notify"], multiple=True)
            ),
        }
        
        # Add device selectors - NO default if value doesn't exist
        if CONF_DEHUMIDIFIER in defaults and defaults[CONF_DEHUMIDIFIER]:
            schema_dict[vol.Optional(CONF_DEHUMIDIFIER, default=defaults[CONF_DEHUMIDIFIER])] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["humidifier", "switch"])
            )
        else:
            schema_dict[vol.Optional(CONF_DEHUMIDIFIER)] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["humidifier", "switch"])
            )
        
        if CONF_FAN in defaults and defaults[CONF_FAN]:
            schema_dict[vol.Optional(CONF_FAN, default=defaults[CONF_FAN])] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["fan", "switch"])
            )
        else:
            schema_dict[vol.Optional(CONF_FAN)] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["fan", "switch"])
            )
        
        return vol.Schema(schema_dict)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> config_entries.OptionsFlow:
        """Get the options flow for this handler."""
        return IndeklimaOptionsFlow(config_entry)


class IndeklimaOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Indeklima."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self._config_entry = config_entry
        self._rooms = copy.deepcopy(list(config_entry.data.get(CONF_ROOMS, [])))
        self._selected_room_idx: int | None = None
        self._temp_window_sensors: list[str] = []
        self._temp_room_config: dict[str, Any] = {}

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Manage the options."""
        return await self.async_step_main_menu()

    async def async_step_main_menu(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Main options menu."""
        if user_input is not None:
            menu_choice = user_input.get("menu")
            
            if menu_choice == "thresholds":
                return await self.async_step_thresholds()
            elif menu_choice == "rooms":
                return await self.async_step_room_list()
            elif menu_choice == "weather":
                return await self.async_step_weather_config()

        return self.async_show_form(
            step_id="main_menu",
            data_schema=vol.Schema({
                vol.Required("menu"): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            {"label": "\u2699\ufe0f Gr\u00e6nsev\u00e6rdier", "value": "thresholds"},
                            {"label": "\U0001f3e0 Administrer rum", "value": "rooms"},
                            {"label": "\u2601\ufe0f Vejr integration", "value": "weather"},
                        ],
                        mode=selector.SelectSelectorMode.LIST,
                    )
                ),
            }),
        )

    async def async_step_thresholds(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Configure thresholds."""
        if user_input is not None:
            return self.async_create_entry(title="", data={**self._config_entry.options, **user_input})

        return self.async_show_form(
            step_id="thresholds",
            data_schema=vol.Schema({
                vol.Optional(CONF_HUMIDITY_SUMMER_MAX, default=self._config_entry.options.get(CONF_HUMIDITY_SUMMER_MAX, DEFAULT_HUMIDITY_SUMMER_MAX)): vol.All(vol.Coerce(int), vol.Range(min=40, max=80)),
                vol.Optional(CONF_HUMIDITY_WINTER_MAX, default=self._config_entry.options.get(CONF_HUMIDITY_WINTER_MAX, DEFAULT_HUMIDITY_WINTER_MAX)): vol.All(vol.Coerce(int), vol.Range(min=30, max=70)),
                vol.Optional(CONF_CO2_MAX, default=self._config_entry.options.get(CONF_CO2_MAX, DEFAULT_CO2_MAX)): vol.All(vol.Coerce(int), vol.Range(min=800, max=2000)),
                vol.Optional(CONF_VOC_MAX, default=self._config_entry.options.get(CONF_VOC_MAX, DEFAULT_VOC_MAX)): vol.All(vol.Coerce(float), vol.Range(min=1.0, max=10.0)),
                vol.Optional(CONF_FORMALDEHYDE_MAX, default=self._config_entry.options.get(CONF_FORMALDEHYDE_MAX, DEFAULT_FORMALDEHYDE_MAX)): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=0.5)),
            }),
        )

    async def async_step_room_list(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Show list of rooms with actions."""
        if user_input is not None:
            action = user_input.get("action")
            
            if action == "add":
                return await self.async_step_add_room()
            elif action.startswith("edit_"):
                self._selected_room_idx = int(action.split("_")[1])
                return await self.async_step_edit_room()
            elif action.startswith("delete_"):
                idx = int(action.split("_")[1])
                self._rooms.pop(idx)
                self.hass.config_entries.async_update_entry(
                    self._config_entry,
                    data={**self._config_entry.data, CONF_ROOMS: self._rooms},
                )
                # Reload is triggered automatically by the update listener
                return await self.async_step_room_list()
            elif action == "done":
                return await self.async_step_main_menu()

        options = [{"label": "Tilf\u00f8j nyt rum", "value": "add"}]
        
        for idx, room in enumerate(self._rooms):
            options.append({"label": f"{room['name']}", "value": f"edit_{idx}"})
            options.append({"label": f"Slet {room['name']}", "value": f"delete_{idx}"})
        
        options.append({"label": "Tilbage til hovedmenu", "value": "done"})

        return self.async_show_form(
            step_id="room_list",
            data_schema=vol.Schema({
                vol.Required("action"): selector.SelectSelector(
                    selector.SelectSelectorConfig(options=options, mode=selector.SelectSelectorMode.LIST)
                ),
            }),
        )

    async def async_step_add_room(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Add a new room - step 1."""
        if user_input is not None:
            self._temp_room_config = {"name": user_input["name"]}
            
            for key in [CONF_HUMIDITY_SENSORS, CONF_TEMPERATURE_SENSORS, CONF_CO2_SENSORS, CONF_VOC_SENSORS, CONF_FORMALDEHYDE_SENSORS, CONF_PRESSURE_SENSORS, CONF_MOLD_SENSORS, CONF_NOTIFICATION_TARGETS]:
                val = user_input.get(key)
                if val:
                    self._temp_room_config[key] = val if isinstance(val, list) else [val]
            
            for key in [CONF_DEHUMIDIFIER, CONF_FAN]:
                val = user_input.get(key)
                if val and isinstance(val, str) and "." in val:
                    self._temp_room_config[key] = val
            
            self._temp_window_sensors = user_input.get(CONF_WINDOW_SENSORS, [])
            
            if self._temp_window_sensors:
                return await self.async_step_add_room_windows()
            else:
                self._rooms.append(self._temp_room_config)
                await self._save_and_reload()
                return await self.async_step_room_list()

        return self.async_show_form(step_id="add_room", data_schema=self._get_room_schema())

    async def async_step_add_room_windows(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Configure windows for new room."""
        if user_input is not None:
            window_config = []
            for entity_id in self._temp_window_sensors:
                is_outdoor = user_input.get(f"outdoor_{entity_id}", True)
                window_config.append({CONF_WINDOW_ENTITY: entity_id, CONF_WINDOW_IS_OUTDOOR: is_outdoor})
            
            self._temp_room_config[CONF_WINDOW_SENSORS] = window_config
            self._rooms.append(self._temp_room_config)
            await self._save_and_reload()
            return await self.async_step_room_list()
        
        return self.async_show_form(
            step_id="add_room_windows",
            data_schema=self._get_window_schema(self._temp_window_sensors),
            description_placeholders={"info": "Marker hvilke vinduer/d\u00f8re der f\u00f8rer til udend\u00f8rs. Interne d\u00f8re mellem rum skal IKKE markeres."}
        )

    async def async_step_edit_room(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Edit an existing room - step 1."""
        if user_input is not None:
            self._temp_room_config = {"name": user_input["name"]}
            
            for key in [CONF_HUMIDITY_SENSORS, CONF_TEMPERATURE_SENSORS, CONF_CO2_SENSORS, CONF_VOC_SENSORS, CONF_FORMALDEHYDE_SENSORS, CONF_PRESSURE_SENSORS, CONF_MOLD_SENSORS, CONF_NOTIFICATION_TARGETS]:
                val = user_input.get(key)
                if val:
                    self._temp_room_config[key] = val if isinstance(val, list) else [val]
            
            for key in [CONF_DEHUMIDIFIER, CONF_FAN]:
                val = user_input.get(key)
                if val and isinstance(val, str) and "." in val:
                    self._temp_room_config[key] = val
            
            self._temp_window_sensors = user_input.get(CONF_WINDOW_SENSORS, [])
            
            if self._temp_window_sensors:
                return await self.async_step_edit_room_windows()
            else:
                self._rooms[self._selected_room_idx] = self._temp_room_config
                await self._save_and_reload()
                return await self.async_step_room_list()

        current_room = self._rooms[self._selected_room_idx]
        return self.async_show_form(step_id="edit_room", data_schema=self._get_room_schema(current_room))

    async def async_step_edit_room_windows(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Configure windows for existing room."""
        if user_input is not None:
            window_config = []
            for entity_id in self._temp_window_sensors:
                is_outdoor = user_input.get(f"outdoor_{entity_id}", True)
                window_config.append({CONF_WINDOW_ENTITY: entity_id, CONF_WINDOW_IS_OUTDOOR: is_outdoor})
            
            self._temp_room_config[CONF_WINDOW_SENSORS] = window_config
            self._rooms[self._selected_room_idx] = self._temp_room_config
            await self._save_and_reload()
            return await self.async_step_room_list()
        
        old_room = self._rooms[self._selected_room_idx]
        old_windows = old_room.get(CONF_WINDOW_SENSORS, [])
        existing_config = {}
        if old_windows and isinstance(old_windows[0], dict):
            existing_config = {w[CONF_WINDOW_ENTITY]: w[CONF_WINDOW_IS_OUTDOOR] for w in old_windows}
        
        return self.async_show_form(
            step_id="edit_room_windows",
            data_schema=self._get_window_schema(self._temp_window_sensors, existing_config),
            description_placeholders={"info": "Marker hvilke vinduer/d\u00f8re der f\u00f8rer til udend\u00f8rs."}
        )

    async def async_step_weather_config(self, user_input: dict[str, Any] | None = None) -> config_entries.FlowResult:
        """Configure weather integration."""
        if user_input is not None:
            return self.async_create_entry(title="", data={**self._config_entry.options, **user_input})

        return self.async_show_form(
            step_id="weather_config",
            data_schema=vol.Schema({
                vol.Optional(CONF_WEATHER_ENTITY, default=self._config_entry.options.get(CONF_WEATHER_ENTITY)): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain=["weather"])
                ),
            }),
            description_placeholders={"info": "Hvis ingen vejr-entity er valgt, bruges Home Assistants standard vejrdata."},
        )

    def _get_room_schema(self, defaults: dict | None = None) -> vol.Schema:
        """Get schema for room editing."""
        defaults = defaults or {}
        
        window_sensors_default = defaults.get(CONF_WINDOW_SENSORS, [])
        if window_sensors_default and isinstance(window_sensors_default[0], dict):
            window_sensors_default = [w[CONF_WINDOW_ENTITY] for w in window_sensors_default]
        
        schema_dict = {
            vol.Required("name", default=defaults.get("name", "")): str,
            vol.Optional(CONF_HUMIDITY_SENSORS, default=defaults.get(CONF_HUMIDITY_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="humidity", multiple=True)
            ),
            vol.Optional(CONF_TEMPERATURE_SENSORS, default=defaults.get(CONF_TEMPERATURE_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="temperature", multiple=True)
            ),
            vol.Optional(CONF_CO2_SENSORS, default=defaults.get(CONF_CO2_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], multiple=True)
            ),
            vol.Optional(CONF_VOC_SENSORS, default=defaults.get(CONF_VOC_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], multiple=True)
            ),
            vol.Optional(CONF_FORMALDEHYDE_SENSORS, default=defaults.get(CONF_FORMALDEHYDE_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], multiple=True)
            ),
            vol.Optional(CONF_PRESSURE_SENSORS, default=defaults.get(CONF_PRESSURE_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="atmospheric_pressure", multiple=True)
            ),
            vol.Optional(CONF_MOLD_SENSORS, default=defaults.get(CONF_MOLD_SENSORS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["sensor"], device_class="humidity", multiple=True)
            ),
            vol.Optional(CONF_WINDOW_SENSORS, default=window_sensors_default): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["binary_sensor"], multiple=True)
            ),
            vol.Optional(CONF_NOTIFICATION_TARGETS, default=defaults.get(CONF_NOTIFICATION_TARGETS, [])): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["notify"], multiple=True)
            ),
        }
        
        # Device selectors - NO default if value doesn't exist
        if CONF_DEHUMIDIFIER in defaults and defaults[CONF_DEHUMIDIFIER]:
            schema_dict[vol.Optional(CONF_DEHUMIDIFIER, default=defaults[CONF_DEHUMIDIFIER])] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["humidifier", "switch"])
            )
        else:
            schema_dict[vol.Optional(CONF_DEHUMIDIFIER)] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["humidifier", "switch"])
            )
        
        if CONF_FAN in defaults and defaults[CONF_FAN]:
            schema_dict[vol.Optional(CONF_FAN, default=defaults[CONF_FAN])] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["fan", "switch"])
            )
        else:
            schema_dict[vol.Optional(CONF_FAN)] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["fan", "switch"])
            )
        
        return vol.Schema(schema_dict)

    def _get_window_schema(self, window_entities: list[str], existing_config: dict[str, bool] | None = None) -> vol.Schema:
        """Get schema for window configuration."""
        existing_config = existing_config or {}
        schema_dict = {}
        entity_reg = er.async_get(self.hass)
        
        for entity_id in window_entities:
            entity = entity_reg.async_get(entity_id)
            default_value = existing_config.get(entity_id, True)
            schema_dict[vol.Optional(f"outdoor_{entity_id}", default=default_value)] = selector.BooleanSelector()
        
        return vol.Schema(schema_dict)

    async def _save_and_reload(self) -> None:
        """Save configuration and schedule reload."""
        self.hass.config_entries.async_update_entry(
            self._config_entry,
            data={**self._config_entry.data, CONF_ROOMS: self._rooms},
        )
        # Reload is triggered automatically by the update listener
        # registered in async_setup_entry via entry.add_update_listener
