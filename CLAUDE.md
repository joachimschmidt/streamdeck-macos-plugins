# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Monorepo of 6 Stream Deck plugins for macOS, built with the Elgato Stream Deck Node.js SDK (`@elgato/streamdeck` v1.1). Each plugin is a self-contained directory with its own `package.json`, build script, and install script. All plugins target macOS only and run on Node.js 20.

## Plugins

| Directory | Controller | Description |
|---|---|---|
| `sd-bt-connect` | Keypad | Bluetooth device connect/disconnect with battery + device type icons |
| `sd-cpu-monitor` | Keypad | CPU/GPU usage display (via `top` and `ioreg`) |
| `sd-memory-monitor` | Keypad | RAM/swap/pressure display (via `vm_stat`, `sysctl`, `memory_pressure`) |
| `sd-claude-approve` | Keypad | Physical approve button for Claude Code tool calls (file-based IPC) |
| `sd-calendar-events` | Encoder (dial) | Today's calendar events with meeting join (uses Swift EventKit helper) |
| `sd-mqtt-dimmer` | Encoder (dial) | Zigbee light dimmer via MQTT/Zigbee2MQTT |

## Build & Install

Each plugin is independent. There is no root-level package.json or workspace config.

```bash
# Build a single plugin (from its directory)
cd sd-cpu-monitor
npm install
npm run build          # runs build.mjs via esbuild

# Install to Stream Deck (kills Stream Deck, copies .sdPlugin, restarts)
bash install.sh
```

The build script (`build.mjs`) in each plugin:
1. Bundles `src/plugin.ts` → `com.local.<name>.sdPlugin/bin/plugin.js` using esbuild (CJS, node20)
2. Copies `manifest.json`, `ui/settings.html`, and layout files into the `.sdPlugin` directory
3. For `sd-bt-connect`: compiles `helpers/bt-info.swift` (requires IOBluetooth framework)
4. For `sd-calendar-events`: compiles `src/swift/CalendarHelper.swift` into a `.app` bundle (requires EventKit framework, needs TCC calendar permission)
5. Generates placeholder PNG icons

## Architecture

**Plugin entry point pattern** — Every plugin follows the same structure:
- `src/plugin.ts`: registers the action and calls `streamDeck.connect()`
- `src/<name>-action.ts`: the `SingletonAction` subclass with `@action()` decorator containing all logic

**Display rendering** — Keypad plugins (bt-connect, cpu-monitor, memory-monitor, claude-approve) render SVG strings, convert to base64 data URIs, and set via `action.setImage()`. Encoder plugins (calendar-events, mqtt-dimmer) use `action.setFeedback()` with layout fields.

**External dependencies**:
- `sd-bt-connect`: requires `blueutil` at `/opt/homebrew/bin/blueutil` and a compiled Swift `bt-info` binary
- `sd-calendar-events`: requires a compiled Swift `CalendarHelper.app` bundle with macOS calendar permissions
- `sd-mqtt-dimmer`: uses the `mqtt` npm package to communicate with a Zigbee2MQTT broker

**IPC** — `sd-claude-approve` uses file-based IPC: polls `/tmp/claude-sd-pending.json` for pending tool calls, writes approval to `/tmp/claude-sd-response`.

## Key Conventions

- TypeScript with `strict: true`, ES2022 target, `experimentalDecorators` enabled
- ESM packages (`"type": "module"`) but esbuild outputs CJS for the Stream Deck runtime
- Action UUIDs follow `com.local.<plugin-name>.<action>` pattern
- Plugin IDs follow `com.local.<plugin-name>` pattern
- Settings types are defined as TypeScript type aliases (e.g., `BtSettings`, `DimmerSettings`)
- Instance state tracked in `Map<string, InstanceState>` keyed by `ev.action.id`
- Stream Deck install path: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
