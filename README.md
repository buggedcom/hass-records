# Hass Records

Record custom events in Home Assistant and view them as annotation markers on history and statistics charts.

## What it does

- **`hass_records.record` service** – call from automations, scripts, or the action card to stamp a timestamped event into persistent storage and the HA logbook.
- **`hass-records-action-card`** – Lovelace form card for recording events manually with a message, tooltip annotation, icon, and colour.
- **`hass-records-history-card`** – History line chart that overlays diamond-shaped annotation markers at the timestamps of recorded events. Hover to read the tooltip.
- **`hass-records-statistics-card`** – Same as above but powered by the HA statistics (long-term) API.

## HACS category

**Integration** — the frontend cards are bundled with the integration and auto-registered; no separate resource step is needed.

## Installation

### Via HACS (recommended)

1. Open HACS → **Integrations** → ⋮ → **Custom repositories**.
2. Add the URL of this repository and set the category to **Integration**.
3. Install **Hass Records**.
4. Restart Home Assistant.

### Manual

Copy the `custom_components/hass_records` folder into your HA `config/custom_components/` directory, then restart.

## Configuration

Add to `configuration.yaml`:

```yaml
hass_records:
```

That's it. The integration registers itself and auto-loads the Lovelace cards.

## Recording an event

### From the action card

Add the card to any dashboard:

```yaml
type: custom:hass-records-action-card
title: Record Event
```

Optional config:

| Key | Description |
|-----|-------------|
| `title` | Card heading |
| `entity` | Pre-fill an entity association (hides the entity field) |

### From a service call / automation

```yaml
service: hass_records.record
data:
  message: "Switched to summer mode"
  annotation: "Thermostat set to 22 °C, scheduled for 06:00–22:00"
  entity_id: climate.living_room   # optional
  icon: mdi:thermometer             # optional, MDI icon name
  color: "#ff5722"                  # optional, hex colour
```

All fields except `message` are optional.

## Lovelace cards

### History card

```yaml
type: custom:hass-records-history-card
title: Temperature with Events
entity: sensor.living_room_temperature
hours_to_show: 24
```

Multiple entities:

```yaml
type: custom:hass-records-history-card
title: Temperatures
entities:
  - sensor.living_room_temperature
  - sensor.bedroom_temperature
hours_to_show: 48
```

### Statistics card

```yaml
type: custom:hass-records-statistics-card
title: Energy with Events
entity: sensor.daily_energy
hours_to_show: 168
period: hour          # 5minute | hour | day | week | month
stat_types:           # mean | min | max | sum | state
  - mean
```

## How annotations work

When an event is recorded, the chart cards:

1. Fetch all events that fall within the displayed time range from the backend via WebSocket.
2. Draw a dashed vertical line at the event timestamp.
3. Place a coloured diamond marker at the top of the line.
4. Show a tooltip with the **message** and full **annotation** text on mouse hover.

The `message` appears as the primary label; `annotation` is the longer tooltip body. If no annotation is given, the message doubles as the tooltip.

## Events appear in the logbook

Every recorded event is also fired as a Home Assistant bus event (`hass_records_event_recorded`) and described in the logbook via the `logbook.py` integration so it shows up in **History → Logbook** automatically.

## WebSocket API

The integration exposes two WebSocket commands consumed by the cards:

| Type | Parameters | Returns |
|------|-----------|---------|
| `hass_records/events` | `start_time`, `end_time`, `entity_id` (all optional) | `{ events: [...] }` |
| `hass_records/events/delete` | `event_id` | `{ deleted: true/false }` |

Events are stored in `.storage/hass_records.events` (HA's standard JSON storage).
