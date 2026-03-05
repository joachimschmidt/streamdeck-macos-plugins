// Generate preview SVG images for README documentation
import { writeFileSync } from "fs";

const DIR = "docs/images";

// --- sd-cpu-monitor preview ---
const cpuSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
  <circle cx="20" cy="18" r="5" fill="#4CAF50"/>
  <text x="30" y="22" font-family="-apple-system,Helvetica" font-size="12" font-weight="600" fill="#aaa">CPU</text>
  <text x="132" y="22" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="#4CAF50" text-anchor="end">32%</text>
  <defs><clipPath id="cb"><rect x="12" y="30" width="120" height="14" rx="4"/></clipPath></defs>
  <rect x="12" y="30" width="120" height="14" rx="4" fill="#333"/>
  <rect x="12" y="30" width="29" height="14" fill="#4FC3F7" clip-path="url(#cb)"/>
  <rect x="41" y="30" width="10" height="14" fill="#FF8A65" clip-path="url(#cb)"/>
  <circle cx="18" cy="56" r="4" fill="#4FC3F7"/>
  <text x="26" y="59" font-family="-apple-system,Helvetica" font-size="10" fill="#999">User 24%</text>
  <circle cx="80" cy="56" r="4" fill="#FF8A65"/>
  <text x="88" y="59" font-family="-apple-system,Helvetica" font-size="10" fill="#999">Sys 8%</text>
  <circle cx="20" cy="80" r="5" fill="#4CAF50"/>
  <text x="30" y="84" font-family="-apple-system,Helvetica" font-size="12" font-weight="600" fill="#aaa">GPU</text>
  <text x="132" y="84" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="#4CAF50" text-anchor="end">15%</text>
  <defs><clipPath id="gb"><rect x="12" y="92" width="120" height="14" rx="4"/></clipPath></defs>
  <rect x="12" y="92" width="120" height="14" rx="4" fill="#333"/>
  <rect x="12" y="92" width="18" height="14" fill="#4CAF50" clip-path="url(#gb)"/>
  <text x="16" y="122" font-family="-apple-system,Helvetica" font-size="10" fill="#666">Render 12%</text>
  <text x="84" y="122" font-family="-apple-system,Helvetica" font-size="10" fill="#666">Tiler 8%</text>
</svg>`;

// --- sd-memory-monitor preview ---
const memSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
  <circle cx="20" cy="18" r="5" fill="#FFA726"/>
  <text x="30" y="22" font-family="-apple-system,Helvetica" font-size="12" font-weight="600" fill="#aaa">RAM</text>
  <text x="132" y="22" font-family="-apple-system,Helvetica" font-size="11" fill="#ccc" text-anchor="end">25.4G / 36G</text>
  <defs><clipPath id="rb"><rect x="12" y="30" width="120" height="14" rx="4"/></clipPath></defs>
  <rect x="12" y="30" width="120" height="14" rx="4" fill="#333"/>
  <rect x="12" y="30" width="85" height="14" fill="#FFA726" clip-path="url(#rb)"/>
  <text x="12" y="64" font-family="-apple-system,Helvetica" font-size="11" font-weight="600" fill="#aaa">SWAP</text>
  <text x="132" y="64" font-family="-apple-system,Helvetica" font-size="11" fill="#ccc" text-anchor="end">512M / 4.0G</text>
  <defs><clipPath id="sb"><rect x="12" y="72" width="120" height="14" rx="4"/></clipPath></defs>
  <rect x="12" y="72" width="120" height="14" rx="4" fill="#333"/>
  <rect x="12" y="72" width="15" height="14" fill="#4CAF50" clip-path="url(#sb)"/>
  <text x="72" y="108" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="#FFA726" text-anchor="middle">10.6G free</text>
  <text x="72" y="126" font-family="-apple-system,Helvetica" font-size="10" fill="#666" text-anchor="middle">Pressure · 35%</text>
</svg>`;

// --- sd-bt-connect preview (headphones, connected) ---
const btSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
  <circle cx="72" cy="72" r="56" fill="#4FC3F7" opacity=".08"/>
  <path d="M36 72c0-19.9 16.1-36 36-36s36 16.1 36 36" fill="none" stroke="#4FC3F7" stroke-width="7" stroke-linecap="round"/>
  <rect x="28" y="68" width="16" height="28" rx="8" fill="#4FC3F7"/>
  <rect x="100" y="68" width="16" height="28" rx="8" fill="#4FC3F7"/>
  <circle cx="112" cy="112" r="14" fill="#1a1a2e"/><circle cx="112" cy="112" r="10" fill="#4CAF50"/>
  <rect x="96" y="16" width="32" height="16" rx="3" fill="#1a1a2e" stroke="#4CAF50" stroke-width="2"/>
  <rect x="128" y="21" width="4" height="6" rx="1" fill="#4CAF50"/>
  <rect x="99" y="19" width="20" height="10" rx="2" fill="#4CAF50"/>
