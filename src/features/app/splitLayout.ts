export const SPLITTER_WIDTH_PX = 24

export function clampHistoryRatio(ratio: number, containerWidth: number) {
  const available = Math.max(0, containerWidth - SPLITTER_WIDTH_PX)
  if (available <= 0) return Math.min(0.8, Math.max(0.2, ratio))
  if (available < 700) return 280 / 700
  const minimum = Math.max(0.2, 280 / available)
  const maximum = Math.min(0.8, 1 - 420 / available)
  return Math.min(maximum, Math.max(minimum, ratio))
}
