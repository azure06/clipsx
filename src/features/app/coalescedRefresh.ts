// Bound progress-driven IPC work to one active refresh and one trailing refresh.
export const createCoalescedRefresh = (refresh: () => Promise<void>, intervalMs = 500) => {
  let disposed = false
  let running = false
  let pending = false
  let lastStarted = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined

  const drain = () => {
    if (disposed || running || !pending || timer !== undefined) return
    const delay = Math.max(0, intervalMs - (Date.now() - lastStarted))
    if (delay > 0) {
      timer = setTimeout(() => {
        timer = undefined
        drain()
      }, delay)
      return
    }
    pending = false
    running = true
    lastStarted = Date.now()
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        running = false
        drain()
      })
  }

  return {
    request: () => {
      pending = true
      drain()
    },
    dispose: () => {
      disposed = true
      clearTimeout(timer)
    },
  }
}
