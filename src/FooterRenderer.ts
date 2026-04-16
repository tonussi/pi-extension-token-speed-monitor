import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui"
import { formatTPS, fmtTokens } from "./utils"
import { TokenMetrics } from "./types"

export function renderFooter(
  width: number,
  theme: any,
  metrics: TokenMetrics | null,
  usage: { input: number; output: number },
  modelId: string,
  gitBranch?: string,
): string[] {
  // Build left side with tokens stats + TPS
  let leftParts: string[] = [`↑${fmtTokens(usage.input)} ↓${fmtTokens(usage.output)}`]

  if (metrics && metrics.tps > 0) {
    const tpsStr = formatTPS(metrics.tps)
    const timeElapsed = ((metrics.lastUpdateTime - metrics.startTime) / 1000).toFixed(1)
    leftParts.push(`⚡ ${tpsStr} t/s`)
    leftParts.push(`⏱️ ${timeElapsed}s`)
    leftParts.push(`📝 ~${metrics.tokenCount}`)
  }

  const left = theme.fg("dim", leftParts.join(" "))
  const branchStr = gitBranch ? ` (${gitBranch})` : ""
  const right = theme.fg("dim", `${modelId}${branchStr}`)

  const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))
  return [truncateToWidth(left + pad + right, width)]
}
