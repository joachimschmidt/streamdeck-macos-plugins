import streamDeck, {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
  type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer, type Server } from "http";
import { dirname, join } from "path";

const exec = promisify(execFile);

type BtSettings = {
  deviceAddress?: string;
  displayName?: string;
  pollInterval?: string;
};

interface InstanceState {
  settings: BtSettings;
  connected: boolean;
  busy: boolean;
  battery: number | null;
  deviceType: DeviceType;
  pollTimer: ReturnType<typeof setInterval> | null;
}

// --- Device type from system_profiler ---

type DeviceType = "headphones" | "speaker" | "keyboard" | "mouse" | "phone" | "gamepad" | "generic";

let deviceTypeCache = new Map<string, DeviceType>();
let typeCacheTime = 0;
const CACHE_TTL = 60_000;

function minorTypeToDeviceType(minorType: string): DeviceType {
  const t = minorType.toLowerCase();
  if (t.includes("headset") || t.includes("headphone")) return "headphones";
  if (t.includes("speaker") || t.includes("loudspeaker")) return "speaker";
  if (t.includes("keyboard")) return "keyboard";
  if (t.includes("mouse") || t.includes("trackpad") || t.includes("pointing")) return "mouse";
  if (t.includes("phone") || t.includes("smartphone")) return "phone";
  if (t.includes("gamepad") || t.includes("joystick")) return "gamepad";
  return "generic";
}

async function refreshDeviceTypes(): Promise<void> {
  if (Date.now() - typeCacheTime < CACHE_TTL) return;
  try {
    const { stdout } = await exec("system_profiler", ["SPBluetoothDataType", "-json"]);
    const data = JSON.parse(stdout);
    const newCache = new Map<string, DeviceType>();
    for (const section of data.SPBluetoothDataType || []) {
      for (const key of Object.keys(section)) {
        if (!key.toLowerCase().includes("device")) continue;
        const devs = section[key];
        if (!Array.isArray(devs)) continue;
        for (const d of devs) {
          for (const [, info] of Object.entries(d) as [string, any][]) {
            const addr = (info.device_address || "").replace(/:/g, "-").toLowerCase();
            if (addr) newCache.set(addr, minorTypeToDeviceType(info.device_minorType || ""));
          }
        }
      }
    }
    deviceTypeCache = newCache;
    typeCacheTime = Date.now();
  } catch { /* keep stale cache */ }
}

function getDeviceType(address: string): DeviceType {
  return deviceTypeCache.get(address.toLowerCase()) || "generic";
}

// --- bt-info helper for connection + battery ---

// Resolve path to bt-info binary bundled in plugin
const BT_INFO = join(dirname(dirname(__filename)), "bin", "bt-info");
const BLUEUTIL = "/opt/homebrew/bin/blueutil";

interface BtInfoDevice {
  name: string;
  address: string;
  connected: boolean;
  battery?: number;
}

