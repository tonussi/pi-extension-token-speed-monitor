import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface TokenMetrics {
  startTime: number;
  tokenCount: number;
  lastUpdateTime: number;
  tps: number; // tokens per second (smoothed)
  finalTPS: number; // final average when streaming ends
  isStreaming: boolean;
}

interface SessionStats {
  totalTokens: number;
  totalTimeMs: number;
  messageCount: number;
}

export default function (pi: ExtensionAPI) {
  let enabled = false;
  let currentMetrics: TokenMetrics | null = null;
  let renderRequested = false;
  let tuiRef: { requestRender(): void } | null = null;
  let logInterval: NodeJS.Timeout | null = null;
  let currentLogFile: string | null = null;
  let currentModel: string = "no-model";
  const LOG_INTERVAL_MS = 100; // 0.1 seconds for quicker refresh
  const LOG_DIR = path.join(os.homedir(), "token-speed-monitor", "pi-logs");

  function getLogFilePath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // YYYY-MM-DDTHH-MM-SS
    return path.join(LOG_DIR, `tks-${timestamp}.log`);
  }

  function ensureLogDir(): void {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  function rotateLogFile(): void {
    ensureLogDir();
    const newLogFile = getLogFilePath();
    currentLogFile = newLogFile;
    // Write header to new log file
    fs.writeFileSync(currentLogFile, "datetime\ttps\tmodel\n"); // tab-separated header
  }

  function logMetrics(): void {
    if (!currentMetrics || !enabled) return;
    
    // Rotate check: if current log doesn't exist (deleted) or we need to start fresh
    if (!currentLogFile || !fs.existsSync(currentLogFile)) {
      rotateLogFile();
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const tps = currentMetrics.tps.toFixed(2);

    const logLine = `${timestamp}\t${tps}\t${currentModel}\n`;
    fs.appendFileSync(currentLogFile!, logLine);
  }

  // Smoothing factor for TPS calculation (higher = more responsive but more jittery)
  const ALPHA = 0.3;

  function updateTPS() {
    if (!currentMetrics) return;
    
    const now = Date.now();
    const elapsed = (now - currentMetrics.startTime) / 1000; // seconds
    
    if (elapsed > 0) {
      const instantTPS = currentMetrics.tokenCount / elapsed;
      // Smooth the TPS value
      currentMetrics.tps = currentMetrics.tps === 0 
        ? instantTPS 
        : currentMetrics.tps * (1 - ALPHA) + instantTPS * ALPHA;
    }
    
    currentMetrics.lastUpdateTime = now;
    
    // Request footer re-render
    if (!renderRequested && tuiRef) {
      renderRequested = true;
      tuiRef.requestRender();
      // Reset after a short delay
      setTimeout(() => { renderRequested = false; }, 100);
    }
  }

  let sessionStats: SessionStats = {
    totalTokens: 0,
    totalTimeMs: 0,
    messageCount: 0,
  };

  function resetMetrics() {
    // Save previous session stats if we have completed metrics
    if (currentMetrics && !currentMetrics.isStreaming && currentMetrics.finalTPS > 0) {
      const elapsed = currentMetrics.lastUpdateTime - currentMetrics.startTime;
      sessionStats.totalTokens += currentMetrics.tokenCount;
      sessionStats.totalTimeMs += elapsed;
      sessionStats.messageCount++;
    }
    
    currentMetrics = {
      startTime: Date.now(),
      tokenCount: 0,
      lastUpdateTime: Date.now(),
      tps: 0,
      finalTPS: 0,
      isStreaming: true,
    };
  }

  function formatTPS(tps: number): string {
    if (tps === 0) return "—";
    if (tps < 10) return tps.toFixed(1);
    return Math.round(tps).toString();
  }

  // Listen for streaming start
  pi.on("turn_start", async () => {
    resetMetrics();
  });

  // Track tokens as they arrive
  pi.on("message_update", async (event) => {
    if (!enabled || !currentMetrics) return;
    
    const msgEvent = event.assistantMessageEvent as AssistantMessageEvent;
    
    if (msgEvent.type === "text_delta" && msgEvent.delta) {
      // Approximate token count from characters (rough estimate: ~4 chars per token)
      const charCount = msgEvent.delta.length;
      const estimatedTokens = Math.max(1, Math.round(charCount / 4));
      currentMetrics.tokenCount += estimatedTokens;
      updateTPS();
    }
  });

  // Finalize on message complete - calculate final average TPS
  pi.on("message_end", async () => {
    if (currentMetrics) {
      const elapsed = (currentMetrics.lastUpdateTime - currentMetrics.startTime) / 1000;
      if (elapsed > 0) {
        currentMetrics.finalTPS = currentMetrics.tokenCount / elapsed;
      }
      currentMetrics.isStreaming = false;
      
      // Update session stats
      sessionStats.totalTokens += currentMetrics.tokenCount;
      sessionStats.totalTimeMs += currentMetrics.lastUpdateTime - currentMetrics.startTime;
      sessionStats.messageCount++;
      
      // Trigger render to show final stats
      if (tuiRef) tuiRef.requestRender();
    }
  });

  // Register command to toggle
  pi.registerCommand("tps", {
    description: "Toggle tokens per second monitor in footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;

      if (enabled) {
        // Capture current model from context
        currentModel = ctx.model?.id || "no-model";

        // Start logging interval
        rotateLogFile(); // Create initial log file
        logInterval = setInterval(logMetrics, LOG_INTERVAL_MS);
      } else {
        // Stop logging interval
        if (logInterval) {
          clearInterval(logInterval);
          logInterval = null;
        }
        currentLogFile = null;
      }

      if (enabled) {
        ctx.ui.setFooter((tui, theme, footerData) => {
          tuiRef = tui;
          const unsub = footerData.onBranchChange(() => tui.requestRender());

          return {
            dispose: () => {
              unsub();
              tuiRef = null;
            },
            invalidate() {},
            render(width: number): string[] {
              // Get built-in footer info
              let input = 0, output = 0;
              for (const e of ctx.sessionManager.getBranch()) {
                if (e.type === "message" && e.message.role === "assistant") {
                  const m = e.message;
                  input += m.usage.input;
                  output += m.usage.output;
                }
              }

              const branch = footerData.getGitBranch();
              const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
              
              // Build left side with tokens stats + TPS
              let leftParts: string[] = [`↑${fmt(input)} ↓${fmt(output)}`];
              
              if (currentMetrics) {
                if (currentMetrics.isStreaming && currentMetrics.tps > 0) {
                  // Show live metrics during streaming
                  const tpsStr = formatTPS(currentMetrics.tps);
                  const timeElapsed = ((currentMetrics.lastUpdateTime - currentMetrics.startTime) / 1000).toFixed(1);
                  leftParts.push(`⚡ ${tpsStr} t/s`);
                  leftParts.push(`⏱️ ${timeElapsed}s`);
                  leftParts.push(`📝 ~${currentMetrics.tokenCount}`);
                } else if (!currentMetrics.isStreaming && currentMetrics.finalTPS > 0) {
                  // Show final average when not streaming
                  const avgTPS = formatTPS(currentMetrics.finalTPS);
                  const timeElapsed = ((currentMetrics.lastUpdateTime - currentMetrics.startTime) / 1000).toFixed(1);
                  leftParts.push(`⌀ ${avgTPS} t/s`);
                  leftParts.push(`⏱️ ${timeElapsed}s`);
                  leftParts.push(`📝 ~${currentMetrics.tokenCount}`);
                } else if (sessionStats.messageCount > 0) {
                  // Show session average when no current metrics
                  const sessionAvgTPS = sessionStats.totalTimeMs > 0 
                    ? (sessionStats.totalTokens / (sessionStats.totalTimeMs / 1000)) 
                    : 0;
                  leftParts.push(`⌀ ${formatTPS(sessionAvgTPS)} t/s`);
                  leftParts.push(`📊 ${sessionStats.messageCount}`);
                }
              }
              
              const left = theme.fg("dim", leftParts.join(" "));
              const branchStr = branch ? ` (${branch})` : "";
              const right = theme.fg("dim", `${ctx.model?.id || "no-model"}${branchStr}`);

              const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
              return [truncateToWidth(left + pad + right, width)];
            },
          };
        });
        ctx.ui.notify("Token speed monitor enabled", "success");
      } else {
        ctx.ui.setFooter(undefined);
        currentMetrics = null;
        ctx.ui.notify("Default footer restored", "info");
      }
    },
  });

  // Cleanup on extension dispose
  pi.on("cleanup", () => {
    if (logInterval) {
      clearInterval(logInterval);
      logInterval = null;
    }
  });
}