import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}))

const v2Settings = (overrides: Record<string, unknown> = {}) => ({
  theme: 'system',
  language: 'en',
  languageInitialized: true,
  activationMode: 'double_click_primary',
  defaultOutputFormat: 'original',
  pasteOnEnter: false,
  hideOnCopy: false,
  hideOnBlur: false,
  alwaysOnTop: false,
  showCopyToast: true,
  globalShortcut: 'Ctrl+Shift+V',
  excludedApps: [],
  autoClearMinutes: null,
  clearOnExit: false,
  autoStart: false,
  loggingEnabled: true,
  captureFilters: { images: true, files: true, richText: true, officeAndDocuments: true },
  capture: {
    maxOrdinaryClips: 1000,
    maxAgeDays: null,
    maxRepresentationBytes: 52_428_800,
  },
  ...overrides,
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settings: null,
      isLoading: false,
      error: null,
      failedEffects: [],
      saveError: null,
      resetSettings: useSettingsStore.getState().resetSettings,
    })
  })

  it('loads settings from the backend', async () => {
    mockInvoke.mockResolvedValueOnce(v2Settings({ autoStart: true })).mockResolvedValueOnce([])

    await useSettingsStore.getState().loadSettings()

    expect(mockInvoke).toHaveBeenCalledWith('get_app_settings')
    expect(useSettingsStore.getState().settings?.auto_start).toBe(true)
    expect(useSettingsStore.getState().isLoading).toBe(false)
  })

  it('sends only changed fields to avoid overwriting newer host settings', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, show_copy_toast: true } })
    mockInvoke.mockResolvedValueOnce({
      settings: v2Settings({ showCopyToast: false }),
      failedEffects: [],
    })

    await useSettingsStore.getState().updateSettings({ show_copy_toast: false })

    expect(mockInvoke).toHaveBeenCalledWith('update_app_settings', {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      settings: expect.objectContaining({
        showCopyToast: false,
      }),
    })
    expect(useSettingsStore.getState().settings?.show_copy_toast).toBe(false)
  })

  it('retains committed values and reports failed saves', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, auto_start: false } })
    mockInvoke.mockRejectedValueOnce(new Error('save failed'))

    await expect(useSettingsStore.getState().updateSettings({ auto_start: true })).rejects.toThrow(
      'save failed'
    )

    expect(useSettingsStore.getState().settings?.auto_start).toBe(false)
    expect(useSettingsStore.getState().saveError).toContain('save failed')
  })

  it('resets settings through backend defaults', async () => {
    mockInvoke.mockResolvedValueOnce({ settings: v2Settings(), failedEffects: [] })

    await useSettingsStore.getState().resetSettings()

    expect(mockInvoke).toHaveBeenCalledWith('reset_app_settings', undefined)
    expect(useSettingsStore.getState().settings?.global_shortcut).toBe('Ctrl+Shift+V')
    expect(useSettingsStore.getState().isLoading).toBe(false)
  })

  it('uses copy-only double-click behavior as the frontend defaults', () => {
    expect(DEFAULT_SETTINGS.item_activation_mode).toBe('double_click_primary')
    expect(DEFAULT_SETTINGS.paste_on_enter).toBe(false)
    expect(DEFAULT_SETTINGS.hide_on_copy).toBe(false)
    expect(DEFAULT_SETTINGS.hide_on_blur).toBe(false)
  })
  it('serializes rapid edits without losing successful changes after a failure', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    mockInvoke
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({ settings: v2Settings({ loggingEnabled: false }), failedEffects: [] })
    const first = useSettingsStore.getState().updateSettings({ theme: 'dark' })
    const second = useSettingsStore.getState().updateSettings({ logging_enabled: false })
    await expect(first).rejects.toThrow('disk full')
    await second
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'update_app_settings', {
      settings: { loggingEnabled: false },
    })
    expect(useSettingsStore.getState().settings?.theme).toBe('auto')
    expect(useSettingsStore.getState().settings?.logging_enabled).toBe(false)
  })

  it('keeps saved values when native effects fail and exposes retry', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    mockInvoke
      .mockResolvedValueOnce({
        settings: v2Settings({ autoStart: true }),
        failedEffects: ['autostart'],
      })
      .mockResolvedValueOnce({ settings: v2Settings({ autoStart: true }), failedEffects: [] })
    await useSettingsStore.getState().updateSettings({ auto_start: true })
    expect(useSettingsStore.getState().settings?.auto_start).toBe(true)
    expect(useSettingsStore.getState().failedEffects).toEqual(['autostart'])
    await useSettingsStore.getState().retryEffects()
    expect(useSettingsStore.getState().failedEffects).toEqual([])
  })

  it('uses host-owned import and export and refreshes imported settings', async () => {
    mockInvoke
      .mockResolvedValueOnce('portable-document')
      .mockResolvedValueOnce({ settings: v2Settings({ theme: 'dark' }), failedEffects: [] })
    expect(await useSettingsStore.getState().exportSettings()).toBe('portable-document')
    await useSettingsStore.getState().importSettings('portable-document')
    expect(mockInvoke).toHaveBeenLastCalledWith('import_portable_settings', {
      document: 'portable-document',
    })
    expect(useSettingsStore.getState().settings?.theme).toBe('dark')
  })

  it('does not resend rounded or hidden capture limits during an unrelated edit', async () => {
    mockInvoke
      .mockResolvedValueOnce(
        v2Settings({
          capture: {
            maxOrdinaryClips: 37,
            maxRepresentationBytes: 1234567,
            maxManagedBytes: 987654321,
            maxSnapshotBytes: 12345678,
          },
        })
      )
      .mockResolvedValueOnce([])
    await useSettingsStore.getState().loadSettings()
    mockInvoke.mockResolvedValueOnce({ settings: v2Settings({ theme: 'dark' }), failedEffects: [] })
    await useSettingsStore.getState().updateSettings({ theme: 'dark' })
    expect(mockInvoke).toHaveBeenLastCalledWith('update_app_settings', {
      settings: { theme: 'dark' },
    })
  })
})
