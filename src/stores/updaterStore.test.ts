import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetVersion, mockInvoke, mockCheck } = vi.hoisted(() => ({
  mockGetVersion: vi.fn(),
  mockInvoke: vi.fn(),
  mockCheck: vi.fn(),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mockGetVersion,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}))

const loadStore = async () => {
  vi.resetModules()
  return await import('./updaterStore')
}

describe('useUpdaterStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks updater as unavailable when the build is not configured for updates', async () => {
    mockGetVersion.mockResolvedValueOnce('0.1.0')
    mockInvoke.mockResolvedValueOnce({ updaterConfigured: false })

    const { useUpdaterStore } = await loadStore()
    await useUpdaterStore.getState().initialize()

    expect(mockCheck).not.toHaveBeenCalled()
    expect(useUpdaterStore.getState().currentVersion).toBe('0.1.0')
    expect(useUpdaterStore.getState().status).toBe('unavailable')
  })

  it('checks silently on startup and stays idle when no update is available', async () => {
    mockGetVersion.mockResolvedValueOnce('0.1.0')
    mockInvoke.mockResolvedValueOnce({ updaterConfigured: true })
    mockCheck.mockResolvedValueOnce(null)

    const { useUpdaterStore } = await loadStore()
    await useUpdaterStore.getState().initialize()

    expect(mockCheck).toHaveBeenCalledTimes(1)
    expect(useUpdaterStore.getState().status).toBe('idle')
    expect(useUpdaterStore.getState().update).toBeNull()
  })

  it('stores the remote version when an update is available', async () => {
    mockCheck.mockResolvedValueOnce({
      currentVersion: '0.1.0',
      version: '0.1.1',
      date: '2026-06-19T00:00:00Z',
      body: 'Bug fixes',
      close: vi.fn().mockResolvedValue(undefined),
    })

    const { useUpdaterStore } = await loadStore()
    useUpdaterStore.setState({ updaterConfigured: true, status: 'idle' })

    const found = await useUpdaterStore.getState().checkForUpdates()

    expect(found).toBe(true)
    expect(useUpdaterStore.getState().status).toBe('available')
    expect(useUpdaterStore.getState().update).toEqual({
      currentVersion: '0.1.0',
      version: '0.1.1',
      date: '2026-06-19T00:00:00Z',
      body: 'Bug fixes',
    })
  })

  it('downloads and installs the available update then marks restart as required', async () => {
    type DownloadEventArg =
      | { event: 'Started'; data: { contentLength: number } }
      | { event: 'Progress'; data: { chunkLength: number } }
      | { event: 'Finished' }

    const close = vi.fn().mockResolvedValue(undefined)
    const downloadAndInstall = vi
      .fn()
      .mockImplementation((onEvent?: (event: DownloadEventArg) => void) => {
        onEvent?.({ event: 'Started', data: { contentLength: 100 } })
        onEvent?.({ event: 'Progress', data: { chunkLength: 40 } })
        onEvent?.({ event: 'Progress', data: { chunkLength: 60 } })
        return Promise.resolve()
      })

    mockCheck.mockResolvedValueOnce({
      currentVersion: '0.1.0',
      version: '0.1.1',
      date: undefined,
      body: undefined,
      downloadAndInstall,
      close,
    })

    const { useUpdaterStore } = await loadStore()
    useUpdaterStore.setState({ updaterConfigured: true, status: 'idle' })

    await useUpdaterStore.getState().checkForUpdates()
    const installed = await useUpdaterStore.getState().downloadAndInstallUpdate()

    expect(installed).toBe(true)
    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(useUpdaterStore.getState().downloadedBytes).toBe(100)
    expect(useUpdaterStore.getState().totalBytes).toBe(100)
    expect(useUpdaterStore.getState().status).toBe('downloaded')
    expect(useUpdaterStore.getState().updateReady).toBe(true)
  })

  it('captures updater errors for the UI', async () => {
    mockCheck.mockRejectedValueOnce(new Error('network down'))

    const { useUpdaterStore } = await loadStore()
    useUpdaterStore.setState({ updaterConfigured: true, status: 'idle' })

    const found = await useUpdaterStore.getState().checkForUpdates()

    expect(found).toBe(false)
    expect(useUpdaterStore.getState().status).toBe('error')
    expect(useUpdaterStore.getState().error).toContain('network down')
  })
})
