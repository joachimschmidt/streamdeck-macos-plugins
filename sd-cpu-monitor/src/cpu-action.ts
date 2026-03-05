import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface CpuGpuInfo {
  cpuUser: number;
  cpuSys: number;
  cpuIdle: number;
  cpuTotal: number;
  gpuDevice: number;
  gpuRenderer: number;
  gpuTiler: number;
}

async function getCpuGpuInfo(): Promise<CpuGpuInfo> {
  const [topResult, ioregResult] = await Promise.all([
    exec("top", ["-l1", "-s0", "-n0"]),
    exec("ioreg", ["-r", "-c", "IOAccelerator", "-l"]),
  ]);

  // Parse CPU from top
  const cpuMatch = topResult.stdout.match(
    /CPU usage:\s+([\d.]+)%\s+user,\s+([\d.]+)%\s+sys,\s+([\d.]+)%\s+idle/
  );
  const cpuUser = cpuMatch ? parseFloat(cpuMatch[1]) : 0;
  const cpuSys = cpuMatch ? parseFloat(cpuMatch[2]) : 0;
  const cpuIdle = cpuMatch ? parseFloat(cpuMatch[3]) : 0;
  const cpuTotal = cpuUser + cpuSys;

  // Parse GPU from ioreg PerformanceStatistics
  const gpuParse = (key: string): number => {
    const match = ioregResult.stdout.match(new RegExp(`"${key}"=(\\d+)`));
    return match ? parseInt(match[1]) : 0;
  };
  const gpuDevice = gpuParse("Device Utilization %");
  const gpuRenderer = gpuParse("Renderer Utilization %");
  const gpuTiler = gpuParse("Tiler Utilization %");

  return { cpuUser, cpuSys, cpuIdle, cpuTotal, gpuDevice, gpuRenderer, gpuTiler };
}

// --- SVG rendering ---

const W = 144;
const H = 144;

function usageColor(pct: number): string {
  if (pct < 50) return "#4CAF50";
  if (pct < 80) return "#FFA726";
  return "#E57373";
}

function renderImage(info: CpuGpuInfo): string {
  const barW = 120;
  const barH = 14;
  const barX = 12;
  const barR = 4;

  const cpuPct = Math.min(100, info.cpuTotal);
  const cpuFillW = Math.round((barW * cpuPct) / 100);
  const cpuColor = usageColor(cpuPct);

  // Show user vs sys as stacked bar
  const userW = Math.round((barW * Math.min(100, info.cpuUser)) / 100);
  const sysW = Math.round((barW * Math.min(100, info.cpuSys)) / 100);

  const gpuPct = Math.max(info.gpuDevice, info.gpuRenderer, info.gpuTiler);
  const gpuFillW = Math.round((barW * gpuPct) / 100);
  const gpuColor = usageColor(gpuPct);

  // GPU sub-bars: renderer + tiler shown separately
  const rendererW = Math.round((barW * info.gpuRenderer) / 100);
  const tilerW = Math.round((barW * info.gpuTiler) / 100);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>

  <!-- CPU header -->
  <circle cx="20" cy="18" r="5" fill="${cpuColor}"/>
  <text x="30" y="22" font-family="-apple-system,Helvetica" font-size="12" font-weight="600" fill="#aaa">CPU</text>
  <text x="132" y="22" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="${cpuColor}" text-anchor="end">${cpuPct.toFixed(0)}%</text>

  <!-- CPU bar (stacked: user=blue-ish, sys=orange-ish) -->
  <defs><clipPath id="cb"><rect x="${barX}" y="30" width="${barW}" height="${barH}" rx="${barR}"/></clipPath></defs>
  <rect x="${barX}" y="30" width="${barW}" height="${barH}" rx="${barR}" fill="#333"/>
  ${userW > 0 ? `<rect x="${barX}" y="30" width="${userW}" height="${barH}" fill="#4FC3F7" clip-path="url(#cb)"/>` : ""}
  ${sysW > 0 ? `<rect x="${barX + userW}" y="30" width="${sysW}" height="${barH}" fill="#FF8A65" clip-path="url(#cb)"/>` : ""}

  <!-- CPU breakdown -->
  <circle cx="18" cy="56" r="4" fill="#4FC3F7"/>
  <text x="26" y="59" font-family="-apple-system,Helvetica" font-size="10" fill="#999">User ${info.cpuUser.toFixed(0)}%</text>
  <circle cx="80" cy="56" r="4" fill="#FF8A65"/>
  <text x="88" y="59" font-family="-apple-system,Helvetica" font-size="10" fill="#999">Sys ${info.cpuSys.toFixed(0)}%</text>

  <!-- GPU header -->
  <circle cx="20" cy="80" r="5" fill="${gpuColor}"/>
  <text x="30" y="84" font-family="-apple-system,Helvetica" font-size="12" font-weight="600" fill="#aaa">GPU</text>
  <text x="132" y="84" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="${gpuColor}" text-anchor="end">${gpuPct}%</text>

  <!-- GPU bar -->
  <defs><clipPath id="gb"><rect x="${barX}" y="92" width="${barW}" height="${barH}" rx="${barR}"/></clipPath></defs>
  <rect x="${barX}" y="92" width="${barW}" height="${barH}" rx="${barR}" fill="#333"/>
  ${gpuFillW > 0 ? `<rect x="${barX}" y="92" width="${gpuFillW}" height="${barH}" fill="${gpuColor}" clip-path="url(#gb)"/>` : ""}

  <!-- GPU breakdown -->
  <text x="16" y="122" font-family="-apple-system,Helvetica" font-size="10" fill="#666">Render ${info.gpuRenderer}%</text>
  <text x="84" y="122" font-family="-apple-system,Helvetica" font-size="10" fill="#666">Tiler ${info.gpuTiler}%</text>
</svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// --- Action ---

interface InstanceState {
  pollTimer: ReturnType<typeof setInterval> | null;
}

@action({ UUID: "com.local.cpu-monitor.display" })
export class CpuAction extends SingletonAction {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const state: InstanceState = { pollTimer: null };
    this.instances.set(ev.action.id, state);

    await this.update(ev.action);
    state.pollTimer = setInterval(() => this.update(ev.action), 3000);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state?.pollTimer) clearInterval(state.pollTimer);
    this.instances.delete(ev.action.id);
  }

  private async update(action: any): Promise<void> {
    try {
      const info = await getCpuGpuInfo();
      await action.setImage(svgDataUri(renderImage(info)));
      await action.setTitle("");
    } catch (err: any) {
      console.error("CPU/GPU update failed:", err.message);
    }
  }
}
