import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type DialRotateEvent,
  type DialDownEvent,
  type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import { MqttBridge } from "./mqtt-bridge";

type DimmerSettings = {
  mqttBroker?: string;
  mqttUser?: string;
  mqttPass?: string;
  displayName?: string;
  lightName?: string;
  stepSize?: string;
  throttleMs?: string;
};

interface InstanceState {
  bridge: MqttBridge | null;
  brightness: number;
  isOn: boolean;
  settings: DimmerSettings;
  /** Timestamp of last user interaction — used to suppress MQTT feedback during active dimming */
  lastInteractionAt: number;
}

// --- Icons ---

const BULB_SVG_ON = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="18" r="16" fill="#FFC107" opacity=".2"/>
  <path d="M24 4C16.8 4 11 9.8 11 17c0 4.4 2.2 8.3 5.5 10.7 1 .7 1.5 1.7 1.5 2.8V33a2 2 0 002 2h8a2 2 0 002-2v-2.5c0-1.1.5-2.1 1.5-2.8C34.8 25.3 37 21.4 37 17c0-7.2-5.8-13-13-13z" fill="#FFC107"/>
  <rect x="19" y="36" width="10" height="2" rx="1" fill="#FFA000"/>
  <rect x="20" y="39.5" width="8" height="2" rx="1" fill="#FFA000"/>
  <path d="M20 17h8M24 13v8" stroke="#FFF" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>
</svg>`;

const BULB_SVG_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <path d="M24 4C16.8 4 11 9.8 11 17c0 4.4 2.2 8.3 5.5 10.7 1 .7 1.5 1.7 1.5 2.8V33a2 2 0 002 2h8a2 2 0 002-2v-2.5c0-1.1.5-2.1 1.5-2.8C34.8 25.3 37 21.4 37 17c0-7.2-5.8-13-13-13z" fill="#555"/>
  <rect x="19" y="36" width="10" height="2" rx="1" fill="#444"/>
  <rect x="20" y="39.5" width="8" height="2" rx="1" fill="#444"/>
</svg>`;

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const ICON_ON = svgDataUri(BULB_SVG_ON);
const ICON_OFF = svgDataUri(BULB_SVG_OFF);

// --- Rounded progress bar rendered as SVG ---

const BAR_W = 140;
const BAR_H = 12;
const BAR_R = 6;

function renderBar(pct: number, isOn: boolean): string {
  const fillW = Math.round((BAR_W * pct) / 100);
  const fillColor = isOn ? "#FFC107" : "#555";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="${BAR_H}">
    <defs><clipPath id="c"><rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_R}"/></clipPath></defs>
    <rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_R}" fill="#333"/>
    ${fillW > 0 ? `<rect width="${fillW}" height="${BAR_H}" fill="${fillColor}" clip-path="url(#c)"/>` : ""}
  </svg>`;

  return svgDataUri(svg);
}

// --- Parse light names from settings (comma or newline separated) ---

function parseLightNames(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// How long to ignore MQTT state after user interaction (ms)
const INTERACTION_COOLDOWN = 1500;

@action({ UUID: "com.local.mqtt-dimmer.dimmer" })
export class DimmerAction extends SingletonAction<DimmerSettings> {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent<DimmerSettings>): Promise<void> {
    const state: InstanceState = {
      bridge: null,
      brightness: 0,
      isOn: false,
      settings: ev.payload.settings,
      lastInteractionAt: 0,
    };
    this.instances.set(ev.action.id, state);
    await this.setupBridge(ev.action.id, ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent<DimmerSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    state?.bridge?.disconnect();
    this.instances.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<DimmerSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    state.bridge?.disconnect();
    state.settings = ev.payload.settings;
    await this.setupBridge(ev.action.id, ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent<DimmerSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state?.bridge) return;

    const step = parseInt(state.settings.stepSize || "5") || 5;
    state.brightness = Math.max(1, Math.min(254, state.brightness + ev.payload.ticks * step));
    state.isOn = true;
    state.lastInteractionAt = Date.now();

    await this.updateDisplay(ev.action, state);
    state.bridge.publishBrightness(state.brightness);
  }

  override async onDialDown(ev: DialDownEvent<DimmerSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state?.bridge) return;

    state.lastInteractionAt = Date.now();

    if (state.isOn) {
      state.isOn = false;
      state.bridge.publishToggle(false);
    } else {
      state.isOn = true;
      if (state.brightness < 1) state.brightness = 178;
      state.bridge.publishBrightness(state.brightness);
    }

    await this.updateDisplay(ev.action, state);
  }

  private async setupBridge(id: string, action: any): Promise<void> {
    const state = this.instances.get(id);
    if (!state) return;

    const { settings } = state;
    const lightNames = parseLightNames(settings.lightName);

    if (!settings.mqttBroker || lightNames.length === 0) {
      await action.setFeedback({
        icon: ICON_OFF,
        label: "Setup needed",
        value: "Config",
        bar: renderBar(0, false),
      });
      return;
    }

    const displayName = settings.displayName || lightNames[0];

    // Show title immediately — don't wait for MQTT connection
    await action.setFeedback({
      icon: ICON_OFF,
      label: displayName,
      value: "Connecting...",
      bar: renderBar(0, false),
    });

    const bridge = new MqttBridge({
      brokerUrl: settings.mqttBroker,
      username: settings.mqttUser || undefined,
      password: settings.mqttPass || undefined,
      lightNames,
      throttleMs: parseInt(settings.throttleMs || "80") || 80,
    });

    bridge.on("stateChanged", async ({ brightness, isOn }: { brightness: number; isOn: boolean }) => {
      // Suppress MQTT feedback while user is actively interacting
      if (Date.now() - state.lastInteractionAt < INTERACTION_COOLDOWN) return;

      state.brightness = brightness;
      state.isOn = isOn;
      await this.updateDisplay(action, state);
    });

    bridge.on("connected", async () => {
      await action.setFeedback({
        icon: ICON_OFF,
        label: displayName,
        value: "Syncing...",
        bar: renderBar(0, false),
      });
    });

    bridge.on("disconnected", async () => {
      await action.setFeedback({
        icon: ICON_OFF,
        label: displayName,
        value: "Offline",
        bar: renderBar(0, false),
      });
    });

    bridge.on("error", (err: Error) => {
      console.error(`MQTT error for ${displayName}:`, err.message);
    });

    state.bridge = bridge;
    bridge.connect();
  }

  private async updateDisplay(action: any, state: InstanceState): Promise<void> {
    const pct = Math.round((state.brightness / 254) * 100);
    const names = parseLightNames(state.settings.lightName);
    const displayName = state.settings.displayName || names[0] || "Light";

    await action.setFeedback({
      icon: state.isOn ? ICON_ON : ICON_OFF,
      label: displayName,
      value: state.isOn ? `${pct}%` : "OFF",
      bar: renderBar(state.isOn ? pct : 0, state.isOn),
    });
  }
}
