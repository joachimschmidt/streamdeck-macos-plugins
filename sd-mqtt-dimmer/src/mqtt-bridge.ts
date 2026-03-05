import { connect, type MqttClient } from "mqtt";
import { EventEmitter } from "events";

export interface MqttBridgeConfig {
  brokerUrl: string;
  username?: string;
  password?: string;
  lightNames: string[];
  throttleMs: number;
  syncIntervalMs?: number;
}

export class MqttBridge extends EventEmitter {
  private client: MqttClient | null = null;
  private throttleTimer: NodeJS.Timeout | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private pendingValue: number | null = null;
  private ignoreUpdatesUntil = 0;

  constructor(private config: MqttBridgeConfig) {
    super();
  }

  /** Primary light (first in the list) — used for state feedback */
  private get primary(): string {
    return this.config.lightNames[0];
  }

  connect(): void {
    const opts: Record<string, unknown> = {
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    };
    if (this.config.username) {
      opts.username = this.config.username;
      opts.password = this.config.password;
    }

    this.client = connect(this.config.brokerUrl, opts);

    this.client.on("connect", () => {
      this.emit("connected");
      // Subscribe to primary light's state for feedback
      this.client!.subscribe(`zigbee2mqtt/${this.primary}`);

      // Request current state immediately
      this.requestState();

      // Periodic sync
      const interval = this.config.syncIntervalMs ?? 30000;
      this.syncInterval = setInterval(() => this.requestState(), interval);
    });

    this.client.on("message", (_topic: string, payload: Buffer) => {
      if (Date.now() < this.ignoreUpdatesUntil) return;

      try {
        const data = JSON.parse(payload.toString());
        this.emit("stateChanged", {
          brightness: data.brightness ?? 0,
          isOn: data.state === "ON",
        });
      } catch {
        // Ignore malformed messages
      }
    });

    this.client.on("error", (err: Error) => {
      this.emit("error", err);
    });

    this.client.on("close", () => {
      this.emit("disconnected");
    });
  }

  disconnect(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.client?.end(true);
    this.client = null;
  }

  /** Ask Zigbee2MQTT to publish current state (primary light) */
  requestState(): void {
    if (!this.client?.connected) return;
    this.client.publish(
      `zigbee2mqtt/${this.primary}/get`,
      JSON.stringify({ state: "", brightness: "" })
    );
  }

  /**
   * Throttled brightness publish to ALL lights.
   */
  publishBrightness(value: number): void {
    this.pendingValue = value;

    if (!this.throttleTimer) {
      this.doPublishAll({ brightness: value });
      this.pendingValue = null;

      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        if (this.pendingValue !== null) {
          this.publishBrightness(this.pendingValue);
        }
      }, this.config.throttleMs);
    }
  }

  publishToggle(on: boolean): void {
    this.doPublishAll({ state: on ? "ON" : "OFF" });
  }

  /** Publish a payload to all configured lights */
  private doPublishAll(payload: Record<string, unknown>): void {
    if (!this.client?.connected) return;
    this.ignoreUpdatesUntil = Date.now() + 500;
    const msg = JSON.stringify(payload);
    for (const name of this.config.lightNames) {
      this.client.publish(`zigbee2mqtt/${name}/set`, msg);
    }
  }
}