</svg>`;

// --- sd-claude-approve preview (pending state) ---
const claudePendingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
  <rect x="4" y="4" width="136" height="136" rx="24" fill="none" stroke="#FFA726" stroke-width="3" opacity=".7"/>
  <text x="72" y="28" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="#FFA726" text-anchor="middle">Bash</text>
  <text x="72" y="50" font-family="Menlo,monospace" font-size="10" fill="#ccc" text-anchor="middle">npm run build</text>
  <text x="72" y="66" font-family="Menlo,monospace" font-size="9" fill="#888" text-anchor="middle">Build the project</text>
  <rect x="22" y="80" width="100" height="30" rx="8" fill="#4CAF50"/>
  <text x="72" y="100" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">APPROVE</text>
  <text x="72" y="130" font-family="-apple-system,Helvetica" font-size="10" fill="#666" text-anchor="middle">24s remaining</text>
</svg>`;

// --- sd-claude-approve idle state ---
const claudeIdleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
  <text x="72" y="60" font-family="-apple-system,Helvetica" font-size="14" font-weight="600" fill="#555" text-anchor="middle">Claude</text>
  <text x="72" y="82" font-family="-apple-system,Helvetica" font-size="11" fill="#444" text-anchor="middle">Waiting...</text>
  <circle cx="72" cy="108" r="8" fill="#333" stroke="#444" stroke-width="1"/>
</svg>`;

// --- sd-mqtt-dimmer preview (simulated encoder display) ---
const dimmerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect width="200" height="100" rx="12" fill="#1a1a2e"/>
  <!-- Bulb icon area -->
  <circle cx="30" cy="35" r="16" fill="#FFC107" opacity=".15"/>
  <path d="M30 20c-5 0-9 4-9 9 0 3 1.5 5.8 3.8 7.4.7.5 1 1.2 1 2v2a1.4 1.4 0 001.4 1.4h5.6a1.4 1.4 0 001.4-1.4v-2c0-.8.4-1.5 1-2C37.5 34.8 39 32 39 29c0-5-4-9-9-9z" fill="#FFC107"/>
  <rect x="26" y="43" width="8" height="1.5" rx=".75" fill="#FFA000"/>
  <!-- Label + value -->
  <text x="60" y="30" font-family="-apple-system,Helvetica" font-size="13" font-weight="600" fill="#ccc">Living Room</text>
  <text x="60" y="50" font-family="-apple-system,Helvetica" font-size="16" font-weight="700" fill="#FFC107">70%</text>
  <!-- Progress bar -->
  <rect x="16" y="72" width="168" height="10" rx="5" fill="#333"/>
  <defs><clipPath id="db"><rect x="16" y="72" width="168" height="10" rx="5"/></clipPath></defs>
  <rect x="16" y="72" width="118" height="10" fill="#FFC107" clip-path="url(#db)"/>
</svg>`;

// --- sd-calendar-events preview (simulated encoder display) ---
const calendarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect width="200" height="100" rx="12" fill="#1a1a2e"/>
  <!-- Calendar icon -->
  <text x="30" y="40" font-size="24" text-anchor="middle">&#x1F4F9;</text>
  <!-- Event info -->
  <text x="60" y="22" font-family="-apple-system,Helvetica" font-size="11" fill="#888">10:30 AM</text>
  <text x="175" y="22" font-family="-apple-system,Helvetica" font-size="10" fill="#555" text-anchor="end">2/5</text>
  <text x="60" y="42" font-family="-apple-system,Helvetica" font-size="14" font-weight="600" fill="#ccc">Team Standup</text>
  <text x="60" y="62" font-family="-apple-system,Helvetica" font-size="11" fill="#FFA726">in 12 min</text>
  <text x="60" y="82" font-family="-apple-system,Helvetica" font-size="10" fill="#4FC3F7">Press to join</text>
</svg>`;

// Write all SVGs
const previews = {
  "cpu-monitor": cpuSvg,
  "memory-monitor": memSvg,
  "bt-connect": btSvg,
  "claude-approve-pending": claudePendingSvg,
  "claude-approve-idle": claudeIdleSvg,
  "mqtt-dimmer": dimmerSvg,
  "calendar-events": calendarSvg,
};

for (const [name, svg] of Object.entries(previews)) {
  writeFileSync(`${DIR}/preview-${name}.svg`, svg);
  console.log(`  wrote ${DIR}/preview-${name}.svg`);
}

console.log("\nDone! Generated", Object.keys(previews).length, "preview images.");
