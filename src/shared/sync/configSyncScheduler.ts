import type { SyncStatus } from './configSync'

export type ConfigurationSyncReason =
  | 'startup'
  | 'activation'
  | 'reconnect'
  | 'mutation'
  | 'retry'
  | 'manual'

const MUTATION_DEBOUNCE_MS = 5_000
const MUTATION_MAX_WAIT_MS = 30_000
const FOCUS_SETTLE_MS = 2_000
const FOCUS_FRESHNESS_MS = 15 * 60_000
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const

type Timer = ReturnType<typeof setTimeout>

type SchedulerDependencies = {
  getStatus: () => Promise<SyncStatus>
  synchronize: (userId: string) => Promise<SyncStatus | null>
  now?: () => number
  isOnline?: () => boolean
}

type StartOptions = {
  userId: string
  active: boolean
  onSynchronized?: (status: SyncStatus) => void | Promise<void>
}

export class ConfigurationSyncScheduler {
  private readonly now: () => number
  private readonly isOnline: () => boolean
  private userId: string | null = null
  private windowActive = false
  private lifecycle = 0
  private running: Promise<SyncStatus | null> | null = null
  private mutationWaiting = false
  private mutationStartedAt: number | null = null
  private deferredReconnect = false
  private retryIndex = 0
  private lastFocusAttemptAt = 0
  private focusTimer: Timer | undefined
  private mutationTimer: Timer | undefined
  private mutationDeadlineTimer: Timer | undefined
  private retryTimer: Timer | undefined
  private onSynchronized?: (status: SyncStatus) => void | Promise<void>

  constructor(private readonly dependencies: SchedulerDependencies) {
    this.now = dependencies.now ?? Date.now
    this.isOnline = dependencies.isOnline ?? (() => navigator.onLine)
  }

  start(options: StartOptions): Promise<SyncStatus | null> {
    this.stop()
    this.userId = options.userId
    this.windowActive = options.active
    this.onSynchronized = options.onSynchronized
    return this.request('startup')
  }

  stop(): void {
    this.lifecycle++
    this.clearTimers()
    this.userId = null
    this.windowActive = false
    this.running = null
    this.mutationWaiting = false
    this.mutationStartedAt = null
    this.deferredReconnect = false
    this.retryIndex = 0
    this.lastFocusAttemptAt = 0
    this.onSynchronized = undefined
  }

  setWindowActive(active: boolean): void {
    if (this.windowActive === active) return
    this.windowActive = active
    clearTimeout(this.focusTimer)
    this.focusTimer = undefined

    if (!active) {
      clearTimeout(this.mutationTimer)
      clearTimeout(this.mutationDeadlineTimer)
      clearTimeout(this.retryTimer)
      this.mutationTimer = undefined
      this.mutationDeadlineTimer = undefined
      this.retryTimer = undefined
      return
    }

    const lifecycle = this.lifecycle
    this.focusTimer = setTimeout(() => {
      this.focusTimer = undefined
      if (lifecycle !== this.lifecycle || !this.windowActive) return
      const reason = this.mutationWaiting
        ? 'mutation'
        : this.deferredReconnect
          ? 'reconnect'
          : 'activation'
      this.deferredReconnect = false
      this.fire(reason)
    }, FOCUS_SETTLE_MS)
  }

  request(reason: ConfigurationSyncReason): Promise<SyncStatus | null> {
    if (!this.userId) return Promise.resolve(null)

    if (reason === 'mutation') {
      this.scheduleMutation()
      return Promise.resolve(null)
    }

    if (reason === 'activation' && !this.windowActive) return Promise.resolve(null)
    if (reason === 'reconnect' && !this.windowActive) {
      this.deferredReconnect = true
      return Promise.resolve(null)
    }
    if (reason === 'retry' && !this.windowActive) return Promise.resolve(null)

    return this.run(reason)
  }

  private scheduleMutation(): void {
    this.mutationWaiting = true
    if (this.mutationStartedAt === null) this.mutationStartedAt = this.now()
    if (!this.windowActive) return

    clearTimeout(this.mutationTimer)
    this.mutationTimer = setTimeout(() => {
      this.mutationTimer = undefined
      this.fireRun('mutation')
    }, MUTATION_DEBOUNCE_MS)

    if (!this.mutationDeadlineTimer) {
      const elapsed = this.now() - this.mutationStartedAt
      this.mutationDeadlineTimer = setTimeout(
        () => {
          this.mutationDeadlineTimer = undefined
          clearTimeout(this.mutationTimer)
          this.mutationTimer = undefined
          this.fireRun('mutation')
        },
        Math.max(0, MUTATION_MAX_WAIT_MS - elapsed)
      )
    }
  }

