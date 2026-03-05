#!/usr/bin/env osascript -l JavaScript

// JXA script to read events from macOS Calendar.app
// Uses Automation permission (SD -> Calendar.app)

function run(argv) {
  var command = argv[0] || "events";
  var filterNames = argv[1] ? argv[1].split("||") : null;

  var app = Application("Calendar");

  var names = app.calendars.name();
  var count = names.length;

  // Get colors one by one (bulk access returns nested arrays inconsistently)
  var calendarInfos = [];
  for (var i = 0; i < count; i++) {
    var hex = "#888888";
    try {
      var c = app.calendars[i].color();
      if (c && c.length >= 3) {
        hex = rgbToHex(c);
      }
    } catch (e) {}
    calendarInfos.push({
      id: names[i],
      title: names[i],
      color: hex,
      source: ""
    });
  }

  if (command === "calendars") {
    return JSON.stringify({ events: [], calendars: calendarInfos, error: null });
  }

  // events command
  var now = new Date();
  // Use day boundaries just outside today so _greaterThan/_lessThan capture the full day
  var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
  var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);

  var events = [];

  for (var i = 0; i < count; i++) {
    var calName = names[i];
    if (filterNames && filterNames.indexOf(calName) < 0) continue;

    var cal = app.calendars[i];
    var calEvts;
    try {
      calEvts = cal.events.whose({
        _and: [
          { startDate: { _greaterThan: yesterday } },
          { startDate: { _lessThan: tomorrow } }
        ]
      })();
    } catch (e) {
      // Fallback: some calendars don't support whose, skip them
      continue;
    }

    for (var j = 0; j < calEvts.length; j++) {
      try {
        var ev = calEvts[j];
        var startDate = ev.startDate();
        var endDate = ev.endDate();
        var isAllDay = ev.alldayEvent();

        // Show all today's events (past ones show as "Ended")

        var summary = ev.summary() || "(No title)";
        var desc = safeGet(ev, "description");
        var loc = safeGet(ev, "location");
        var url = safeGet(ev, "url");

        // Build a stable-ish ID from summary + start time
        var id = calName + "|" + summary + "|" + startDate.getTime();

        events.push({
          id: id,
          title: summary,
          startDate: startDate.getTime(),
          endDate: endDate.getTime(),
          isAllDay: isAllDay,
          meetingUrl: extractMeetingUrl(url, loc, desc),
          calendarName: calName,
          calendarColor: calendarInfos[i] ? calendarInfos[i].color : "#888888"
        });
      } catch (e) {
        continue;
      }
    }
  }

  events.sort(function (a, b) { return a.startDate - b.startDate; });
  return JSON.stringify({ events: events, calendars: calendarInfos, error: null });
}

function safeGet(ev, prop) {
  try {
    var val = ev[prop]();
    return (val === null || val === undefined) ? "" : String(val);
  } catch (e) {
    return "";
  }
}

function extractMeetingUrl(url, location, description) {
  var pattern = /https?:\/\/[^\s<"')]*(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)[^\s<"')"]*/i;
  if (url && pattern.test(url)) return url.match(pattern)[0];
  if (location) { var m = location.match(pattern); if (m) return m[0]; }
  if (description) { var m = description.match(pattern); if (m) return m[0]; }
  if (url && /^https?:\/\//.test(url)) return url;
  return null;
}

function rgbToHex(c) {
  if (!c || !Array.isArray(c) || c.length < 3) return "#888888";
  // Calendar.app returns 0.0-1.0 float RGB
  var rr = Math.round(c[0] * 255);
  var gg = Math.round(c[1] * 255);
  var bb = Math.round(c[2] * 255);
  return "#" + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1).toUpperCase();
}
