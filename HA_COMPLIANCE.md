# Home Assistant Compliance Checklist

This document tracks how Indeklima follows Home Assistant's official guidelines.

**Last Updated:** May 2026 (v2.4.1)

---

## ✅ Integration Quality Scale — Silver Tier (approaching Gold)

Based on: https://developers.home-assistant.io/docs/integration_quality_scale_index/

### Bronze Requirements ✅
- ✅ **Config flow** — Complete UI-based setup, no YAML
- ✅ **Async** — All functions are async, no blocking calls
- ✅ **Entity naming** — `has_entity_name = True` throughout
- ✅ **Device info** — All entities have `DeviceInfo`
- ✅ **Unique IDs** — All entities have `unique_id`
- ✅ **Documentation** — README.md and CHANGELOG files
- ✅ **Code style** — Type hints, docstrings, English constants

### Silver Requirements ✅
- ✅ **Device registry** — Hub + room devices, `via_device` linking
- ✅ **Entity categorization** — Correct `SensorDeviceClass` per sensor
- ✅ **Options flow** — Full options flow: thresholds, rooms, weather entity
- ✅ **Translations** — `strings.json` (EN) + `translations/da.json` (DA)
- ✅ **Error handling** — `ConfigEntryNotReady`, `UpdateFailed`, try/catch, logging
- ✅ **Coordinator pattern** — `DataUpdateCoordinator` with 5-min interval
- ✅ **Quality scale declared** — `quality_scale: silver` in `manifest.json`

### Gold Requirements
- ✅ **Diagnostics** — Config entry + per-device diagnostics (`diagnostics.py`)
- ✅ **System health** — Appears in HA system info (`system_health.py`)
- ✅ **Repair flow** — Actionable issues for sensor/coordinator failures (`repairs.py`)
- ✅ **Setup failure handling** — `ConfigEntryNotReady` + `UpdateFailed`
- ✅ **`entry.runtime_data`** — Modern HA pattern, no raw `hass.data` in sensor.py
- 🔄 **Test coverage >95%** — Tests written, coverage to be verified

---

## 📋 Entity Guidelines

### Naming ✅
```python
_attr_has_entity_name = True
_attr_name = "Status"  # Device name prepended automatically
```
Results in: `sensor.indeklima_hub_status`, `sensor.indeklima_stue_humidity`

### Device Info ✅
```python
DeviceInfo(
    identifiers={(DOMAIN, f"{entry.entry_id}_hub")},
    name="Indeklima Hub",
    manufacturer="Indeklima",
    model="Climate Monitor v2",
    sw_version=__version__,
)
```

### Unique IDs ✅
```python
self._attr_unique_id = f"{entry.entry_id}_{sensor_type}"
```

---

## 🗃️ Device Registry

```
Indeklima Hub
├── Severity Score
├── Status
├── Average Humidity / Temperature / CO2 / Pressure
├── Open Windows
├── Air Circulation
├── Trend: Humidity / CO2 / Severity
└── Ventilation Recommendation

Indeklima Stue  (via Hub)
├── Status
├── Temperature
├── Humidity
├── CO2
└── Pressure

Indeklima Soveværelse  (via Hub)
└── ...
```

---

## 🔄 Data Flow

```
Physical Sensors
    → HA States
    → IndeklimaDataCoordinator._async_do_update()
        ├── _get_sensor_values()  [raises repair issues if unavailable]
        ├── _calculate_severity()
        ├── _calculate_trend()
        ├── _calculate_air_circulation()
        └── _calculate_ventilation_recommendation()
    → coordinator.data
    → CoordinatorEntity sensors update
    → WebSocket → Sidebar Panel
```

---

## 🏗️ Modern HA Patterns Used

### `entry.runtime_data` ✅ (v2.4.1)
```python
# async_setup_entry in __init__.py
entry.runtime_data = coordinator

# sensor.py
coordinator = entry.runtime_data
```

### `ConfigEntryNotReady` ✅
```python
try:
    await coordinator.async_config_entry_first_refresh()
except Exception as err:
    raise ConfigEntryNotReady(...) from err
```

### `UpdateFailed` ✅
```python
async def _async_update_data(self):
    try:
        result = await self._async_do_update()
        clear_coordinator_failed_issue(...)
        return result
    except Exception as err:
        raise_coordinator_failed_issue(...)
        raise UpdateFailed(...) from err
```

### Repair flow ✅
```python
# repairs.py
async def async_create_fix_flow(hass, issue_id, data) -> RepairsFlow:
    if issue_id.startswith(ISSUE_SENSOR_UNAVAILABLE):
        return SensorUnavailableRepairFlow()
    if issue_id.startswith(ISSUE_COORDINATOR_FAILED):
        return CoordinatorFailedRepairFlow()
```

---

## 🌍 Translations

- `strings.json` — English (primary)
- `translations/da.json` — Danish
- Sections: `config`, `options`, `entity`, `system_health`, `issues`

All code uses English constants; translations are in JSON only.

---

## 🧪 Testing

```
tests/
├── conftest.py         # Shared fixtures and helpers
├── test_const.py       # version, constants, normalize_room_id
├── test_init.py        # coordinator: season, severity, status, trends, circulation, sensor values
├── test_repairs.py     # issue raising/clearing, fix flow factory
├── test_websocket.py   # WS handlers, room sorting, error paths
└── test_diagnostics.py # config entry + device diagnostics
```

Run:
```bash
pytest --cov=custom_components/indeklima --cov-report=term-missing
```

---

## 📦 Manifest

```json
{
  "domain": "indeklima",
  "name": "Indeklima",
  "version": "2.4.1",
  "config_flow": true,
  "integration_type": "hub",
  "iot_class": "local_polling",
  "quality_scale": "silver",
  "codeowners": ["@kingpainter"],
  "documentation": "https://github.com/kingpainter/indeklima",
  "issue_tracker": "https://github.com/kingpainter/indeklima/issues",
  "requirements": [],
  "dependencies": []
}
```

`quality_scale` bumpes til `gold` når test-coverage er verificeret >95%.

---

## 📈 Severity Scoring

| Metric | Max points |
|---|---|
| Humidity (over threshold) | 30 |
| CO2 (over threshold) | 30 |
| VOC (over threshold) | 20 |
| Formaldehyde (over threshold) | 20 |
| Pressure | 0 — informational only |
| Air circulation bonus | −5% af samlet score |

| Score | Status |
|---|---|
| 0–29 | Good |
| 30–59 | Warning |
| 60–100 | Critical |

---

## 📚 Reference

- [Integration Quality Scale](https://developers.home-assistant.io/docs/integration_quality_scale_index/)
- [Entity Guidelines](https://developers.home-assistant.io/docs/core/entity/)
- [Device Registry](https://developers.home-assistant.io/docs/device_registry_index/)
- [Repairs](https://developers.home-assistant.io/docs/repairs/)
- [Diagnostics](https://developers.home-assistant.io/docs/diagnostics/)
- [Config Flow](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/)
- [Data Coordinator](https://developers.home-assistant.io/docs/integration_fetching_data/)
