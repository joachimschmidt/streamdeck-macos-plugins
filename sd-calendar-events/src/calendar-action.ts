import {
  action,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  DialRotateEvent,
  DialDownEvent,
  TouchTapEvent,
  DidReceiveSettingsEvent,
  SendToPluginEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { exec } from "child_process";
import { SystemCalendarService, CalendarEvent, CalendarInfo } from "./google-calendar";

type CalendarSettings = {
  calendarIds?: string; // comma-separated calendar identifiers
  forceChrome?: boolean;
};

interface InstanceState {
  service: SystemCalendarService;
  events: CalendarEvent[];
  currentIndex: number;
  settings: CalendarSettings;
  pollTimer: ReturnType<typeof setInterval> | null;
  displayTimer: ReturnType<typeof setInterval> | null;
  lastError: string | null;
}

@action({ UUID: "com.local.calendar-events.events" })
export class CalendarAction extends SingletonAction<CalendarSettings> {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent<CalendarSettings>): Promise<void> {
    const state: InstanceState = {
      service: new SystemCalendarService(),
      events: [],
      currentIndex: 0,
      settings: ev.payload.settings,
      pollTimer: null,
      displayTimer: null,
      lastError: null,
    };
    this.instances.set(ev.action.id, state);

    await this.refreshEvents(ev.action.id, ev.action);
    this.startPolling(ev.action.id, ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent<CalendarSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state) {
      if (state.pollTimer) clearInterval(state.pollTimer);
      if (state.displayTimer) clearInterval(state.displayTimer);
    }
    this.instances.delete(ev.action.id);
  }

  override async onDialRotate(ev: DialRotateEvent<CalendarSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state || state.events.length === 0) return;

    const len = state.events.length;
    state.currentIndex = ((state.currentIndex + ev.payload.ticks) % len + len) % len;
    await this.updateDisplay(ev.action, state);
  }

  override async onDialDown(ev: DialDownEvent<CalendarSettings>): Promise<void> {
    this.openCurrentMeeting(ev.action.id);
  }

  override async onTouchTap(ev: TouchTapEvent<CalendarSettings>): Promise<void> {
    this.openCurrentMeeting(ev.action.id);
  }

  private openCurrentMeeting(actionId: string): void {
    const state = this.instances.get(actionId);
    if (!state) return;

    // No events: open Calendar app
    if (state.events.length === 0) {
      exec('open -a "Calendar"');
      return;
    }

    const event = state.events[state.currentIndex];
    if (event?.meetingUrl) {
      const useChrome = state.settings.forceChrome !== false;
      const cmd = useChrome
        ? `open -a "Google Chrome" "${event.meetingUrl}"`
        : `open "${event.meetingUrl}"`;
      exec(cmd);
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CalendarSettings>): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;

    state.settings = ev.payload.settings;
    await this.refreshEvents(ev.action.id, ev.action);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<Record<string, string>, CalendarSettings>): Promise<void> {
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

    // Poll events every 60s
    state.pollTimer = setInterval(() => {
      this.refreshEvents(actionId, actionObj);
    }, 60_000);

    // Update relative times every 30s
    state.displayTimer = setInterval(() => {
      this.updateDisplay(actionObj, state);
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

      // Preserve scroll position by matching event ID
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
        await this.showMessage(actionObj, "Allow access", "Check macOS prompt");
      } else if (msg.includes("ENOENT") || msg.includes("spawn")) {
        await this.showMessage(actionObj, "Helper missing", "Rebuild plugin");
      } else {
        await this.showMessage(actionObj, "Error", msg.slice(0, 24));
      }
    }
  }

  private async updateDisplay(actionObj: any, state: InstanceState): Promise<void> {
    if (state.events.length === 0) {
      const now = new Date();
      const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
      const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      await actionObj.setFeedback({
        time: dayName,
        nav: date,
        meetingIcon: "\u{1F4C5}",
        title: "All clear",
        timeUntil: "No more events today",
        status: "Tap to open Calendar",
      });
      return;
    }

    const event = state.events[state.currentIndex];
    if (!event) return;

    const now = new Date();
    const timeStr = event.isAllDay
      ? "All day"
      : event.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    const nav = `${state.currentIndex + 1}/${state.events.length}`;
    const icon = event.meetingUrl ? "\u{1F4F9}" : "\u{1F4C5}";
    const title = event.summary.length > 20 ? event.summary.slice(0, 19) + "\u2026" : event.summary;

    let timeUntil: string;
    if (event.isAllDay) {
      timeUntil = "All day event";
    } else {
      const diffMs = event.start.getTime() - now.getTime();
      if (diffMs < 0) {
        const endDiffMs = event.end.getTime() - now.getTime();
        if (endDiffMs > 0) {
          const minsLeft = Math.ceil(endDiffMs / 60_000);
          timeUntil = minsLeft > 60
            ? `Ends in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
            : `Ends in ${minsLeft} min`;
        } else {
          timeUntil = "Ended";
        }
      } else {
        const mins = Math.ceil(diffMs / 60_000);
        timeUntil = mins > 60
          ? `in ${Math.floor(mins / 60)}h ${mins % 60}m`
          : `in ${mins} min`;
      }
    }

    const status = event.meetingUrl ? "Press to join" : "";

    await actionObj.setFeedback({ time: timeStr, nav, meetingIcon: icon, title, timeUntil, status });
  }

  private async showMessage(actionObj: any, line1: string, line2: string): Promise<void> {
    await actionObj.setFeedback({
      time: "",
      nav: "",
      meetingIcon: "\u{26A0}",
      title: line1,
      timeUntil: line2,
      status: "",
    });
  }
}
