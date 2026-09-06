import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncStatus } from './configSync'
import { ConfigurationSyncScheduler, configurationSyncTiming } from './configSyncScheduler'

const userId = 'account-1'

function syncStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    enabled: true,
    activeUserId: userId,
    deviceId: 'device-1',
    deviceName: 'Test device',
    generation: 1,
    localEpoch: 1,
    serverCursor: 0,
    pendingRecords: 0,
    quarantinedRecords: 0,
    pendingEffects: 0,
    lastAttemptAt: Date.now(),
    lastSuccessAt: Date.now(),
    lastError: null,
    ...overrides,
  }
}

describe('ConfigurationSyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(active = true) {
    let current = syncStatus()
    let online = true
    const getStatus = vi.fn(() => Promise.resolve(current))
    const synchronize = vi.fn(() => {
      current = syncStatus({ pendingRecords: 0, lastSuccessAt: Date.now() })
      return Promise.resolve(current)
    })
    const onSynchronized = vi.fn()
    const scheduler = new ConfigurationSyncScheduler({
      getStatus,
      synchronize,
      isOnline: () => online,
    })
    const startup = scheduler.start({ userId, active, onSynchronized })
    return {
      scheduler,
      startup,
      getStatus,
      synchronize,
      onSynchronized,
      setStatus: (status: SyncStatus) => {
        current = status
      },
      setOnline: (value: boolean) => {
        online = value
      },
    }
  }

  it('syncs once at startup without installing an idle poll', async () => {
    const { scheduler, startup, synchronize } = setup()
    await startup
    expect(synchronize).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(synchronize).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('settles focus and limits automatic pulls to one per freshness window', async () => {
    const { scheduler, startup, synchronize } = setup()
    await startup

    scheduler.setWindowActive(false)
    scheduler.setWindowActive(true)
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.focusSettleMs)
    expect(synchronize).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(configurationSyncTiming.focusFreshnessMs)
    scheduler.setWindowActive(false)
    scheduler.setWindowActive(true)
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.focusSettleMs)
    expect(synchronize).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('debounces mutations for five seconds', async () => {
    const { scheduler, startup, synchronize } = setup()
    await startup

    void scheduler.request('mutation')
    await vi.advanceTimersByTimeAsync(4_000)
    void scheduler.request('mutation')
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.mutationDebounceMs - 1)
    expect(synchronize).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(synchronize).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('does not postpone continuous mutations beyond thirty seconds', async () => {
    const { scheduler, startup, synchronize } = setup()
    await startup

    for (let elapsed = 0; elapsed < configurationSyncTiming.mutationMaxWaitMs; elapsed += 4_000) {
      void scheduler.request('mutation')
      await vi.advanceTimersByTimeAsync(4_000)
    }
    expect(synchronize).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('defers reconnect while hidden and resumes after stable activation', async () => {
    const { scheduler, startup, synchronize } = setup(false)
    await startup

    await scheduler.request('reconnect')
    expect(synchronize).toHaveBeenCalledTimes(1)
    scheduler.setWindowActive(true)
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.focusSettleMs - 1)
    expect(synchronize).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(synchronize).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('retains mutations offline and sends them after reconnect', async () => {
    const { scheduler, startup, synchronize, setOnline } = setup()
    await startup
    setOnline(false)

    void scheduler.request('mutation')
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.mutationMaxWaitMs)
    expect(synchronize).toHaveBeenCalledTimes(1)

    setOnline(true)
    await scheduler.request('reconnect')
    expect(synchronize).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('bounds retries for pending uploads and stops while hidden', async () => {
    const { scheduler, startup, synchronize, setStatus } = setup()
    await startup
    setStatus(syncStatus({ pendingRecords: 1, lastSuccessAt: null }))
    synchronize.mockRejectedValue(new Error('offline'))

    void scheduler.request('mutation')
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.mutationDebounceMs)
    for (const delay of configurationSyncTiming.retryDelaysMs) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    expect(synchronize).toHaveBeenCalledTimes(7)

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(synchronize).toHaveBeenCalledTimes(7)
    scheduler.setWindowActive(false)
    void scheduler.request('mutation')
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.mutationMaxWaitMs)
    expect(synchronize).toHaveBeenCalledTimes(7)
    scheduler.stop()
  })

  it('lets manual requests bypass focus freshness and share an in-flight operation', async () => {
    const { scheduler, startup, synchronize } = setup()
    await startup
    let release: ((status: SyncStatus) => void) | undefined
    synchronize.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve
        })
    )

    const first = scheduler.request('manual')
    const second = scheduler.request('manual')
    expect(synchronize).toHaveBeenCalledTimes(2)
    release?.(syncStatus())
    await expect(first).resolves.toMatchObject({ enabled: true })
    await expect(second).resolves.toMatchObject({ enabled: true })
    scheduler.stop()
  })

  it('cancels delayed work when its lifecycle stops', async () => {
    const { scheduler, startup, synchronize } = setup()
    await startup
    void scheduler.request('mutation')
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(configurationSyncTiming.mutationMaxWaitMs)
    expect(synchronize).toHaveBeenCalledTimes(1)
  })
})
