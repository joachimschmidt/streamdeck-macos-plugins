import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type DialRotateEvent,
  type DialDownEvent,
  type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import { HaClient, type DataPoint } from "./ha-client";
import { renderEncoderGraph, svgDataUri, type ColorRange } from "./graph-renderer";
import { resolveSettings, type HaGraphSettings } from "./settings";

// Progressive zoom levels in minutes (index 0 = most zoomed out)
const ZOOM_LEVELS = [
  { minutes: 10 * 24 * 60, label: "10d" },
  { minutes: 8 * 24 * 60, label: "8d" },
  { minutes: 7 * 24 * 60, label: "7d" },
  { minutes: 6 * 24 * 60, label: "6d" },
  { minutes: 5 * 24 * 60, label: "5d" },
  { minutes: 4 * 24 * 60, label: "4d" },
  { minutes: 3 * 24 * 60, label: "3d" },
  { minutes: 2 * 24 * 60, label: "2d" },
  { minutes: 36 * 60, label: "36h" },
  { minutes: 24 * 60, label: "1d" },
  { minutes: 18 * 60, label: "18h" },
  { minutes: 12 * 60, label: "12h" },
  { minutes: 8 * 60, label: "8h" },
  { minutes: 6 * 60, label: "6h" },
  { minutes: 4 * 60, label: "4h" },
  { minutes: 3 * 60, label: "3h" },
  { minutes: 2 * 60, label: "2h" },
  { minutes: 90, label: "90m" },
  { minutes: 60, label: "1h" },
  { minutes: 45, label: "45m" },
  { minutes: 30, label: "30m" },
  { minutes: 20, label: "20m" },
  { minutes: 15, label: "15m" },
  { minutes: 10, label: "10m" },
  { minutes: 5, label: "5m" },
  { minutes: 2, label: "2m" },
  { minutes: 1, label: "1m" },
];

const DEFAULT_ZOOM_INDEX = 18; // 1 hour

interface InstanceState {
  client: HaClient | null;
  allData: DataPoint[];
  maxFetchedMinutes: number;
  pendingFetch: Promise<void> | null;
  zoomIndex: number;
  currentValue: string;
  entityName: string;
  reverseColors: boolean;
  freezeScale: boolean;
  unit: string;
  refreshTimer: NodeJS.Timeout | null;
}

/** Slice points from allData that fall within the last `minutes`.
 *  Carries forward the last value before the window so the graph
 *  always has a starting point even if the sensor hasn't reported recently. */
function sliceWindow(allData: DataPoint[], minutes: number): DataPoint[] {
  const cutoff = Date.now() - minutes * 60 * 1000;
  // Find first point >= cutoff (data is sorted by time)
  let start = allData.length;
  for (let i = 0; i < allData.length; i++) {
    if (allData[i].time >= cutoff) {
      start = i;
      break;
    }
  }
  const result = allData.slice(start);
  // If there's a point before the window, carry it forward at the cutoff time
  // so the graph has a left edge value
  if (start > 0 && (result.length === 0 || result[0].time > cutoff)) {
    result.unshift({ time: cutoff, value: allData[start - 1].value });
  }
  // Also extend to "now" with the last known value so the graph reaches the right edge
  if (result.length > 0) {
    const last = result[result.length - 1];
    const now = Date.now();
    if (now - last.time > 60000) { // gap > 1 minute
      result.push({ time: now, value: last.value });
    }
  }
  return result;
}

@action({ UUID: "com.local.ha-graph.encoder-graph" })
export class EncoderGraphAction extends SingletonAction<HaGraphSettings> {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent<HaGraphSettings>): Promise<void> {
    const state: InstanceState = {
      client: null,
      allData: [],
      maxFetchedMinutes: 0,
      pendingFetch: null,
      zoomIndex: DEFAULT_ZOOM_INDEX,
      currentValue: "",
      entityName: "",
      reverseColors: false,
      freezeScale: false,
      unit: "",
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
    state.allData = [];
    state.maxFetchedMinutes = 0;
    await this.setup(ev.action.id, ev.action, await resolveSettings(ev.payload.settings));
  }

  override async onDialDown(ev: DialDownEvent<HaGraphSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    state.zoomIndex = DEFAULT_ZOOM_INDEX;
    await this.renderCurrent(ev.action, state);
    this.ensureData(ev.action, state);
  }

