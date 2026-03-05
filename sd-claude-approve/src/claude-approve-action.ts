import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
} from "@elgato/streamdeck";
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";

const PENDING_DIR = "/tmp/claude-sd";

interface PendingTool {
  tool_name: string;
  tool_input: Record<string, any>;
  timestamp: number;
  session_id: string;
  request_id: string;
}

// --- SVG rendering ---

const W = 144;
const H = 144;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toolSummary(tool: PendingTool): { line1: string; line2: string; line3: string } {
  const name = tool.tool_name;
  const input = tool.tool_input;

  switch (name) {
    case "Bash":
      return {
        line1: "Bash",
        line2: truncate(input.command || "", 22),
        line3: input.description ? truncate(input.description, 22) : "",
      };
    case "Write":
      return {
        line1: "Write",
        line2: truncate((input.file_path || "").split("/").pop() || "", 22),
        line3: `${((input.content || "").length / 1024).toFixed(1)}KB`,
      };
    case "Edit":
      return {
        line1: "Edit",
        line2: truncate((input.file_path || "").split("/").pop() || "", 22),
        line3: truncate(input.new_string?.split("\n")[0] || "", 22),
      };
    case "NotebookEdit":
      return {
        line1: "Notebook",
        line2: truncate((input.notebook_path || "").split("/").pop() || "", 22),
        line3: input.edit_mode || "replace",
      };
    default:
      return {
        line1: truncate(name, 22),
        line2: truncate(JSON.stringify(input).slice(0, 22), 22),
        line3: "",
      };
  }
}

function renderIdle(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>
  <text x="72" y="60" font-family="-apple-system,Helvetica" font-size="14" font-weight="600" fill="#555" text-anchor="middle">Claude</text>
  <text x="72" y="82" font-family="-apple-system,Helvetica" font-size="11" fill="#444" text-anchor="middle">Waiting...</text>
  <circle cx="72" cy="108" r="8" fill="#333" stroke="#444" stroke-width="1"/>
</svg>`;
}

function renderPending(tool: PendingTool, queueSize: number): string {
  const summary = toolSummary(tool);
  const age = Math.round((Date.now() / 1000 - tool.timestamp));
  const timeLeft = Math.max(0, 60 - age);
  const queueLabel = queueSize > 1 ? `1/${queueSize}` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>
  <rect x="4" y="4" width="136" height="136" rx="24" fill="none" stroke="#FFA726" stroke-width="3" opacity=".7"/>
  <text x="72" y="28" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="#FFA726" text-anchor="middle">${escapeXml(summary.line1)}</text>
  <text x="72" y="50" font-family="Menlo,monospace" font-size="10" fill="#ccc" text-anchor="middle">${escapeXml(summary.line2)}</text>
  ${summary.line3 ? `<text x="72" y="66" font-family="Menlo,monospace" font-size="9" fill="#888" text-anchor="middle">${escapeXml(summary.line3)}</text>` : ""}
  <rect x="22" y="80" width="100" height="30" rx="8" fill="#4CAF50"/>
  <text x="72" y="100" font-family="-apple-system,Helvetica" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">APPROVE</text>
  <text x="${queueLabel ? 28 : 72}" y="130" font-family="-apple-system,Helvetica" font-size="10" fill="#666" text-anchor="middle">${timeLeft}s</text>
  ${queueLabel ? `<text x="110" y="130" font-family="-apple-system,Helvetica" font-size="10" font-weight="600" fill="#FFA726" text-anchor="middle">${queueLabel}</text>` : ""}
</svg>`;
}

function renderApproved(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="#1a1a2e"/>
  <rect x="4" y="4" width="136" height="136" rx="24" fill="none" stroke="#4CAF50" stroke-width="3"/>
  <text x="72" y="68" font-family="-apple-system,Helvetica" font-size="36" fill="#4CAF50" text-anchor="middle">\u2713</text>
  <text x="72" y="96" font-family="-apple-system,Helvetica" font-size="13" font-weight="600" fill="#4CAF50" text-anchor="middle">Approved</text>
</svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// --- Helpers ---

function getPendingQueue(): PendingTool[] {
  try {
    const files = readdirSync(PENDING_DIR).filter(f => f.startsWith("pending-") && f.endsWith(".json"));
    const tools: PendingTool[] = [];
    for (const file of files) {
      try {
        const data = readFileSync(`${PENDING_DIR}/${file}`, "utf-8");
        const tool: PendingTool = JSON.parse(data);
        // Skip stale entries (older than 65s — hook times out at 60s)
        if (Date.now() / 1000 - tool.timestamp <= 65) {
          tools.push(tool);
        } else {
          try { unlinkSync(`${PENDING_DIR}/${file}`); } catch {}
        }
      } catch {
        // Skip unreadable files
      }
    }
    // Sort by timestamp — oldest first
    tools.sort((a, b) => a.timestamp - b.timestamp);
    return tools;
  } catch {
    return [];
  }
}

// --- Action ---

interface InstanceState {
  pollTimer: ReturnType<typeof setInterval> | null;
  currentRequestId: string | null;
}

@action({ UUID: "com.local.claude-approve.button" })
export class ClaudeApproveAction extends SingletonAction {
  private instances = new Map<string, InstanceState>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const state: InstanceState = {
      pollTimer: null,
      currentRequestId: null,
    };
    this.instances.set(ev.action.id, state);

    state.pollTimer = setInterval(() => this.checkPending(ev.action, state), 500);
    await this.showIdle(ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (state?.pollTimer) clearInterval(state.pollTimer);
    this.instances.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const state = this.instances.get(ev.action.id);
    if (!state?.currentRequestId) return;

    try {
      writeFileSync(`${PENDING_DIR}/response-${state.currentRequestId}`, "approve");
      state.currentRequestId = null;

      await ev.action.setImage(svgDataUri(renderApproved()));
      await ev.action.setTitle("");

      // Check for more in queue after brief flash
      setTimeout(() => this.checkPending(ev.action, state), 800);
    } catch (err: any) {
      console.error("Failed to write approval:", err.message);
    }
  }

  private async checkPending(action: any, state: InstanceState): Promise<void> {
    try {
      const queue = getPendingQueue();

      if (queue.length > 0) {
        const next = queue[0];
        state.currentRequestId = next.request_id;
        await action.setImage(svgDataUri(renderPending(next, queue.length)));
        await action.setTitle("");
      } else {
        state.currentRequestId = null;
        await this.showIdle(action);
      }
    } catch {
      // Skip errors
    }
  }

  private async showIdle(action: any): Promise<void> {
    await action.setImage(svgDataUri(renderIdle()));
    await action.setTitle("");
  }
}
