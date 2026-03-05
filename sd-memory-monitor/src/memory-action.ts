import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface MemoryInfo {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  swapUsedGB: number;
  swapTotalGB: number;
  pressure: "nominal" | "warn" | "critical";
  freePercent: number;
}

async function getMemoryInfo(): Promise<MemoryInfo> {
  const [vmStatResult, memsizeResult, swapResult, pressureResult, pageSizeResult] = await Promise.all([
    exec("vm_stat"),
    exec("sysctl", ["-n", "hw.memsize"]),
    exec("sysctl", ["vm.swapusage"]),
    exec("memory_pressure", ["-Q"]),
    exec("sysctl", ["-n", "hw.pagesize"]),
  ]);

  // Parse total RAM
  const totalBytes = parseInt(memsizeResult.stdout.trim());
  const totalGB = totalBytes / (1024 ** 3);

  // Parse vm_stat — page size varies by architecture (16KB on ARM64, 4KB on x86_64)
  const pageSize = parseInt(pageSizeResult.stdout.trim()) || 16384;
  const pages = (key: string): number => {
    const match = vmStatResult.stdout.match(new RegExp(`${key}:\\s+(\\d+)`));
    return match ? parseInt(match[1]) : 0;
  };

  const anonymous = pages("Anonymous pages");
  const purgeable = pages("Pages purgeable");
  const wired = pages("Pages wired down");
  const compressorOccupied = pages("Pages occupied by compressor");

  // Match Activity Monitor: Used = App Memory + Wired + Compressed
  // App Memory = (anonymous - purgeable) pages
  // Compressed = compressor-occupied pages (physical footprint)
  const appMemBytes = Math.max(0, anonymous - purgeable) * pageSize;
  const wiredBytes = wired * pageSize;
  const compressedBytes = compressorOccupied * pageSize;
  const usedBytes = appMemBytes + wiredBytes + compressedBytes;
  const usedGB = usedBytes / (1024 ** 3);
  const freeGB = totalGB - usedGB;

  // Parse swap
  const swapMatch = swapResult.stdout.match(/total = ([\d.]+)M\s+used = ([\d.]+)M/);
  const swapTotalGB = swapMatch ? parseFloat(swapMatch[1]) / 1024 : 0;
  const swapUsedGB = swapMatch ? parseFloat(swapMatch[2]) / 1024 : 0;

  // Parse pressure
  const freePercentMatch = pressureResult.stdout.match(/free percentage:\s+(\d+)%/);
  const freePercent = freePercentMatch ? parseInt(freePercentMatch[1]) : 50;

  let pressure: "nominal" | "warn" | "critical" = "nominal";
  if (freePercent < 20) pressure = "critical";
  else if (freePercent < 40) pressure = "warn";

  return { totalGB, usedGB, freeGB, swapUsedGB, swapTotalGB, pressure, freePercent };
}

// --- SVG rendering ---

const W = 144;
const H = 144;

function fmt(gb: number): string {
  if (gb >= 10) return `${gb.toFixed(0)}G`;
  if (gb >= 1) return `${gb.toFixed(1)}G`;
  return `${(gb * 1024).toFixed(0)}M`;
}

function pressureColor(pressure: "nominal" | "warn" | "critical"): string {
  switch (pressure) {
    case "nominal": return "#4CAF50";
    case "warn": return "#FFA726";
    case "critical": return "#E57373";
  }
}

function barColor(pct: number): string {
  if (pct < 0.6) return "#4CAF50";
  if (pct < 0.8) return "#FFA726";
  return "#E57373";
}