  override async onDialRotate(ev: DialRotateEvent<HaGraphSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    // Rotate right (ticks > 0) = zoom in (higher index = shorter window)
    const newIndex = state.zoomIndex + ev.payload.ticks;
    state.zoomIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, newIndex));
    // Render immediately from cache
    await this.renderCurrent(ev.action, state);
    // Fetch more data in background if needed
    this.ensureData(ev.action, state);
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
      await action.setFeedback({
        label: state.entityName,
        value: "Setup",
        graph: "",
        timeframe: "",
      });
      return;
    }

    const client = new HaClient({ url: haUrl, token: haToken, entityId });
    state.client = client;

    client.on("connected", async () => {
      // Fetch current zoom level, then progressively expand
      await this.fetchAndMerge(state, ZOOM_LEVELS[state.zoomIndex].minutes);
      await this.renderCurrent(action, state);
      // Pre-fetch 10 days in background for smooth scrolling
      this.fetchAndMerge(state, 10 * 24 * 60).then(() => {
        this.renderCurrent(action, state);
      });
    });

    client.on("stateChanged", async ({ value }: { value: number }) => {
      state.currentValue = String(value);
      // Append to allData
      const point: DataPoint = { time: Date.now(), value };
      state.allData.push(point);
      // Re-render if on a short timeframe
      if (ZOOM_LEVELS[state.zoomIndex].minutes <= 5) {
        await this.renderCurrent(action, state);
      }
    });

    client.on("disconnected", async () => {
      await action.setFeedback({
        label: state.entityName,
        value: "Offline",
        graph: "",
        timeframe: "",
      });
    });

    client.connect();

    // Periodic refresh: re-fetch current window every 60s
    state.refreshTimer = setInterval(async () => {
      await this.refreshData(state, Math.max(ZOOM_LEVELS[state.zoomIndex].minutes, 60));
      await this.renderCurrent(action, state);
    }, 60000);
  }

  /** Fetch history for the given window and merge into allData */
  private async fetchAndMerge(state: InstanceState, minutes: number): Promise<void> {
    if (!state.client) return;
    // Don't re-fetch if we already have this range
    if (minutes <= state.maxFetchedMinutes) return;

    const start = new Date(Date.now() - minutes * 60 * 1000);
    try {
      const points = await state.client.fetchHistory(state.client.entityId, start);
      // Merge: combine, deduplicate by time, sort
      const combined = new Map<number, number>();
      for (const p of state.allData) combined.set(p.time, p.value);
      for (const p of points) combined.set(p.time, p.value);
      state.allData = Array.from(combined.entries())
        .map(([time, value]) => ({ time, value }))
        .sort((a, b) => a.time - b.time);
      state.maxFetchedMinutes = minutes;
      if (points.length > 0) {
        state.currentValue = String(points[points.length - 1].value);
      }
    } catch (err: any) {
      // Keep existing data
    }
  }

  /** Refresh data unconditionally (for periodic updates) */
  private async refreshData(state: InstanceState, minutes: number): Promise<void> {
    if (!state.client) return;
    const start = new Date(Date.now() - minutes * 60 * 1000);
    try {
      const points = await state.client.fetchHistory(state.client.entityId, start);
      const combined = new Map<number, number>();
      for (const p of state.allData) combined.set(p.time, p.value);
      for (const p of points) combined.set(p.time, p.value);
      state.allData = Array.from(combined.entries())
        .map(([time, value]) => ({ time, value }))
        .sort((a, b) => a.time - b.time);
      if (points.length > 0) {
        state.currentValue = String(points[points.length - 1].value);
      }
    } catch {
      // Keep existing data
    }
  }

  /** Ensure we have data for the current zoom level, fetch in background if not */
  private ensureData(action: any, state: InstanceState): void {
    const needed = ZOOM_LEVELS[state.zoomIndex].minutes;
    if (needed <= state.maxFetchedMinutes) return;
    if (state.pendingFetch) return;

    state.pendingFetch = this.fetchAndMerge(state, needed).then(async () => {
      state.pendingFetch = null;
      await this.renderCurrent(action, state);
    });
  }

  /** Render using whatever data we currently have for the active zoom level */
  private async renderCurrent(action: any, state: InstanceState): Promise<void> {
    const level = ZOOM_LEVELS[state.zoomIndex];
    let points: DataPoint[];

    if (level.minutes <= 1 && state.client) {
      points = state.client.getRingBuffer();
    } else {
      points = sliceWindow(state.allData, level.minutes);
    }

    if (points.length > 0) {
      state.currentValue = String(points[points.length - 1].value);
    }

    // Compute color range from full cached data (10-day historical)
    let colorRange: ColorRange | undefined;
    if (state.allData.length >= 2) {
      let min = Infinity, max = -Infinity;
      for (const p of state.allData) {
        if (p.value < min) min = p.value;
        if (p.value > max) max = p.value;
      }
      if (min < max) colorRange = { min, max };
    }

    const windowMs = level.minutes * 60 * 1000;
    const graphSvg = renderEncoderGraph(points, windowMs, level.label, state.reverseColors, state.unit, colorRange, state.freezeScale);
    await action.setFeedback({
      label: state.entityName,
      value: state.currentValue + (state.unit ? ` ${state.unit}` : ""),
      graph: svgDataUri(graphSvg),
      timeframe: "",
    });
  }
}
