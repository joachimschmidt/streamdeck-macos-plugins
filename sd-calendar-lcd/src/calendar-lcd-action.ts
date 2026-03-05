import {
  action,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  KeyDownEvent,
  KeyUpEvent,
  DidReceiveSettingsEvent,
  SendToPluginEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { exec } from "child_process";
import { SystemCalendarService, CalendarEvent, CalendarInfo } from "./google-calendar";

type CalendarLcdSettings = {
  calendarIds?: string;
  forceChrome?: boolean;
};

interface InstanceState {
  service: SystemCalendarService;
  events: CalendarEvent[];
  currentIndex: number;
  settings: CalendarLcdSettings;
  pollTimer: ReturnType<typeof setInterval> | null;
  displayTimer: ReturnType<typeof setInterval> | null;
  lastError: string | null;
  keyDownTime: number;
}

const W = 144;
const H = 144;

function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function timeUntilText(event: CalendarEvent, now: Date): string {
  if (event.isAllDay) return "All day event";

  const diffMs = event.start.getTime() - now.getTime();
  if (diffMs < 0) {
    const endDiffMs = event.end.getTime() - now.getTime();
    if (endDiffMs > 0) {
      const minsLeft = Math.ceil(endDiffMs / 60_000);
      return minsLeft > 60
        ? `Ends in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
        : `Ends in ${minsLeft} min`;
    }
    return "Ended";
  }
  const mins = Math.ceil(diffMs / 60_000);
  return mins > 60
    ? `in ${Math.floor(mins / 60)}h ${mins % 60}m`
    : `in ${mins} min`;
}

function renderEventSvg(event: CalendarEvent, index: number, total: number): string {
  const now = new Date();
  const timeStr = event.isAllDay
    ? "All day"
    : event.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const title = truncate(event.summary, 16);
  const subtitle = timeUntilText(event, now);
  const nav = `${index + 1}/${total}`;
  const hasMeeting = !!event.meetingUrl;
  const icon = hasMeeting ? "\u{1F4F9}" : "\u{1F4C5}";

  // Status colors
  const diffMs = event.start.getTime() - now.getTime();
  const isNow = diffMs < 0 && event.end.getTime() > now.getTime();
  const isSoon = diffMs > 0 && diffMs < 15 * 60_000;
  const accentColor = isNow ? "#66BB6A" : isSoon ? "#FFA726" : "#AACCFF";
  const calColor = event.calendarColor || "#888";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>

  <!-- Calendar color bar -->
  <rect x="0" y="0" width="6" height="${H}" rx="3" fill="${escSvg(calColor)}"/>

  <!-- Time -->
  <text x="16" y="28" font-family="-apple-system,Helvetica" font-size="18" font-weight="700" fill="${accentColor}">${escSvg(timeStr)}</text>

  <!-- Nav indicator -->
  <text x="132" y="22" font-family="-apple-system,Helvetica" font-size="11" fill="#666" text-anchor="end">${nav}</text>

  <!-- Title -->
  <text x="16" y="56" font-family="-apple-system,Helvetica" font-size="16" font-weight="600" fill="#EEEEEE">${escSvg(title)}</text>

  <!-- Calendar name -->
  <text x="16" y="76" font-family="-apple-system,Helvetica" font-size="11" fill="#777">${escSvg(truncate(event.calendarName, 20))}</text>

  <!-- Time until -->
  <text x="16" y="100" font-family="-apple-system,Helvetica" font-size="13" fill="${isNow ? "#66BB6A" : "#AAAAAA"}">${escSvg(subtitle)}</text>

  <!-- Meeting hint -->
  ${hasMeeting ? `<text x="72" y="128" font-family="-apple-system,Helvetica" font-size="11" fill="#66BB6A" text-anchor="middle">Hold to join meeting</text>` : ""}
</svg>`;
}

function renderEmptySvg(): string {
  const now = new Date();
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>
  <text x="72" y="42" font-family="-apple-system,Helvetica" font-size="28" text-anchor="middle" fill="#555">\u{1F4C5}</text>
  <text x="72" y="68" font-family="-apple-system,Helvetica" font-size="14" font-weight="600" fill="#AAAAAA" text-anchor="middle">All clear</text>
  <text x="72" y="88" font-family="-apple-system,Helvetica" font-size="12" fill="#666" text-anchor="middle">${escSvg(dayName)}</text>
  <text x="72" y="106" font-family="-apple-system,Helvetica" font-size="12" fill="#666" text-anchor="middle">${escSvg(date)}</text>
  <text x="72" y="130" font-family="-apple-system,Helvetica" font-size="10" fill="#555" text-anchor="middle">Tap to open Calendar</text>
</svg>`;
}

function renderErrorSvg(line1: string, line2: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>
  <text x="72" y="48" font-family="-apple-system,Helvetica" font-size="28" text-anchor="middle" fill="#EF5350">\u{26A0}</text>
  <text x="72" y="78" font-family="-apple-system,Helvetica" font-size="13" font-weight="600" fill="#EF5350" text-anchor="middle">${escSvg(line1)}</text>
  <text x="72" y="98" font-family="-apple-system,Helvetica" font-size="11" fill="#999" text-anchor="middle">${escSvg(line2)}</text>
</svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const LONG_PRESS_MS = 500;

@action({ UUID: "com.local.calendar-lcd.events" })
export class CalendarLcdAction extends SingletonAction<CalendarLcdSettings> {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent<CalendarLcdSettings>): Promise<void> {
    const state: InstanceState = {
      service: new SystemCalendarService(),
      events: [],
      currentIndex: 0,
      settings: ev.payload.settings,
      pollTimer: null,
      displayTimer: null,
      lastError: null,
      keyDownTime: 0,
    };
    this.instances.set(ev.action.id, state);

    await this.refreshEvents(ev.action.id, ev.action);
    this.startPolling(ev.action.id, ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent<CalendarLcdSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state) {
      if (state.pollTimer) clearInterval(state.pollTimer);
      if (state.displayTimer) clearInterval(state.displayTimer);
    }
    this.instances.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<CalendarLcdSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    state.keyDownTime = Date.now();
  }

  override async onKeyUp(ev: KeyUpEvent<CalendarLcdSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;

    // No events: open Calendar app
    if (state.events.length === 0) {
      exec('open -a "Calendar"');
      return;
    }

    const held = Date.now() - state.keyDownTime;

    if (held >= LONG_PRESS_MS) {
      // Long press: open meeting
      const event = state.events[state.currentIndex];
      if (event?.meetingUrl) {
        const useChrome = state.settings.forceChrome !== false;
        const cmd = useChrome
          ? `open -a "Google Chrome" "${event.meetingUrl}"`
          : `open "${event.meetingUrl}"`;
        exec(cmd);
      }
    } else {
      // Short press: cycle to next event
      state.currentIndex = (state.currentIndex + 1) % state.events.length;
      await this.updateDisplay(ev.action, state);
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CalendarLcdSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;

    state.settings = ev.payload.settings;
    await this.refreshEvents(ev.action.id, ev.action);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<Record<string, string>, CalendarLcdSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;

    if (ev.payload.action === "listCalendars") {
      try {
        const calendars = await state.service.listCalendars();
        await this.sendToPI({ action: "calendarList", calendars });
      } catch (err: any) {
        await this.sendToPI({
          action: "calendarList",
          calendars: [],
          error: err.message,
        });
      }
    }

    if (ev.payload.action === "refresh") {
      await this.refreshEvents(ev.action.id, ev.action);
    }
  }

  private async sendToPI(payload: Record<string, unknown>): Promise<void> {
    try {
      await streamDeck.ui.current?.sendToPropertyInspector(payload);
    } catch {
      // PI may not be open
    }
  }

  private startPolling(actionId: string, actionObj: any): void {
    const state = this.instances.get(actionId);
    if (!state) return;

    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.displayTimer) clearInterval(state.displayTimer);

    state.pollTimer = setInterval(() => {
      this.refreshEvents(actionId, actionObj);
    }, 60_000);

    state.displayTimer = setInterval(() => {
      const s = this.instances.get(actionId);
      if (s) this.updateDisplay(actionObj, s);
    }, 30_000);
  }

  private async refreshEvents(actionId: string, actionObj: any): Promise<void> {
    const state = this.instances.get(actionId);
    if (!state) return;

    const previousEventId = state.events[state.currentIndex]?.id;

    const filterIds = state.settings.calendarIds
      ? state.settings.calendarIds.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    try {
      state.events = await state.service.fetchTodayEvents(filterIds);
      state.lastError = null;

      if (previousEventId) {
        const newIndex = state.events.findIndex((e) => e.id === previousEventId);
        state.currentIndex = newIndex >= 0 ? newIndex : 0;
      } else {
        state.currentIndex = 0;
      }

      await this.updateDisplay(actionObj, state);
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      state.lastError = msg;
      streamDeck.logger.error("refreshEvents failed:", msg);
      if (msg.includes("Not authorized") || msg.includes("-1743")) {
        await actionObj.setImage(svgDataUri(renderErrorSvg("Allow access", "Check macOS prompt")));
      } else if (msg.includes("ENOENT") || msg.includes("spawn")) {
        await actionObj.setImage(svgDataUri(renderErrorSvg("Helper missing", "Rebuild plugin")));
      } else {
        await actionObj.setImage(svgDataUri(renderErrorSvg("Error", msg.slice(0, 24))));
      }
    }
  }

  private async updateDisplay(actionObj: any, state: InstanceState): Promise<void> {
    if (state.events.length === 0) {
      await actionObj.setImage(svgDataUri(renderEmptySvg()));
      await actionObj.setTitle("");
      return;
    }

    const event = state.events[state.currentIndex];
    if (!event) return;

    await actionObj.setImage(svgDataUri(renderEventSvg(event, state.currentIndex, state.events.length)));
    await actionObj.setTitle("");
  }
}
