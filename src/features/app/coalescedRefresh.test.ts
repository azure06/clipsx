import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoalescedRefresh } from './coalescedRefresh'

afterEach(() => vi.useRealTimers())

describe('progress refresh scheduling', () => {
  it('coalesces a burst and never overlaps an active refresh', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            finish = resolve
          })
      )
      .mockResolvedValue(undefined)
    const scheduler = createCoalescedRefresh(refresh)
    scheduler.request()
    for (let i = 0; i < 20; i++) scheduler.request()
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(2)
    for (let i = 0; i < 20; i++) scheduler.request()
    await vi.advanceTimersByTimeAsync(499)
    expect(refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(3)
    scheduler.dispose()
  })

  it('drops trailing work after disposal, including an active completion', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const refresh = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        })
    )
    const scheduler = createCoalescedRefresh(refresh)
    scheduler.request()
    scheduler.request()
    scheduler.dispose()
    finish()
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
