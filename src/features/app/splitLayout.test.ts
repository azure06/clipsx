import { describe, expect, it } from 'vitest'
import { clampHistoryRatio } from './splitLayout'

describe('history/preview split layout', () => {
  it('subtracts the separator and preserves both panel minimums when space permits', () => {
    expect(clampHistoryRatio(0.2, 1024)).toBeCloseTo(280 / 1000)
    expect(clampHistoryRatio(0.8, 1024)).toBeCloseTo(1 - 420 / 1000)
  })

  it('scales panel minimums proportionally in a narrow window', () => {
    expect(clampHistoryRatio(0.2, 600)).toBe(0.4)
    expect(clampHistoryRatio(0.8, 600)).toBe(0.4)
  })

  it('keeps the persisted contract inside the absolute range', () => {
    expect(clampHistoryRatio(-1, 2000)).toBe(0.2)
    expect(clampHistoryRatio(2, 2000)).toBeLessThanOrEqual(0.8)
    expect(clampHistoryRatio(2, 2000)).toBeGreaterThanOrEqual(0.2)
  })
})
