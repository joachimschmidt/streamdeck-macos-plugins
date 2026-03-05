import WebSocket from "ws";
import { EventEmitter } from "events";

export interface DataPoint {
  time: number; // epoch ms
  value: number;
}

export interface HaClientConfig {
  url: string; // e.g. http://homeassistant.local:8123
  token: string;
  entityId: string;
}

export class HaClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private reconnectDelay = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private ringBuffer: DataPoint[] = [];
  private readonly ringMax = 120;
  private subscribeId = 0;

  constructor(private config: HaClientConfig) {
    super();
  }

  get entityId(): string {
    return this.config.entityId;
  }

  connect(): void {
    this.destroyed = false;
    const wsUrl = this.config.url.replace(/^http/, "ws") + "/api/websocket";

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      // WebSocket TCP connected; HA will send auth_required next
    });

    this.ws.on("message", (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch {
        // ignore malformed
      }
    });

    this.ws.on("error", (err: Error) => {
      // Log but don't re-emit — the "close" event will follow and handle reconnect
      console.error("HA WebSocket error:", err.message);
    });

    this.ws.on("close", () => {
      this.emit("disconnected");
      this.scheduleReconnect();
    });
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  getRingBuffer(): DataPoint[] {
    return [...this.ringBuffer];
  }

  async fetchHistory(entityId: string, startTime: Date): Promise<DataPoint[]> {
    const endTime = new Date();
    const url = `${this.config.url}/api/history/period/${startTime.toISOString()}?end_time=${endTime.toISOString()}&filter_entity_id=${entityId}&minimal_response&no_attributes`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    if (!resp.ok) return [];

    const data = await resp.json() as Array<Array<{ state: string; last_changed: string }>>;
    if (!data || !data[0]) return [];

    const points: DataPoint[] = [];
    for (const entry of data[0]) {
      const val = parseFloat(entry.state);
      if (isNaN(val)) continue;
      points.push({ time: new Date(entry.last_changed).getTime(), value: val });
    }
    return points;
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "auth_required":
        this.send({ type: "auth", access_token: this.config.token });
        break;

      case "auth_ok":
        this.reconnectDelay = 1000;
        this.emit("connected");
        this.subscribeStateChanges();
        break;

      case "auth_invalid":
        console.error("HA auth invalid:", msg.message);
        this.ws?.close();
        break;

      case "event":
        if (msg.id === this.subscribeId) {
          this.handleStateChanged(msg.event);
        }
        break;
    }
  }

  private subscribeStateChanges(): void {
    this.subscribeId = ++this.msgId;
    this.send({
      id: this.subscribeId,
      type: "subscribe_events",
      event_type: "state_changed",
    });
  }

  private handleStateChanged(event: any): void {
    const data = event?.data;
    if (!data || data.entity_id !== this.config.entityId) return;

    const newState = data.new_state;
    if (!newState) return;

    const val = parseFloat(newState.state);
    if (isNaN(val)) return;

    const point: DataPoint = {
      time: new Date(newState.last_changed).getTime(),
      value: val,
    };

    this.ringBuffer.push(point);
    if (this.ringBuffer.length > this.ringMax) {
      this.ringBuffer.shift();
    }

    this.emit("stateChanged", {
      state: newState.state,
      value: val,
      last_changed: newState.last_changed,
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        this.connect();
      }
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }
}
