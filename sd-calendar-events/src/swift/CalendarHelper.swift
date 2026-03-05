import EventKit
import Foundation

struct EventOutput: Codable {
    let id: String
    let title: String
    let startDate: Double
    let endDate: Double
    let isAllDay: Bool
    let meetingUrl: String?
    let calendarName: String
    let calendarColor: String
}

struct Output: Codable {
    let events: [EventOutput]
    let calendars: [CalendarInfo]
    let error: String?
}

struct CalendarInfo: Codable {
    let id: String
    let title: String
    let color: String
    let source: String
}

let store = EKEventStore()

func hexColor(_ cgColor: CGColor?) -> String {
    guard let c = cgColor, let rgb = c.converted(to: CGColorSpaceCreateDeviceRGB(), intent: .defaultIntent, options: nil),
          let comps = rgb.components, comps.count >= 3 else { return "#888888" }
    let r = Int(comps[0] * 255)
    let g = Int(comps[1] * 255)
    let b = Int(comps[2] * 255)
    return String(format: "#%02X%02X%02X", r, g, b)
}

func extractMeetingUrl(from event: EKEvent) -> String? {
    if let url = event.url?.absoluteString,
       url.contains("zoom.us") || url.contains("teams.microsoft.com") || url.contains("meet.google.com") || url.contains("webex.com") {
        return url
    }
    if let loc = event.location {
        if let match = loc.range(of: #"https?://[^\s<"')]*(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)[^\s<"')]*"#, options: .regularExpression) {
            return String(loc[match])
        }
    }
    if let notes = event.notes {
        if let match = notes.range(of: #"https?://[^\s<"')]*(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)[^\s<"')]*"#, options: .regularExpression) {
            return String(notes[match])
        }
    }
    if let url = event.url?.absoluteString {
        return url
    }
    return nil
}

/// Request access interactively — only works from Terminal where macOS can show the prompt.
func requestAccessInteractively() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false

    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { g, _ in
            granted = g
            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .event) { g, _ in
            granted = g
            semaphore.signal()
        }
    }

    // Timeout after 30s — prevents hanging when launched from a non-interactive context
    let result = semaphore.wait(timeout: .now() + 30)
    if result == .timedOut {
        return false
    }
    return granted
}

/// Check if we have calendar access without prompting.
func checkAccess() -> (authorized: Bool, needsPrompt: Bool) {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        switch status {
        case .fullAccess:
            return (true, false)
        case .notDetermined:
            return (false, true)
        default:
            return (false, false)
        }
    } else {
        switch status {
        case .authorized:
            return (true, false)
        case .notDetermined:
            return (false, true)
        default:
            return (false, false)
        }
    }
}

func run() {
    let command = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "events"

    // "authorize" command — meant to be run from Terminal to trigger the permission prompt
    if command == "authorize" {
        let (authorized, needsPrompt) = checkAccess()
        if authorized {
            print("{\"error\":null,\"events\":[],\"calendars\":[]}")
            fputs("✓ Calendar access already granted.\n", stderr)
            return
        }
        if needsPrompt {
            fputs("Requesting calendar access — look for the macOS permission prompt...\n", stderr)
            let granted = requestAccessInteractively()
            if granted {
                fputs("✓ Calendar access granted!\n", stderr)
                print("{\"error\":null,\"events\":[],\"calendars\":[]}")
            } else {
                fputs("✗ Calendar access denied or timed out.\n", stderr)
                fputs("  Go to: System Settings → Privacy & Security → Calendars\n", stderr)
                fputs("  Grant access to 'calendar-helper' or 'Elgato Stream Deck'\n", stderr)
                print("{\"error\":\"Calendar access denied. Grant in System Settings → Privacy & Security → Calendars.\",\"events\":[],\"calendars\":[]}")
            }
        } else {
            fputs("✗ Calendar access is denied.\n", stderr)
            fputs("  Go to: System Settings → Privacy & Security → Calendars\n", stderr)
            fputs("  Grant access to 'calendar-helper' or 'Elgato Stream Deck'\n", stderr)
            print("{\"error\":\"Calendar access denied. Grant in System Settings → Privacy & Security → Calendars.\",\"events\":[],\"calendars\":[]}")
        }
        return
    }

    // For non-interactive commands (events/calendars), check status without prompting
    let (authorized, needsPrompt) = checkAccess()
    if !authorized {
        if needsPrompt {
            // Try requesting — might work, might not, but with a timeout so we don't hang
            let granted = requestAccessInteractively()
            if !granted {
                printJSON(Output(events: [], calendars: [], error: "NOT_AUTHORIZED: Run from Terminal first: ./calendar-helper authorize"))
                return
            }
        } else {
            printJSON(Output(events: [], calendars: [], error: "ACCESS_DENIED: Grant access in System Settings → Privacy & Security → Calendars"))
            return
        }
    }

    let filterIds: Set<String>? = CommandLine.arguments.count > 2
        ? Set(CommandLine.arguments[2].split(separator: ",").map(String.init))
        : nil

    let allCalendars = store.calendars(for: .event)

    let calendarInfos = allCalendars.map { cal in
        CalendarInfo(id: cal.calendarIdentifier, title: cal.title, color: hexColor(cal.cgColor), source: cal.source.title)
    }

    if command == "calendars" {
        printJSON(Output(events: [], calendars: calendarInfos, error: nil))
        return
    }

    // Fetch today's events
    let now = Date()
    let calendar = Calendar.current
    let endOfDay = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: now)!

    let calendarsToSearch = filterIds != nil
        ? allCalendars.filter { filterIds!.contains($0.calendarIdentifier) }
        : allCalendars

    let predicate = store.predicateForEvents(withStart: now, end: endOfDay, calendars: calendarsToSearch)
    let ekEvents = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }

    let events = ekEvents.map { ev in
        EventOutput(
            id: ev.eventIdentifier ?? UUID().uuidString,
            title: ev.title ?? "(No title)",
            startDate: ev.startDate.timeIntervalSince1970 * 1000,
            endDate: ev.endDate.timeIntervalSince1970 * 1000,
            isAllDay: ev.isAllDay,
            meetingUrl: extractMeetingUrl(from: ev),
            calendarName: ev.calendar.title,
            calendarColor: hexColor(ev.calendar.cgColor)
        )
    }

    printJSON(Output(events: events, calendars: calendarInfos, error: nil))
}

func printJSON(_ output: Output) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(output), let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

run()