function renderMemoryImage(info: MemoryInfo): string {
  const ramPct = Math.min(1, info.usedGB / info.totalGB);
  const swapPct = info.swapTotalGB > 0 ? Math.min(1, info.swapUsedGB / info.swapTotalGB) : 0;
  const pc = pressureColor(info.pressure);
  const ramColor = barColor(ramPct);
  const swapColor = info.swapUsedGB > 0.1 ? barColor(swapPct) : "#555";

  // Layout:
  // Row 1 (y=12): Pressure indicator dot + "RAM" title + used/total
  // Row 2 (y=34): RAM bar
  // Row 3 (y=56): "SWAP" label + used/total
  // Row 4 (y=76): Swap bar
  // Row 5 (y=100): Free RAM value

  const barW = 120;
  const barH = 14;
  const barX = 12;
  const barR = 4;
  const ramFillW = Math.round(barW * ramPct);
  const swapFillW = Math.round(barW * swapPct);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>

  <!-- Pressure dot + RAM header -->
  <circle cx="20" cy="18" r="5" fill="${pc}"/>
  <text x="30" y="22" font-family="-apple-system,Helvetica" font-size="12" font-weight="600" fill="#aaa">RAM</text>
  <text x="132" y="22" font-family="-apple-system,Helvetica" font-size="11" fill="#ccc" text-anchor="end">${fmt(info.usedGB)} / ${fmt(info.totalGB)}</text>

  <!-- RAM bar -->
  <defs><clipPath id="rb"><rect x="${barX}" y="30" width="${barW}" height="${barH}" rx="${barR}"/></clipPath></defs>
  <rect x="${barX}" y="30" width="${barW}" height="${barH}" rx="${barR}" fill="#333"/>
  ${ramFillW > 0 ? `<rect x="${barX}" y="30" width="${ramFillW}" height="${barH}" fill="${ramColor}" clip-path="url(#rb)"/>` : ""}

  <!-- Swap header -->
  <text x="12" y="64" font-family="-apple-system,Helvetica" font-size="11" font-weight="600" fill="#aaa">SWAP</text>
  <text x="132" y="64" font-family="-apple-system,Helvetica" font-size="11" fill="#ccc" text-anchor="end">${fmt(info.swapUsedGB)}${info.swapTotalGB > 0 ? ` / ${fmt(info.swapTotalGB)}` : ""}</text>

  <!-- Swap bar -->
  <defs><clipPath id="sb"><rect x="${barX}" y="72" width="${barW}" height="${barH}" rx="${barR}"/></clipPath></defs>
  <rect x="${barX}" y="72" width="${barW}" height="${barH}" rx="${barR}" fill="#333"/>
  ${swapFillW > 0 ? `<rect x="${barX}" y="72" width="${swapFillW}" height="${barH}" fill="${swapColor}" clip-path="url(#sb)"/>` : ""}

  <!-- Free RAM -->
  <text x="72" y="108" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="${pc}" text-anchor="middle">${fmt(info.freeGB)} free</text>

  <!-- Pressure label -->
  <text x="72" y="126" font-family="-apple-system,Helvetica" font-size="10" fill="#666" text-anchor="middle">${info.pressure === "nominal" ? "Normal" : info.pressure === "warn" ? "Pressure" : "Critical"} · ${info.freePercent}%</text>
</svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// --- Action ---

interface InstanceState {
  pollTimer: ReturnType<typeof setInterval> | null;
}

@action({ UUID: "com.local.memory-monitor.display" })
export class MemoryAction extends SingletonAction {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const state: InstanceState = { pollTimer: null };
    this.instances.set(ev.action.id, state);

    // Update immediately
    await this.update(ev.action);

    // Poll every 3 seconds
    state.pollTimer = setInterval(() => this.update(ev.action), 3000);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state?.pollTimer) clearInterval(state.pollTimer);
    this.instances.delete(ev.action.id);
  }

  private async update(action: any): Promise<void> {
    try {
      const info = await getMemoryInfo();
      const svg = renderMemoryImage(info);
      await action.setImage(svgDataUri(svg));
      await action.setTitle("");
    } catch (err: any) {
      console.error("Memory update failed:", err.message);
    }
  }
}
