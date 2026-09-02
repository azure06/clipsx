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
      resetSettings: useSettingsStore.getState().resetSettings,
    })
  })

  it('loads settings from the backend', async () => {
    mockInvoke.mockResolvedValueOnce(v2Settings({ autoStart: true }))

    await useSettingsStore.getState().loadSettings()

    expect(mockInvoke).toHaveBeenCalledWith('get_app_settings')
    expect(useSettingsStore.getState().settings?.auto_start).toBe(true)
    expect(useSettingsStore.getState().isLoading).toBe(false)
  })

  it('merges partial updates and persists the full payload', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, show_copy_toast: true } })
    mockInvoke.mockResolvedValueOnce(v2Settings({ showCopyToast: false }))

    await useSettingsStore.getState().updateSettings({ show_copy_toast: false })

    expect(mockInvoke).toHaveBeenCalledWith('update_app_settings', {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      settings: expect.objectContaining({
        showCopyToast: false,
        theme: 'system',
      }),
    })
    expect(useSettingsStore.getState().settings?.show_copy_toast).toBe(false)
  })

  it('rolls back optimistic updates when persistence fails', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, auto_start: false } })
    mockInvoke.mockRejectedValueOnce(new Error('save failed'))

    await expect(useSettingsStore.getState().updateSettings({ auto_start: true })).rejects.toThrow(
      'save failed'
    )

    expect(useSettingsStore.getState().settings?.auto_start).toBe(false)
    expect(useSettingsStore.getState().error).toBeNull()
  })

  it('resets settings through backend defaults', async () => {
    mockInvoke.mockResolvedValueOnce(v2Settings())

    await useSettingsStore.getState().resetSettings()

    expect(mockInvoke).toHaveBeenCalledWith('update_app_settings', {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      settings: expect.objectContaining({
        globalShortcut: DEFAULT_SETTINGS.global_shortcut,
        activationMode: 'double_click_primary',
        pasteOnEnter: false,
        hideOnCopy: false,
        hideOnBlur: false,
      }),
    })
    expect(useSettingsStore.getState().settings?.global_shortcut).toBe('Ctrl+Shift+V')
    expect(useSettingsStore.getState().isLoading).toBe(false)
  })

  it('uses copy-only double-click behavior as the frontend defaults', () => {
    expect(DEFAULT_SETTINGS.item_activation_mode).toBe('double_click_primary')
    expect(DEFAULT_SETTINGS.paste_on_enter).toBe(false)
    expect(DEFAULT_SETTINGS.hide_on_copy).toBe(false)
    expect(DEFAULT_SETTINGS.hide_on_blur).toBe(false)
  })
})
