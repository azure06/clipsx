import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}))

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
    })
  })

  it('loads settings from the backend', async () => {
    mockInvoke.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, auto_start: true })

    await useSettingsStore.getState().loadSettings()

    expect(mockInvoke).toHaveBeenCalledWith('get_settings')
    expect(useSettingsStore.getState().settings?.auto_start).toBe(true)
    expect(useSettingsStore.getState().isLoading).toBe(false)
  })

  it('merges partial updates and persists the full payload', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, show_copy_toast: true } })
    mockInvoke.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, show_copy_toast: false })

    await useSettingsStore.getState().updateSettings({ show_copy_toast: false })

    expect(mockInvoke).toHaveBeenCalledWith('update_settings', {
      settings: expect.objectContaining({
        show_copy_toast: false,
        theme: DEFAULT_SETTINGS.theme,
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
    expect(useSettingsStore.getState().error).toContain('save failed')
  })
})
