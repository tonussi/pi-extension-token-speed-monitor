export function formatTPS(tps: number): string {
  if (tps === 0) return "—"
  if (tps < 10) return tps.toFixed(1)
  return Math.round(tps).toString()
}

export const fmtTokens = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`)