  private async run(reason: ConfigurationSyncReason): Promise<SyncStatus | null> {
    if (this.running) return this.running
    const userId = this.userId
    if (!userId) return null
    if (reason !== 'manual' && !this.isOnline()) {
      if (reason === 'mutation' || reason === 'retry') {
        this.clearMutationTimers()
        this.mutationWaiting = true
      }
      return null
    }
    const lifecycle = this.lifecycle

    const operation = this.perform(userId, lifecycle, reason)
    this.running = operation
    const clear = () => {
      if (this.running === operation) this.running = null
    }
    void operation.then(clear, clear)
    return operation
  }

  private async perform(
    userId: string,
    lifecycle: number,
    reason: ConfigurationSyncReason
  ): Promise<SyncStatus | null> {
    if (reason === 'activation') {
      const status = await this.dependencies.getStatus()
      if (!this.isCurrent(userId, lifecycle)) return null
      const now = this.now()
      const focusRecentlyAttempted = now - this.lastFocusAttemptAt < FOCUS_FRESHNESS_MS
      const recentlySynchronized = now - (status.lastSuccessAt ?? 0) < FOCUS_FRESHNESS_MS
      if (focusRecentlyAttempted || (status.pendingRecords === 0 && recentlySynchronized)) {
        return null
      }
      this.lastFocusAttemptAt = now
    }

    if (reason === 'mutation' || reason === 'retry') {
      this.clearMutationTimers()
      if (reason === 'mutation') this.mutationWaiting = false
    }
    if (reason !== 'retry') this.retryIndex = 0

    try {
      const status = await this.dependencies.synchronize(userId)
      if (!status || !this.isCurrent(userId, lifecycle)) return status
      this.retryIndex = 0
      this.deferredReconnect = false
      if (status.pendingRecords === 0) {
        if (!this.mutationTimer && !this.mutationDeadlineTimer) {
          this.mutationWaiting = false
          this.mutationStartedAt = null
        }
      } else if (this.windowActive) {
        this.scheduleRetry()
      }
      await Promise.resolve(this.onSynchronized?.(status)).catch(() => undefined)
      return status
    } catch (error) {
      if (!this.isCurrent(userId, lifecycle)) return null
      const status = await this.dependencies.getStatus().catch(() => null)
      if (!status?.enabled || status.activeUserId !== userId) {
        this.clearTimers()
      } else if (status.pendingRecords > 0 && this.windowActive && this.isOnline()) {
        this.mutationStartedAt ??= this.now()
        this.scheduleRetry()
      }
      throw error
    }
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    const delay = RETRY_DELAYS_MS[this.retryIndex]
    if (delay === undefined || !this.windowActive || !this.isOnline()) return
    this.retryIndex++
    const lifecycle = this.lifecycle
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      if (lifecycle === this.lifecycle && this.windowActive) this.fire('retry')
    }, delay)
  }

  private fire(reason: ConfigurationSyncReason): void {
    void this.request(reason).catch(() => undefined)
  }

  private fireRun(reason: ConfigurationSyncReason): void {
    void this.run(reason).catch(() => undefined)
  }

  private isCurrent(userId: string, lifecycle: number): boolean {
    return lifecycle === this.lifecycle && this.userId === userId
  }

  private clearMutationTimers(): void {
    clearTimeout(this.mutationTimer)
    clearTimeout(this.mutationDeadlineTimer)
    this.mutationTimer = undefined
    this.mutationDeadlineTimer = undefined
  }

  private clearTimers(): void {
    clearTimeout(this.focusTimer)
    clearTimeout(this.mutationTimer)
    clearTimeout(this.mutationDeadlineTimer)
    clearTimeout(this.retryTimer)
    this.focusTimer = undefined
    this.mutationTimer = undefined
    this.mutationDeadlineTimer = undefined
    this.retryTimer = undefined
  }
}

export const configurationSyncTiming = {
  mutationDebounceMs: MUTATION_DEBOUNCE_MS,
  mutationMaxWaitMs: MUTATION_MAX_WAIT_MS,
  focusSettleMs: FOCUS_SETTLE_MS,
  focusFreshnessMs: FOCUS_FRESHNESS_MS,
  retryDelaysMs: RETRY_DELAYS_MS,
} as const
