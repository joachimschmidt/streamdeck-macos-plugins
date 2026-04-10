import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type DialRotateEvent,
  type DialDownEvent,
  type DidReceiveSettingsEvent,
  type TouchTapEvent,
} from "@elgato/streamdeck";
import { HaWsClient } from "./ha-ws-client";
import { resolveSettings, type HaThermostatSettings } from "./settings";

interface ClimateState {
  hvacMode: string;
  hvacAction: string;
  targetTemp: number;
  currentTemp: number;
  minTemp: number;
  maxTemp: number;
  stepSize: number;
}

interface InstanceState {
  client: HaWsClient | null;
  entityId: string;
  displayName: string;
  climate: ClimateState;
  lastInteractionAt: number;
}

// How long to ignore HA state feedback after user interaction
const INTERACTION_COOLDOWN = 2000;

// --- SVG Icons ---

function thermostatIcon(mode: string, hvacAction: string): string {
  let color = "#666";
  let flame = "";

  if (mode === "off") {
    color = "#666";
  } else if (hvacAction === "heating" || mode === "heat") {
    color = "#FF6B35";
    flame = `<path d="M24 8c0 0-8 10-8 18a8 8 0 0016 0c0-8-8-18-8-18z" fill="#FF6B35" opacity="0.3"/>
    <path d="M24 16c0 0-4 6-4 10a4 4 0 008 0c0-4-4-10-4-10z" fill="#FF6B35" opacity="0.6"/>`;
  } else if (hvacAction === "cooling" || mode === "cool") {
    color = "#4FC3F7";
    flame = `<circle cx="24" cy="24" r="8" fill="none" stroke="#4FC3F7" stroke-width="1.5" opacity="0.4"/>
    <circle cx="24" cy="24" r="4" fill="#4FC3F7" opacity="0.5"/>`;
  } else {
    // idle / auto / other
    color = "#4CAF50";
  }

  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  ${flame}
  <circle cx="24" cy="24" r="10" fill="none" stroke="${color}" stroke-width="2.5"/>
  <circle cx="24" cy="24" r="3" fill="${color}"/>
  <line x1="24" y1="14" x2="24" y2="10" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
  <line x1="24" y1="38" x2="24" y2="34" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
  <line x1="14" y1="24" x2="10" y2="24" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
  <line x1="38" y1="24" x2="34" y2="24" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
</svg>`);
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function parseClimateState(entity: any): ClimateState {
  const attrs = entity.attributes ?? {};
  return {
    hvacMode: entity.state ?? "off",
    hvacAction: attrs.hvac_action ?? "idle",
    targetTemp: attrs.temperature ?? 20,
    currentTemp: attrs.current_temperature ?? 0,
    minTemp: attrs.min_temp ?? 5,
    maxTemp: attrs.max_temp ?? 35,
    stepSize: attrs.target_temp_step ?? 0.5,
  };
}

@action({ UUID: "com.local.ha-thermostat.thermostat" })
export class ThermostatAction extends SingletonAction<HaThermostatSettings> {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent<HaThermostatSettings>): Promise<void> {
    const state: InstanceState = {
      client: null,
      entityId: "",
      displayName: "",
      climate: {
        hvacMode: "off",
        hvacAction: "idle",
        targetTemp: 20,
        currentTemp: 0,
        minTemp: 5,
        maxTemp: 35,
        stepSize: 0.5,
      },
      lastInteractionAt: 0,
    };
    this.instances.set(ev.action.id, state);
    await this.setup(ev.action.id, ev.action, await resolveSettings(ev.payload.settings));
  }

  override async onWillDisappear(ev: WillDisappearEvent<HaThermostatSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    state?.client?.disconnect();
    this.instances.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<HaThermostatSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    state.client?.disconnect();
    await this.setup(ev.action.id, ev.action, await resolveSettings(ev.payload.settings));
  }

  override async onDialRotate(ev: DialRotateEvent<HaThermostatSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state?.client) return;

    const step = state.climate.stepSize;
    const newTarget = Math.max(
      state.climate.minTemp,
      Math.min(state.climate.maxTemp, state.climate.targetTemp + ev.payload.ticks * step)
    );
    // Round to step precision to avoid floating point drift
    state.climate.targetTemp = Math.round(newTarget / step) * step;
    state.lastInteractionAt = Date.now();

    await this.updateDisplay(ev.action, state);
    state.client.callService("climate", "set_temperature", {
      entity_id: state.entityId,
      temperature: state.climate.targetTemp,
    });
  }

  override async onDialDown(ev: DialDownEvent<HaThermostatSettings>): Promise<void> {
    await this.toggleMode(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent<HaThermostatSettings>): Promise<void> {
    await this.toggleMode(ev.action);
  }

  private async toggleMode(action: any): Promise<void> {
    const state = this.instances.get(action.id);
    if (!state?.client) return;

    state.lastInteractionAt = Date.now();
    const newMode = state.climate.hvacMode === "off" ? "heat" : "off";
    state.climate.hvacMode = newMode;
    if (newMode === "off") state.climate.hvacAction = "off";

    await this.updateDisplay(action, state);
    state.client.callService("climate", "set_hvac_mode", {
      entity_id: state.entityId,
      hvac_mode: newMode,
    });
  }

  private async setup(id: string, action: any, settings: HaThermostatSettings): Promise<void> {
    const state = this.instances.get(id);
    if (!state) return;

    const { haUrl, haToken, entityId, displayName, stepSize } = settings;
    state.entityId = entityId || "";
    state.displayName = displayName || entityId || "Thermostat";
    if (stepSize) {
      const parsed = parseFloat(stepSize);
      if (!isNaN(parsed) && parsed > 0) state.climate.stepSize = parsed;
    }

    if (!haUrl || !haToken || !entityId) {
      await action.setFeedback({
        icon: thermostatIcon("off", "idle"),
        label: "Setup needed",
        value: "Config",
        status: "",
      });
      return;
    }

    await action.setFeedback({
      icon: thermostatIcon("off", "idle"),
      label: state.displayName,
      value: "Connecting...",
      status: "",
    });

    const client = new HaWsClient({ url: haUrl, token: haToken });
    state.client = client;

    client.on("connected", async () => {
      // Fetch initial state
      try {
        const states = await client.fetchStates();
        const entity = states.find((s: any) => s.entity_id === entityId);
        if (entity) {
          const stepBefore = state.climate.stepSize;
          state.climate = parseClimateState(entity);
          // Preserve user-configured step if set
          if (stepSize) {
            const parsed = parseFloat(stepSize);
            if (!isNaN(parsed) && parsed > 0) state.climate.stepSize = parsed;
          }
        }
      } catch {}
      await this.updateDisplay(action, state);
    });

    client.on("state_changed", async (data: any) => {
      if (!data || data.entity_id !== entityId) return;
      if (Date.now() - state.lastInteractionAt < INTERACTION_COOLDOWN) return;

      const newState = data.new_state;
      if (!newState) return;

      const stepBefore = state.climate.stepSize;
      state.climate = parseClimateState(newState);
      if (stepSize) {
        const parsed = parseFloat(stepSize);
        if (!isNaN(parsed) && parsed > 0) state.climate.stepSize = parsed;
      }
      await this.updateDisplay(action, state);
    });

    client.on("disconnected", async () => {
      await action.setFeedback({
        icon: thermostatIcon("off", "idle"),
        label: state.displayName,
        value: "Offline",
        status: "",
      });
    });

    client.connect();
  }

  private async updateDisplay(action: any, state: InstanceState): Promise<void> {
    const { climate, displayName } = state;
    const icon = thermostatIcon(climate.hvacMode, climate.hvacAction);

    const currentStr = `${climate.currentTemp.toFixed(1)}°`;

    let statusStr: string;
    if (climate.hvacMode === "off") {
      statusStr = `Off`;
    } else {
      const actionLabel = climate.hvacAction.charAt(0).toUpperCase() + climate.hvacAction.slice(1);
      statusStr = `${actionLabel} → ${climate.targetTemp.toFixed(1)}°`;
    }

    // Color the current value based on mode
    let valueColor = "#FFFFFF";
    if (climate.hvacMode === "off") valueColor = "#888888";
    else if (climate.hvacAction === "heating") valueColor = "#FF6B35";
    else if (climate.hvacAction === "cooling") valueColor = "#4FC3F7";

    await action.setFeedback({
      icon,
      label: displayName,
      value: { value: currentStr, color: valueColor },
      status: statusStr,
    });
  }
}
