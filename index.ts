import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { AssistantMessageEvent } from "@mariozechner/pi-ai"
import { MetricsTracker } from "./src/MetricsTracker"
import { renderFooter } from "./src/FooterRenderer"

export default function (pi: ExtensionAPI) {
  let enabled = false
  const metrics = new MetricsTracker()

  // Listen for streaming start
  pi.on("turn_start", async () => {
    metrics.reset()
  })

  // Track tokens as they arrive
  pi.on("message_update", async (event) => {
    if (!enabled) return

    const msgEvent = event.assistantMessageEvent as AssistantMessageEvent
    if (msgEvent.type === "text_delta" && msgEvent.delta) {
      metrics.update(msgEvent.delta)
    }
  })

  // Finalize on message complete
  pi.on("message_end", async () => {
    metrics.finalize()
  })

  // Register command to toggle
  pi.registerCommand("tps", {
    description: "Toggle tokens per second monitor in footer",
    handler: async (_args, ctx) => {
      enabled = !enabled

      if (enabled) {
        ctx.ui.setFooter((tui, theme, footerData) => {
          metrics.setTui(tui)
          const unsub = footerData.onBranchChange(() => tui.requestRender())

          return {
            dispose: () => {
              unsub()
              metrics.setTui(null)
              metrics.clear()
            },
            invalidate() {},
            render(width: number): string[] {
              // Get built-in footer info (usage stats)
              let input = 0,
                output = 0
              for (const e of ctx.sessionManager.getBranch()) {
                if (e.type === "message" && e.message.role === "assistant") {
                  const m = e.message
                  input += m.usage.input
                  output += m.usage.output
                }
              }

              return renderFooter(
                width,
                theme,
                metrics.getMetrics(),
                { input, output },
                ctx.model?.id || "no-model",
                footerData.getGitBranch(),
              )
            },
          }
        })
        ctx.ui.notify("Token speed monitor enabled", "info")
      } else {
        ctx.ui.setFooter(undefined)
        metrics.clear()
        ctx.ui.notify("Default footer restored", "info")
      }
    },
  })
}
