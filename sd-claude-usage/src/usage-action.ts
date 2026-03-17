import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, KeyDownEvent } from "@elgato/streamdeck";
import { execFile } from "child_process";
import { promisify } from "util";
import https from "https";

const execFileAsync = promisify(execFile);

interface RateLimitInfo {
  status: string;          // "allowed" | "rate_limited"
  utilization5h: number;   // 0-1
  reset5h: number;         // unix timestamp (seconds)
  status5h: string;
  utilization7d: number;
  reset7d: number;
  status7d: string;
  representativeClaim: string; // "five_hour" | "seven_day"
}

async function getOAuthToken(): Promise<string> {
  const { stdout } = await execFileAsync("security", [
    "find-generic-password",
    "-s", "Claude Code-credentials",
    "-w",
  ]);
  const creds = JSON.parse(stdout.trim());
  const oauth = creds.claudeAiOauth;

  // Check if token is expired
  if (Date.now() > oauth.expiresAt) {
    throw new Error("OAuth token expired — open Claude Code to refresh");
  }

  return oauth.accessToken;
}

function apiCall(token: string): Promise<{ body: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v[0];
          }
          try {
            resolve({ body: JSON.parse(data), headers });
          } catch {
            reject(new Error(`API parse error: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error("API timeout"));
    });
    req.write(payload);
    req.end();
  });
}

async function getRateLimits(): Promise<RateLimitInfo> {
  const token = await getOAuthToken();
  const { headers } = await apiCall(token);

  return {
    status: headers["anthropic-ratelimit-unified-status"] || "unknown",
    utilization5h: parseFloat(headers["anthropic-ratelimit-unified-5h-utilization"] || "0"),
    reset5h: parseInt(headers["anthropic-ratelimit-unified-5h-reset"] || "0", 10),
    status5h: headers["anthropic-ratelimit-unified-5h-status"] || "unknown",
    utilization7d: parseFloat(headers["anthropic-ratelimit-unified-7d-utilization"] || "0"),
    reset7d: parseInt(headers["anthropic-ratelimit-unified-7d-reset"] || "0", 10),
    status7d: headers["anthropic-ratelimit-unified-7d-status"] || "unknown",
    representativeClaim: headers["anthropic-ratelimit-unified-representative-claim"] || "five_hour",
  };
}

function formatClock(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

type PaceStatus = "idle" | "low" | "moderate" | "high" | "critical" | "limited";

function getPaceStatus(info: RateLimitInfo): PaceStatus {
  if (info.status === "rate_limited" || info.status5h === "rate_limited") return "limited";
  const u = info.utilization5h;
  const remaining = 1 - u;

  // How much of the 5h window is left (0-1)
  const resetMs = info.reset5h * 1000 - Date.now();
  const windowFractionLeft = Math.max(0, Math.min(1, resetMs / (5 * 3600_000)));

  // If there's plenty of budget left relative to time remaining, it's fine.
  // "pressure" = how much budget we'd need per unit time vs what's available.
  // Low pressure = we have more budget than time to spend it.
  if (u <= 0.01) return "idle";
  if (u >= 0.95) return "critical";

  // If the window resets soon, current utilization doesn't matter much
  // because tokens will roll off. Only worry if we're very close to the limit.
  if (windowFractionLeft < 0.1) {
    // Less than 30 min left — usage is about to roll off
    return u >= 0.90 ? "high" : "low";
  }

  // Compare burn rate to sustainable rate
  // If we've used 40% with 80% of the window gone, we're fine (pace = 0.5)
  // If we've used 40% with 20% of the window gone, we're burning fast (pace = 2.0)
  const windowFractionUsed = 1 - windowFractionLeft;
  const pace = windowFractionUsed > 0.01 ? u / windowFractionUsed : 0;

  if (pace >= 1.5 || remaining < 0.10) return "critical";
  if (pace >= 1.0 || remaining < 0.20) return "high";
  if (pace >= 0.7) return "moderate";
  return "low";
}

function statusColor(s: PaceStatus): string {
  switch (s) {
    case "idle": return "#666";
    case "low": return "#4CAF50";
    case "moderate": return "#FFA726";
    case "high": return "#FF7043";
    case "critical": return "#E57373";
    case "limited": return "#F44336";
  }
}

function statusLabel(s: PaceStatus): string {
  switch (s) {
    case "idle": return "IDLE";
    case "low": return "LOW";
    case "moderate": return "MED";
    case "high": return "HIGH";
    case "critical": return "CRIT";
    case "limited": return "LIMIT";
  }
}

function renderImage(info: RateLimitInfo): string {
  const now = Date.now();
  const pct5h = Math.min(100, info.utilization5h * 100);
  const pct7d = Math.min(100, info.utilization7d * 100);
  const fill5h = Math.round((112 * pct5h) / 100);
  const fill7d = Math.round((112 * pct7d) / 100);
  const pace = getPaceStatus(info);
  const color = statusColor(pace);
  const label = statusLabel(pace);

  // Time until 5h window reset
  const resetMs = info.reset5h * 1000 - now;
  const resetIn = formatDuration(resetMs);

  // 7d color
  const color7d = info.utilization7d >= 0.7 ? "#FF7043" : info.utilization7d >= 0.4 ? "#FFA726" : "#4CAF50";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="28" fill="#1a1a2e"/>

    <!-- Header -->
    <circle cx="18" cy="16" r="5" fill="#D4A574"/>
    <text x="28" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="#ddd">Claude</text>

    <!-- Status badge -->
    <rect x="${144 - 8 - label.length * 6.5}" y="8" width="${label.length * 6.5 + 8}" height="16" rx="4" fill="${color}" opacity="0.25"/>
    <text x="${144 - 4}" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="9" font-weight="700" fill="${color}" text-anchor="end">${label}</text>

    <!-- 5h utilization: big number -->
    <text x="72" y="50" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="700" fill="${color}" text-anchor="middle">${pct5h.toFixed(0)}%</text>
    <text x="72" y="63" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="#888" text-anchor="middle">5h window</text>

    <!-- 5h progress bar -->
    <defs>
      <clipPath id="b5"><rect x="16" y="70" width="112" height="10" rx="5"/></clipPath>
      <clipPath id="b7"><rect x="16" y="100" width="112" height="8" rx="4"/></clipPath>
    </defs>
    <rect x="16" y="70" width="112" height="10" rx="5" fill="#333"/>
    ${fill5h > 0 ? `<rect x="16" y="70" width="${fill5h}" height="10" fill="${color}" clip-path="url(#b5)"/>` : ""}

    <!-- 7d bar -->
    <text x="16" y="96" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="#666">7d</text>
    <text x="128" y="96" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${color7d}" text-anchor="end">${pct7d.toFixed(0)}%</text>
    <rect x="16" y="100" width="112" height="8" rx="4" fill="#333"/>
    ${fill7d > 0 ? `<rect x="16" y="100" width="${fill7d}" height="8" fill="${color7d}" clip-path="url(#b7)"/>` : ""}

    <!-- Bottom: reset time -->
    <text x="16" y="125" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="#666">resets</text>
    <text x="16" y="137" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="#aaa">${formatClock(info.reset5h)}</text>

    <text x="72" y="125" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="#666" text-anchor="middle">in</text>
    <text x="72" y="137" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="#aaa" text-anchor="middle">${resetIn}</text>

    <text x="128" y="125" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="#666" text-anchor="end">claim</text>
    <text x="128" y="137" font-family="system-ui,-apple-system,sans-serif" font-size="9" font-weight="600" fill="#aaa" text-anchor="end">${info.representativeClaim === "five_hour" ? "5h" : "7d"}</text>
  </svg>`;
}

function renderError(msg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="28" fill="#1a1a2e"/>
    <circle cx="18" cy="16" r="5" fill="#D4A574"/>
    <text x="28" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="#ddd">Claude</text>
    <text x="72" y="75" font-family="system-ui,-apple-system,sans-serif" font-size="10" fill="#E57373" text-anchor="middle">${msg.length > 18 ? msg.slice(0, 18) + "…" : msg}</text>
    <text x="72" y="95" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="#666" text-anchor="middle">press to retry</text>
  </svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

interface InstanceState {
  pollTimer: ReturnType<typeof setInterval> | null;
  lastInfo: RateLimitInfo | null;
}

@action({ UUID: "com.local.claude-usage.display" })
export class ClaudeUsageAction extends SingletonAction {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const state: InstanceState = { pollTimer: null, lastInfo: null };
    this.instances.set(ev.action.id, state);

    await this.update(ev.action, state);
    // Poll every 60s — each poll costs 1 Haiku output token
    state.pollTimer = setInterval(() => this.update(ev.action, state), 60_000);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state?.pollTimer) clearInterval(state.pollTimer);
    this.instances.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state) return;
    await this.update(ev.action, state);
  }

  private async update(action: any, state: InstanceState): Promise<void> {
    try {
      const info = await getRateLimits();
      state.lastInfo = info;
      await action.setImage(svgDataUri(renderImage(info)));
      await action.setTitle("");
    } catch (err: any) {
      console.error("Claude usage update failed:", err.message);
      // Show cached data if available, otherwise show error
      if (state.lastInfo) {
        await action.setImage(svgDataUri(renderImage(state.lastInfo)));
      } else {
        await action.setImage(svgDataUri(renderError(err.message)));
      }
      await action.setTitle("");
    }
  }
}
