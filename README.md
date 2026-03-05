# Stream Deck Plugins for macOS

A collection of 6 custom Stream Deck plugins built with the [Elgato Stream Deck Node.js SDK](https://github.com/elgato/streamdeck) (`@elgato/streamdeck` v1.1). All plugins target macOS and run on Node.js 20.

## Preview

### Keypad Plugins (buttons)

<p>
  <img src="docs/images/preview-bt-connect.svg" width="100" alt="Bluetooth Connect">
  <img src="docs/images/preview-cpu-monitor.svg" width="100" alt="CPU Monitor">
  <img src="docs/images/preview-memory-monitor.svg" width="100" alt="Memory Monitor">
  <img src="docs/images/preview-claude-approve-pending.svg" width="100" alt="Claude Approve (pending)">
  <img src="docs/images/preview-claude-approve-idle.svg" width="100" alt="Claude Approve (idle)">
</p>

*Left to right: Bluetooth Connect, CPU Monitor, Memory Monitor, Claude Approve (pending), Claude Approve (idle)*

### Encoder Plugins (Stream Deck+ dials)

<p>
  <img src="docs/images/preview-calendar-events.svg" width="200" alt="Calendar Events">
  <img src="docs/images/preview-mqtt-dimmer.svg" width="200" alt="MQTT Dimmer">
</p>

*Left to right: Calendar Events, MQTT Dimmer*

## Plugins

| Plugin | Controller | Description |
|--------|-----------|-------------|
| **[sd-bt-connect](#sd-bt-connect)** | Keypad | Connect/disconnect Bluetooth devices with battery level and device type icons |
| **[sd-cpu-monitor](#sd-cpu-monitor)** | Keypad | Real-time CPU and GPU usage display |
| **[sd-memory-monitor](#sd-memory-monitor)** | Keypad | RAM, swap, and memory pressure display |
| **[sd-claude-approve](#sd-claude-approve)** | Keypad | Physical approve/deny button for [Claude Code](https://claude.ai/code) tool calls via file-based IPC |
| **[sd-calendar-events](#sd-calendar-events)** | Encoder | Browse today's calendar events and join meetings with a dial press |
| **[sd-mqtt-dimmer](#sd-mqtt-dimmer)** | Encoder | Control Zigbee lights via MQTT/Zigbee2MQTT with dial rotation |

## Requirements

- **macOS** 10.15 (Catalina) or later
- **Stream Deck** hardware with Stream Deck software 6.4+
  - Keypad plugins: any Stream Deck model
  - Encoder plugins: **Stream Deck+** only (requires dials)
- **Node.js** 20 (used by the Stream Deck runtime)
- **Xcode Command Line Tools** (for building Swift helpers): `xcode-select --install`

## Build & Install

Each plugin is self-contained with its own `package.json`. There is no monorepo workspace.

```bash
# Build and install a single plugin
cd sd-cpu-monitor
npm install
npm run build       # bundles via esbuild, compiles Swift helpers if needed
bash install.sh     # kills Stream Deck, copies plugin, restarts
```

The `install.sh` script copies the built `.sdPlugin` directory to:
```
~/Library/Application Support/com.elgato.StreamDeck/Plugins/
```

## Plugin Details

### sd-bt-connect

<img src="docs/images/preview-bt-connect.svg" width="72" alt="Bluetooth Connect" align="right">

Displays Bluetooth device connection status with battery level and device type icons (headphones, keyboard, mouse, etc.). Press the key to toggle connect/disconnect.

**How it works:** Uses `system_profiler SPBluetoothDataType` for device discovery, a custom Swift helper (`bt-info`) with the IOBluetooth framework for battery levels, and [`blueutil`](https://github.com/toy/blueutil) for connect/disconnect.

**Additional dependencies:**
- `blueutil` — install via Homebrew: `brew install blueutil`

**Settings:** Device address (auto-discovered from paired devices), display name, poll interval.

---

### sd-cpu-monitor

<img src="docs/images/preview-cpu-monitor.svg" width="72" alt="CPU Monitor" align="right">

Renders a real-time bar chart of CPU usage (user/system/idle) and GPU utilization percentage.

**How it works:** Parses output from `top -l1` for CPU stats and `ioreg -r -c IOAccelerator` for GPU utilization. All tools are built into macOS.

**Additional dependencies:** None.

---

### sd-memory-monitor

<img src="docs/images/preview-memory-monitor.svg" width="72" alt="Memory Monitor" align="right">

Shows used/total RAM, swap usage, and system memory pressure with color-coded status (green/yellow/red).

**How it works:** Uses `vm_stat`, `sysctl`, and `memory_pressure` — all built-in macOS commands.

**Additional dependencies:** None.

---

### sd-claude-approve

<img src="docs/images/preview-claude-approve-pending.svg" width="72" alt="Claude Approve" align="right">

A physical button to approve or deny Claude Code tool calls. When Claude Code requests permission, the button lights up with details of the pending action. Press to approve, long-press to deny.

**How it works:** Polls `/tmp/claude-sd-pending.json` for pending requests and writes responses to `/tmp/claude-sd-response`. Requires a companion script/hook on the Claude Code side to write/read these files.

**Additional dependencies:** None.

---

### sd-calendar-events

<img src="docs/images/preview-calendar-events.svg" width="140" alt="Calendar Events" align="right">

Displays today's calendar events on the Stream Deck+ dial. Rotate to browse events, press to join the associated meeting (Zoom, Teams, Google Meet, Webex). Touch to refresh.

**How it works:** A compiled Swift helper (`CalendarHelper.app`) uses EventKit to fetch calendar events. Meeting URLs are extracted from event location, notes, and URL fields.

**Additional dependencies:** None (Swift helper is compiled during build).

**Permissions required:**
- **Calendar access** — macOS will prompt for calendar permission on first run. Grant access in System Settings > Privacy & Security > Calendars.

**Settings:** Select which calendars to display.

---

### sd-mqtt-dimmer

<img src="docs/images/preview-mqtt-dimmer.svg" width="140" alt="MQTT Dimmer" align="right">

Controls Zigbee smart lights through a Zigbee2MQTT broker. Rotate the dial to adjust brightness, press to toggle on/off, touch to sync state.

**How it works:** Connects to an MQTT broker and publishes/subscribes to Zigbee2MQTT topics for the configured lights.

**Additional dependencies:**
- A running [Zigbee2MQTT](https://www.zigbee2mqtt.io/) instance with an accessible MQTT broker.

**Settings:** MQTT broker URL, username/password (optional), light device names.

---

## Compatibility Notes

These plugins were developed on an Apple Silicon Mac and have several compatibility limitations:

### macOS Only

All plugins use macOS-specific tools (`system_profiler`, `ioreg`, `vm_stat`, `top`, `memory_pressure`, EventKit, IOBluetooth). They will **not** work on Windows or Linux.

### Apple Silicon vs Intel

| Plugin | Apple Silicon | Intel Mac | Notes |
|--------|:---:|:---:|-------|
| sd-bt-connect | Yes | Yes | `blueutil` path resolved dynamically. Swift helper built as universal binary. |
| sd-cpu-monitor | Yes | Yes | Uses universal macOS commands. GPU metrics depend on IOAccelerator availability. |
| sd-memory-monitor | Yes | Yes | Page size detected dynamically via `sysctl hw.pagesize`. |
| sd-claude-approve | Yes | Yes | Pure Node.js, no architecture dependency. |
| sd-calendar-events | Yes | Yes | Swift helper built as universal binary (ARM64 + x86_64). |
| sd-mqtt-dimmer | Yes | Yes | Pure Node.js, no architecture dependency. |

### Known Limitations

- **sd-calendar-events** opens meeting links exclusively in Google Chrome. Other browsers are not supported.
- **sd-bt-connect** requires `blueutil` to be installed via Homebrew.
- **sd-mqtt-dimmer** stores MQTT credentials as plaintext in Stream Deck settings.

## Architecture

All plugins follow the same structure:

```
sd-<name>/
  src/
    plugin.ts              # Entry point — registers action, calls streamDeck.connect()
    <name>-action.ts       # SingletonAction subclass with @action() decorator
  ui/
    settings.html          # Property Inspector UI
  manifest.json            # Plugin manifest (action UUIDs, settings, etc.)
  build.mjs                # esbuild bundler script
  install.sh               # Build + copy to Stream Deck plugins dir
  package.json
  tsconfig.json
```

**Display rendering:**
- Keypad plugins render SVG strings, convert to base64 data URIs, and set via `action.setImage()`
- Encoder plugins use `action.setFeedback()` with custom layout JSON files

**Action UUIDs:** `com.local.<plugin-name>.<action>`

## License

Personal use. Not published to the Elgato Marketplace.
