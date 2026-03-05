import { execFile } from "child_process";
import { join } from "path";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: Date;
  end: Date;
  meetingUrl: string | null;
  isAllDay: boolean;
  calendarName: string;
  calendarColor: string;
}

export interface CalendarInfo {
  id: string;
  title: string;
  color: string;
  source: string;
}

interface HelperOutput {
  events: Array<{
    id: string;
    title: string;
    startDate: number;
    endDate: number;
    isAllDay: boolean;
    meetingUrl: string | null;
    calendarName: string;
    calendarColor: string;
  }>;
  calendars: CalendarInfo[];
  error: string | null;
}

function getHelperPath(): string {
  // Swift binary inside the .app bundle, next to plugin.js in bin/
  return join(__dirname, "CalendarHelper.app", "Contents", "MacOS", "CalendarHelper");
}

function runHelper(args: string[]): Promise<HelperOutput> {
  const helperPath = getHelperPath();
  return new Promise((resolve, reject) => {
    execFile(helperPath, args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Helper error: ${err.message} | stderr: ${stderr} | stdout: ${stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Invalid helper output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

export class SystemCalendarService {
  async listCalendars(): Promise<CalendarInfo[]> {
    const result = await runHelper(["calendars"]);
    if (result.error) throw new Error(result.error);
    return result.calendars;
  }

  async fetchTodayEvents(calendarIds?: string[]): Promise<CalendarEvent[]> {
    const args = ["events"];
    if (calendarIds && calendarIds.length > 0) {
      args.push(calendarIds.join(","));
    }

    const result = await runHelper(args);
    if (result.error) throw new Error(result.error);

    return result.events.map((e) => ({
      id: e.id,
      summary: e.title,
      start: new Date(e.startDate),
      end: new Date(e.endDate),
      meetingUrl: e.meetingUrl,
      isAllDay: e.isAllDay,
      calendarName: e.calendarName,
      calendarColor: e.calendarColor,
    }));
  }
}
