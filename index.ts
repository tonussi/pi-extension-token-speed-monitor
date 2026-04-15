import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";

interface TokenMetrics {
  startTime: number;
  tokenCount: number;
  lastUpdateTime: number;
  tps: number; // tokens per second (smoothed)
}

export default function (pi: ExtensionAPI) {
  let enabled = false;
  let currentMetrics: TokenMetrics | null = null;
  let renderRequested = false;
  let tuiRef: { requestRender(): void } | null = null;

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

  function resetMetrics() {
    currentMetrics = {
      startTime: Date.now(),
      tokenCount: 0,
      lastUpdateTime: Date.now(),
      tps: 0,
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

  // Finalize on message complete
  pi.on("message_end", async () => {
    if (currentMetrics) {
      // Keep the last TPS value for a moment before clearing
      setTimeout(() => {
        if (!currentMetrics) return;
        // Fade out after 5 seconds
        setTimeout(() => {
          currentMetrics = null;
          if (tuiRef) tuiRef.requestRender();
        }, 5000);
      }, 100);
    }
  });

  // Register command to toggle
  pi.registerCommand("tps", {
    description: "Toggle tokens per second monitor in footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;

      if (enabled) {
        ctx.ui.setFooter((tui, theme, footerData) => {
          tuiRef = tui;
          const unsub = footerData.onBranchChange(() => tui.requestRender());

          return {
            dispose: () => {
              unsub();
              tuiRef = null;
              currentMetrics = null;
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
              
              if (currentMetrics && currentMetrics.tps > 0) {
                const tpsStr = formatTPS(currentMetrics.tps);
                const timeElapsed = ((currentMetrics.lastUpdateTime - currentMetrics.startTime) / 1000).toFixed(1);
                leftParts.push(`⚡ ${tpsStr} t/s`);
                leftParts.push(`⏱️ ${timeElapsed}s`);
                leftParts.push(`📝 ~${currentMetrics.tokenCount}`);
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
}