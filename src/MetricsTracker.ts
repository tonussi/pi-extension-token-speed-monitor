import { ALPHA } from "./constants"
import { TokenMetrics } from "./types"

export class MetricsTracker {
  private currentMetrics: TokenMetrics | null = null
  private renderRequested = false
  private tuiRef: { requestRender(): void } | null = null

  reset() {
    this.currentMetrics = {
      startTime: Date.now(),
      tokenCount: 0,
      lastUpdateTime: Date.now(),
      tps: 0,
    }
  }

  update(delta: string) {
    if (!this.currentMetrics) return

    // Approximate token count from characters (rough estimate: ~4 chars per token)
    const charCount = delta.length
    const estimatedTokens = Math.max(1, Math.round(charCount / 4))
    this.currentMetrics.tokenCount += estimatedTokens
    this.updateTPS()
  }

  private updateTPS() {
    if (!this.currentMetrics) return

    const now = Date.now()
    const elapsed = (now - this.currentMetrics.startTime) / 1000

    if (elapsed > 0) {
      const instantTPS = this.currentMetrics.tokenCount / elapsed
      // Smooth the TPS value
      this.currentMetrics.tps =
        this.currentMetrics.tps === 0 ? instantTPS : this.currentMetrics.tps * (1 - ALPHA) + instantTPS * ALPHA
    }

    this.currentMetrics.lastUpdateTime = now
    this.triggerRender()
  }

  setTui(tui: { requestRender(): void } | null) {
    this.tuiRef = tui
  }

  private triggerRender() {
    if (!this.renderRequested && this.tuiRef) {
      this.renderRequested = true
      this.tuiRef.requestRender()
      // Reset after a short delay to throttle renders
      setTimeout(() => {
        this.renderRequested = false
      }, 100)
    }
  }

  getMetrics() {
    return this.currentMetrics
  }

  clear() {
    this.currentMetrics = null
    if (this.tuiRef) {
      this.tuiRef.requestRender()
    }
  }

  finalize() {
    if (this.currentMetrics) {
      // Keep the last TPS value for a moment before clearing
      setTimeout(() => {
        if (!this.currentMetrics) return
        // Fade out after 5 seconds
        setTimeout(() => {
          this.clear()
        }, 5000)
      }, 100)
    }
  }
}
