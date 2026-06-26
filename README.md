# 🏠 Indeklima

If your bathroom wall starts sweating and your bedroom feels like a rainforest, Home Assistant will tell you the humidity is 78%. But it won't tell you whether that's *dangerous* or just uncomfortable, or what to do about it.

Indeklima does.

It reads your existing temperature, humidity, CO₂, and pressure sensors and turns raw numbers into something you can actually act on — mold risk warnings, room-by-room severity scores, ventilation recommendations, even whether you should run the dehumidifier.

---

## What it does

- Pulls sensor data from any HA sensor entity — no special hardware required
- Calculates severity scores per room, so you know which room to fix first
- Estimates mold risk based on temperature + humidity combos that actually cause mold
- Tracks trends (is the humidity climbing or falling?)
- Detects whether air is circulating or going stale
- Gives plain-language recommendations: open a window, run ventilation, turn on the dehumidifier
- Shows everything in a sidebar panel and Lovelace cards

---

## Installation

### HACS (recommended)

Add this repository as a custom repository in HACS, then install "Indeklima" from the Integrations tab.

### Manual

Copy `custom_components/indeklima/` into your HA `custom_components/` folder, then restart.

```
custom_components/
└── indeklima/
    ├── __init__.py
    ├── manifest.json
    ├── sensor.py
    ├── ...
```

### After installing

Settings → Devices & Services → Add Integration → search "Indeklima".

---

## Configuration

The UI config flow will walk you through it. You'll need to:

1. Pick your temperature, humidity, CO₂, and pressure sensors (one set per room)
2. Set threshold limits for each room — what counts as "too humid" or "too stuffy"
3. Optionally, link a weather entity for outdoor reference

You can add rooms later via the integration's Options menu.

---

## Entities

Each room gets its own device with these sensors:

- Status — overall assessment
- Temperature, Humidity, CO₂, Pressure — the raw readings
- Severity Score — how bad the room is right now
- Mold Risk — low / medium / high

The Hub device aggregates across all rooms:

- Average readings
- Open windows detection
- Air circulation status
- Trends (humidity, CO₂, severity)
- Ventilation recommendation — open window / run mechanical ventilation / all good
- Dehumidifier recommendation — on / off

---

## Dashboard

Indeklima adds a sidebar panel with two tabs — one for the full-house overview, one per room. There are also Lovelace cards if you prefer to build your own dashboard.

---

## Language

The integration speaks English and Danish. If your HA is set to Danish, you'll get Danish labels automatically. All code internals are in English.

---

## If something goes wrong

If sensors drop out or the coordinator fails, Indeklima will surface it as a repair issue in HA's Repairs panel instead of silently breaking. Check Settings → System → Repairs.

For deeper troubleshooting, check the [Troubleshooting guide](TROUBLESHOOTING.md).

---

## Contributing

If you want to fix something or add a feature, the [Contributing guide](CONTRIBUTING.md) has the full setup — fork, clone, dev environment, code standards. Pull requests are welcome.

---

## License

MIT. Do what you want, just keep the license.
