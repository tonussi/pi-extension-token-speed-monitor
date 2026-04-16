export interface TokenMetrics {
  startTime: number
  tokenCount: number
  lastUpdateTime: number
  tps: number // tokens per second (smoothed)
}
