import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
  type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import { HaClient, type DataPoint } from "./ha-client";
import {
  renderKeypadGraph,
  svgDataUri,
  nextTimeframe,
  type Timeframe,
  type ColorRange,
} from "./graph-renderer";
import { resolveSettings, type HaGraphSettings } from "./settings";

interface InstanceState {
  client: HaClient | null;
  dataCache: Map<string, DataPoint[]>;
  currentTimeframe: Timeframe;
  currentValue: string;
  entityName: string;
  reverseColors: boolean;
  freezeScale: boolean;
  unit: string;
  colorRange: ColorRange | undefined;
  refreshTimer: NodeJS.Timeout | null;
}

@action({ UUID: "com.local.ha-graph.keypad-graph" })
export class KeypadGraphAction extends SingletonAction<HaGraphSettings> {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent<HaGraphSettings>): Promise<void> {
    const state: InstanceState = {
      client: null,
      dataCache: new Map(),
      currentTimeframe: "1hr",
      currentValue: "",
      entityName: "",
      reverseColors: false,
      freezeScale: false,
      unit: "",
      colorRange: undefined,
      refreshTimer: null,
    };
    this.instances.set(ev.action.id, state);
    await this.setup(ev.action.id, ev.action, await resolveSettings(ev.payload.settings));
  }

  override async onWillDisappear(ev: WillDisappearEvent<HaGraphSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state) {
      state.client?.disconnect();
      if (state.refreshTimer) clearInterval(state.refreshTimer);
    }
    this.instances.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<HaGraphSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    state.client?.disconnect();
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.dataCache.clear();
    await this.setup(ev.action.id, ev.action, await resolveSettings(ev.payload.settings));
  }

  override async onKeyDown(ev: KeyDownEvent<HaGraphSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    state.currentTimeframe = nextTimeframe(state.currentTimeframe);
    await this.fetchAndRender(ev.action, state);
  }

  private async setup(id: string, action: any, settings: HaGraphSettings): Promise<void> {
    const state = this.instances.get(id);
    if (!state) return;

    const { haUrl, haToken, entityId, displayName, reverseColors, freezeScale, unit } = settings;
    state.entityName = displayName || entityId || "Sensor";
    state.reverseColors = reverseColors === "true";
    state.freezeScale = freezeScale === "true";
    state.unit = unit || "";

    if (!haUrl || !haToken || !entityId) {
      await action.setImage(svgDataUri(renderKeypadGraph([], state.entityName, "Setup", "1hr")));
      await action.setTitle("");
      return;
    }

    const client = new HaClient({ url: haUrl, token: haToken, entityId });
    state.client = client;

    client.on("connected", async () => {
      await this.fetchAndRender(action, state);
      // Pre-fetch 10-day history for color range
      try {
        const allPoints = await client.fetchHistory(client.entityId, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
        if (allPoints.length >= 2) {
          let min = Infinity, max = -Infinity;
          for (const p of allPoints) {
            if (p.value < min) min = p.value;
            if (p.value > max) max = p.value;
          }
          if (min < max) state.colorRange = { min, max };
        }
        await this.fetchAndRender(action, state);
      } catch {}
    });

    client.on("stateChanged", async ({ value }: { value: number }) => {
      state.currentValue = String(value);
      if (state.currentTimeframe === "1min") {
        await this.renderFromRingBuffer(action, state);
      }
    });

    client.on("disconnected", async () => {
      await action.setImage(svgDataUri(renderKeypadGraph([], state.entityName, "Offline", state.currentTimeframe, state.reverseColors, state.unit)));
      await action.setTitle("");
    });

    client.connect();

    // Refresh history every 60s
    state.refreshTimer = setInterval(() => this.fetchAndRender(action, state), 60000);
  }

  private async fetchAndRender(action: any, state: InstanceState): Promise<void> {
    if (!state.client) return;

    let points: DataPoint[];

    if (state.currentTimeframe === "1min") {
      points = state.client.getRingBuffer();
    } else {
      const now = new Date();
      const start = new Date(
        state.currentTimeframe === "1hr"
          ? now.getTime() - 60 * 60 * 1000
          : now.getTime() - 24 * 60 * 60 * 1000
      );
      try {
        points = await state.client.fetchHistory(
          state.client.entityId,
          start
        );
        state.dataCache.set(state.currentTimeframe, points);
      } catch {
        points = state.dataCache.get(state.currentTimeframe) || [];
      }
      if (points.length > 0) {
        state.currentValue = String(points[points.length - 1].value);
        // Extend to "now" so graph reaches the right edge
        const last = points[points.length - 1];
        const nowMs = Date.now();
        if (nowMs - last.time > 60000) {
          points.push({ time: nowMs, value: last.value });
        }
      }
    }

    const svg = renderKeypadGraph(points, state.entityName, state.currentValue, state.currentTimeframe, state.reverseColors, state.unit, state.colorRange, state.freezeScale);
    await action.setImage(svgDataUri(svg));
    await action.setTitle("");
  }

  private async renderFromRingBuffer(action: any, state: InstanceState): Promise<void> {
    if (!state.client) return;
    const points = state.client.getRingBuffer();
    const svg = renderKeypadGraph(points, state.entityName, state.currentValue, "1min", state.reverseColors, state.unit, state.colorRange, state.freezeScale);
    await action.setImage(svgDataUri(svg));
    await action.setTitle("");
  }
}
