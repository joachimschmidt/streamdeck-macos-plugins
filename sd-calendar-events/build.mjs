import { build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const PLUGIN_DIR = "com.local.calendar-events.sdPlugin";
const HELPER_APP = `${PLUGIN_DIR}/bin/CalendarHelper.app`;

// Create output directories
mkdirSync(`${PLUGIN_DIR}/bin`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/ui`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/imgs`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/layouts`, { recursive: true });

// Build Swift helper as .app bundle (so it gets its own TCC identity for calendar access)
console.log("Compiling CalendarHelper.app...");
mkdirSync(`${HELPER_APP}/Contents/MacOS`, { recursive: true });

writeFileSync(`${HELPER_APP}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.local.calendar-helper</string>
  <key>CFBundleName</key>
  <string>CalendarHelper</string>
  <key>CFBundleExecutable</key>
  <string>CalendarHelper</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>NSCalendarsFullAccessUsageDescription</key>
  <string>Stream Deck Calendar Events plugin needs access to show upcoming events on the dial.</string>
  <key>NSCalendarsUsageDescription</key>
  <string>Stream Deck Calendar Events plugin needs access to show upcoming events on the dial.</string>
</dict>
</plist>`);

// Compile as universal binary (ARM64 + x86_64) for cross-architecture compatibility
execSync(
  `swiftc -O -framework EventKit -framework Foundation -target arm64-apple-macosx10.15 src/swift/CalendarHelper.swift -o "${HELPER_APP}/Contents/MacOS/CalendarHelper-arm64"`,
  { stdio: "inherit" }
);
execSync(
  `swiftc -O -framework EventKit -framework Foundation -target x86_64-apple-macosx10.15 src/swift/CalendarHelper.swift -o "${HELPER_APP}/Contents/MacOS/CalendarHelper-x86"`,
  { stdio: "inherit" }
);
execSync(
  `lipo -create "${HELPER_APP}/Contents/MacOS/CalendarHelper-arm64" "${HELPER_APP}/Contents/MacOS/CalendarHelper-x86" -output "${HELPER_APP}/Contents/MacOS/CalendarHelper"`,
  { stdio: "inherit" }
);
execSync(`rm "${HELPER_APP}/Contents/MacOS/CalendarHelper-arm64" "${HELPER_APP}/Contents/MacOS/CalendarHelper-x86"`);

// Bundle plugin
await build({
  entryPoints: ["src/plugin.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: `${PLUGIN_DIR}/bin/plugin.js`,
});

// Copy manifest, UI, and layouts
cpSync("manifest.json", `${PLUGIN_DIR}/manifest.json`);
cpSync("ui/settings.html", `${PLUGIN_DIR}/ui/settings.html`);
cpSync("layouts/calendar.json", `${PLUGIN_DIR}/layouts/calendar.json`);

// Create minimal placeholder icon (20x20 gray PNG)
const placeholderPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAFElEQVQ4y2NgGAWjYBSMglEwCogHAATYAAGEIJLfAAAAAElFTkSuQmCC",
  "base64"
);
writeFileSync(`${PLUGIN_DIR}/imgs/action.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/action@2x.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/plugin.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/plugin@2x.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/category.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/category@2x.png`, placeholderPng);

console.log("Build complete → " + PLUGIN_DIR);
