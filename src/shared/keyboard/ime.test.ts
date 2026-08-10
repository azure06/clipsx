import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImeTracker } from './ime'

describe('macOS IME debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('protects synchronous Enter after compositionend', () => {
    const tracker = createImeTracker()
    tracker.start()
    tracker.end()
    expect(tracker.active).toBe(true)
    vi.advanceTimersByTime(100)
    expect(tracker.active).toBe(false)
  })

  it('cancels an old reset when the next segment starts', () => {
    const tracker = createImeTracker()
    tracker.start()
    tracker.end()
    vi.advanceTimersByTime(50)
    tracker.start()
    vi.advanceTimersByTime(100)
    expect(tracker.active).toBe(true)
  })
})
