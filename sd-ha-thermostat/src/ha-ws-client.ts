import WebSocket from "ws";
import { EventEmitter } from "events";

export interface HaWsConfig {
  url: string;  // e.g. http://homeassistant.local:8123
  token: string;
}

export class HaWsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private reconnectDelay = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private pendingCallbacks = new Map<number, (result: any) => void>();
  private subscribeId = 0;

  constructor(private config: HaWsConfig) {
    super();
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

    this.ws.on("open", () => {});

    this.ws.on("message", (raw: WebSocket.Data) => {
      try {
        this.handleMessage(JSON.parse(raw.toString()));
      } catch {}
    });

    this.ws.on("error", (err: Error) => {
      console.error("HA WS error:", err.message);
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

  /** Fetch all entity states. Use to get initial state after connection. */
  fetchStates(): Promise<any[]> {
    return new Promise((resolve) => {
      const id = ++this.msgId;
      this.pendingCallbacks.set(id, (result) => resolve(result ?? []));
      this.send({ id, type: "get_states" });
    });
  }

  /** Call a Home Assistant service (e.g. climate.set_temperature) */
  callService(domain: string, service: string, serviceData: Record<string, unknown>): void {
    const id = ++this.msgId;
    this.send({ id, type: "call_service", domain, service, service_data: serviceData });
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "auth_required":
        this.send({ type: "auth", access_token: this.config.token });
        break;

      case "auth_ok":
        this.reconnectDelay = 1000;
        this.subscribeStateChanges();
        this.emit("connected");
        break;

      case "auth_invalid":
        console.error("HA auth invalid:", msg.message);
        this.ws?.close();
        break;

      case "result": {
        const cb = this.pendingCallbacks.get(msg.id);
        if (cb) {
          this.pendingCallbacks.delete(msg.id);
          cb(msg.result);
        }
        break;
      }

      case "event":
        if (msg.id === this.subscribeId) {
          this.emit("state_changed", msg.event?.data);
        }
        break;
    }
  }

  private subscribeStateChanges(): void {
    this.subscribeId = ++this.msgId;
    this.send({ id: this.subscribeId, type: "subscribe_events", event_type: "state_changed" });
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
      if (!this.destroyed) this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }
}