async function getBtInfo(): Promise<BtInfoDevice[]> {
  try {
    const { stdout } = await exec(BT_INFO, [], { timeout: 5000 });
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

async function isConnected(address: string): Promise<{ connected: boolean; battery: number | null }> {
  const devices = await getBtInfo();
  const norm = address.toLowerCase();
  const dev = devices.find((d) => d.address.toLowerCase() === norm);
  return {
    connected: dev?.connected ?? false,
    battery: dev?.battery ?? null,
  };
}

async function toggleConnection(address: string, connect: boolean): Promise<void> {
  await exec(BLUEUTIL, [connect ? "--connect" : "--disconnect", address], {
    timeout: 15000,
  });
}

// --- SVG icon paths per device type ---

const ICON_PATHS: Record<DeviceType, string> = {
  headphones: `
    <path d="M36 72c0-19.9 16.1-36 36-36s36 16.1 36 36" fill="none" stroke="__COLOR__" stroke-width="7" stroke-linecap="round"/>
    <rect x="28" y="68" width="16" height="28" rx="8" fill="__COLOR__"/>
    <rect x="100" y="68" width="16" height="28" rx="8" fill="__COLOR__"/>
  `,
  speaker: `
    <rect x="44" y="32" width="56" height="80" rx="12" fill="none" stroke="__COLOR__" stroke-width="6"/>
    <circle cx="72" cy="82" r="16" fill="none" stroke="__COLOR__" stroke-width="5"/>
    <circle cx="72" cy="82" r="4" fill="__COLOR__"/>
    <circle cx="72" cy="50" r="6" fill="none" stroke="__COLOR__" stroke-width="4"/>
  `,
  keyboard: `
    <rect x="24" y="48" width="96" height="48" rx="10" fill="none" stroke="__COLOR__" stroke-width="6"/>
    <rect x="38" y="60" width="8" height="8" rx="2" fill="__COLOR__"/>
    <rect x="52" y="60" width="8" height="8" rx="2" fill="__COLOR__"/>
    <rect x="66" y="60" width="8" height="8" rx="2" fill="__COLOR__"/>
    <rect x="80" y="60" width="8" height="8" rx="2" fill="__COLOR__"/>
    <rect x="94" y="60" width="8" height="8" rx="2" fill="__COLOR__"/>
    <rect x="44" y="76" width="8" height="8" rx="2" fill="__COLOR__"/>
    <rect x="58" y="76" width="28" height="8" rx="2" fill="__COLOR__"/>
    <rect x="92" y="76" width="8" height="8" rx="2" fill="__COLOR__"/>
  `,
  mouse: `
    <rect x="48" y="28" width="48" height="80" rx="24" fill="none" stroke="__COLOR__" stroke-width="6"/>
    <line x1="72" y1="28" x2="72" y2="60" stroke="__COLOR__" stroke-width="4"/>
    <circle cx="72" cy="50" r="5" fill="__COLOR__"/>
  `,
  phone: `
    <rect x="46" y="24" width="52" height="96" rx="12" fill="none" stroke="__COLOR__" stroke-width="6"/>
    <line x1="60" y1="104" x2="84" y2="104" stroke="__COLOR__" stroke-width="4" stroke-linecap="round"/>
    <circle cx="72" cy="36" r="3" fill="__COLOR__"/>
  `,
  gamepad: `
    <path d="M40 60c-8 0-16 8-16 18s4 22 10 22 10-8 14-8h48c4 0 8 8 14 8s10-12 10-22-8-18-16-18z" fill="none" stroke="__COLOR__" stroke-width="6"/>
    <line x1="52" y1="68" x2="52" y2="82" stroke="__COLOR__" stroke-width="4" stroke-linecap="round"/>
    <line x1="45" y1="75" x2="59" y2="75" stroke="__COLOR__" stroke-width="4" stroke-linecap="round"/>
    <circle cx="86" cy="70" r="4" fill="__COLOR__"/>
    <circle cx="96" cy="80" r="4" fill="__COLOR__"/>
  `,
  generic: `
    <path d="M72 28l24 24-24 24 24 24-24 24V76L56 92l-8-8 20-20-20-20 8-8 16 16V28z" fill="__COLOR__" stroke="__COLOR__" stroke-width="2" stroke-linejoin="round"/>
  `,
};

function buildIcon(deviceType: DeviceType, connected: boolean, battery: number | null): string {
  const color = connected ? "#4FC3F7" : "#555";
  const glow = connected
    ? `<circle cx="72" cy="72" r="56" fill="${color}" opacity=".08"/>`
    : "";
  const statusDot = connected
    ? `<circle cx="112" cy="112" r="14" fill="#1a1a2e"/><circle cx="112" cy="112" r="10" fill="#4CAF50"/>`
    : `<circle cx="112" cy="112" r="14" fill="#1a1a2e"/><circle cx="112" cy="112" r="10" fill="#666"/><line x1="106" y1="106" x2="118" y2="118" stroke="#E57373" stroke-width="3" stroke-linecap="round"/>`;

  let batteryIndicator = "";
  if (battery !== null && connected) {
    const bColor = battery > 20 ? "#4CAF50" : battery > 10 ? "#FFA726" : "#E57373";
    batteryIndicator = `
      <rect x="96" y="16" width="32" height="16" rx="3" fill="#1a1a2e" stroke="${bColor}" stroke-width="2"/>
      <rect x="128" y="21" width="4" height="6" rx="1" fill="${bColor}"/>
      <rect x="99" y="19" width="${Math.round(26 * battery / 100)}" height="10" rx="2" fill="${bColor}"/>
    `;
  }

  const body = (glow + ICON_PATHS[deviceType] + statusDot + batteryIndicator).replace(/__COLOR__/g, color);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
  ${body}
</svg>`;
}

function buildBusyIcon(deviceType: DeviceType): string {
  const body = ICON_PATHS[deviceType].replace(/__COLOR__/g, "#FFA726");
  const spinner = `<circle cx="112" cy="112" r="14" fill="#1a1a2e"/><circle cx="112" cy="112" r="10" fill="none" stroke="#FFA726" stroke-width="3" stroke-dasharray="15 10" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
  ${body}${spinner}
</svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// --- Tiny HTTP server so PI can fetch device list ---

const API_PORT = 57821;
let apiServer: Server | null = null;

function startApiServer(): void {
  if (apiServer) return;
  apiServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/devices") {
      try {
        await refreshDeviceTypes();
        const devices = await getBtInfo();
        const result = devices.map((d) => ({
          ...d,
          type: getDeviceType(d.address),
        }));
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  apiServer.listen(API_PORT, "127.0.0.1");
  apiServer.on("error", (err) => {
    console.error("API server error:", err);
  });
}

// --- Action ---

@action({ UUID: "com.local.bt-connect.toggle" })
export class BtConnectAction extends SingletonAction<BtSettings> {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent<BtSettings>): Promise<void> {
    startApiServer();
    await refreshDeviceTypes();

    const address = ev.payload.settings.deviceAddress?.trim() || "";
    const state: InstanceState = {
      settings: ev.payload.settings,
      connected: false,
      busy: false,
      battery: null,
      deviceType: getDeviceType(address),
      pollTimer: null,
    };
    this.instances.set(ev.action.id, state);
    await this.startPolling(ev.action.id, ev.action);
    await this.checkAndUpdate(ev.action.id, ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent<BtSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state?.pollTimer) clearInterval(state.pollTimer);
    this.instances.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BtSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    state.settings = ev.payload.settings;
    const address = state.settings.deviceAddress?.trim() || "";
    state.deviceType = getDeviceType(address);
    if (state.pollTimer) clearInterval(state.pollTimer);
    await this.startPolling(ev.action.id, ev.action);
    await this.checkAndUpdate(ev.action.id, ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<BtSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state || state.busy) return;

    const address = state.settings.deviceAddress?.trim();
    if (!address) return;

    state.busy = true;
    const target = !state.connected;
    await this.updateDisplay(ev.action, state);

    try {
      await toggleConnection(address, target);
      state.connected = target;
      if (!target) state.battery = null;
    } catch (err: any) {
      console.error(`BT toggle failed:`, err.message);
    }

    state.busy = false;
    await this.checkAndUpdate(ev.action.id, ev.action);
  }

  private async startPolling(id: string, action: any): Promise<void> {
    const state = this.instances.get(id);
    if (!state) return;

    const interval = Math.max(3, parseInt(state.settings.pollInterval || "5") || 5) * 1000;
    state.pollTimer = setInterval(() => this.checkAndUpdate(id, action), interval);
  }

  private async checkAndUpdate(id: string, action: any): Promise<void> {
    const state = this.instances.get(id);
    if (!state || state.busy) return;

    const address = state.settings.deviceAddress?.trim();
    if (!address) {
      await action.setImage(svgDataUri(buildIcon("generic", false, null)));
      await action.setTitle("");
      return;
    }

    const info = await isConnected(address);
    state.connected = info.connected;
    state.battery = info.battery;
    await refreshDeviceTypes();
    state.deviceType = getDeviceType(address);
    await this.updateDisplay(action, state);
  }

  private async updateDisplay(action: any, state: InstanceState): Promise<void> {
    const displayName = state.settings.displayName?.trim() || "";
    const dt = state.deviceType;

    if (state.busy) {
      await action.setImage(svgDataUri(buildBusyIcon(dt)));
      await action.setTitle(displayName || "");
      return;
    }

    await action.setImage(svgDataUri(buildIcon(dt, state.connected, state.battery)));

    // Only show text if explicitly configured or battery available
    const parts: string[] = [];
    if (displayName) parts.push(displayName);
    if (state.battery !== null && state.connected) parts.push(`${state.battery}%`);

    await action.setTitle(parts.join("\n"));
  }
}
