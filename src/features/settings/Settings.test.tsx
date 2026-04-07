import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Settings } from './Settings'

// ---------------------------------------------------------------------------
// Tauri / plugin mocks — use vi.hoisted so refs are available before hoisting
// ---------------------------------------------------------------------------

const { mockInvoke, mockEnable, mockDisable, mockUpdateSettings, mockLoadSettings } = vi.hoisted(
  () => ({
    mockInvoke: vi.fn(),
    mockEnable: vi.fn(),
    mockDisable: vi.fn(),
    mockUpdateSettings: vi.fn(),
    mockLoadSettings: vi.fn(),
  })
)

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))
vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: mockEnable,
  disable: mockDisable,
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  }),
}))

// ---------------------------------------------------------------------------
// Settings store mock — lets each test inject its own settings snapshot
// ---------------------------------------------------------------------------

import type { AppSettings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'

vi.mock('../../stores', async importOriginal => {
  const actual = await importOriginal<typeof import('../../stores')>()
  return {
    ...actual,
    useSettingsStore: (selector?: (s: unknown) => unknown) => {
      const state = {
        settings: mockSettings(),
        isLoading: false,
        error: null,
        loadSettings: mockLoadSettings,
        updateSettings: mockUpdateSettings,
      }
      return selector ? selector(state) : state
    },
    useClipboardStore: (selector?: (s: unknown) => unknown) => {
      const state = { clearAllClips: vi.fn() }
      return selector ? selector(state) : state
    },
  }
})

vi.mock('../../shared/hooks/useTheme', () => ({
  useTheme: () => ({ setThemeMode: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _settings: AppSettings = { ...DEFAULT_SETTINGS }

/** Override specific fields for a test */
function withSettings(overrides: Partial<AppSettings>) {
  _settings = { ...DEFAULT_SETTINGS, ...overrides }
}

function mockSettings() {
  return _settings
}

function renderSettings() {
  return render(<Settings />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings — Auto-start toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ...DEFAULT_SETTINGS })
    mockUpdateSettings.mockResolvedValue(undefined)
    mockLoadSettings.mockResolvedValue(undefined)
  })

  /** Find the switch that sits next to a given label text in the Advanced tab. */
  async function getAdvancedSwitch(labelText: RegExp) {
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
    // SettingRow renders the label as a <label> element; the switch follows it
    const label = await screen.findByText(labelText)
    // The Radix Switch root is the next sibling container's button
    const row = label.closest('[class*="flex items-start"]') as HTMLElement
    return row.querySelector('[role="switch"]') as HTMLElement
  }

  it('calls enable() when toggled on', async () => {
    withSettings({ auto_start: false })
    renderSettings()

    const toggle = await getAdvancedSwitch(/auto-start on login/i)
    fireEvent.click(toggle)

    await waitFor(() => expect(mockEnable).toHaveBeenCalledTimes(1))
    expect(mockDisable).not.toHaveBeenCalled()
    expect(mockUpdateSettings).toHaveBeenCalledWith({ auto_start: true })
  })

  it('calls disable() when toggled off', async () => {
    withSettings({ auto_start: true })
    renderSettings()

    const toggle = await getAdvancedSwitch(/auto-start on login/i)
    fireEvent.click(toggle)

    await waitFor(() => expect(mockDisable).toHaveBeenCalledTimes(1))
    expect(mockEnable).not.toHaveBeenCalled()
    expect(mockUpdateSettings).toHaveBeenCalledWith({ auto_start: false })
  })
})

describe('Settings — Storage tab: max_clips ButtonGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ...DEFAULT_SETTINGS })
    mockUpdateSettings.mockResolvedValue(undefined)
    mockLoadSettings.mockResolvedValue(undefined)
  })

  it('highlights the active max_clips preset', () => {
    withSettings({ max_clips: 500 })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /storage/i }))

    // The "500" button should have the primary (active) variant class
    const btn500 = screen.getByRole('button', { name: /^500$/ })
    expect(btn500.className).toMatch(/from-blue-500/)
  })

  it('calls updateSettings with the selected preset value', async () => {
    withSettings({ max_clips: 100 })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /storage/i }))
    fireEvent.click(screen.getByRole('button', { name: /^1,000$/ }))

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ max_clips: 1000 }))
  })

  it('calls updateSettings with 0 for Unlimited', async () => {
    withSettings({ max_clips: 500 })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /storage/i }))
    fireEvent.click(screen.getByRole('button', { name: /unlimited/i }))

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ max_clips: 0 }))
  })
})

describe('Settings — Show Copy Toast toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ...DEFAULT_SETTINGS })
    mockUpdateSettings.mockResolvedValue(undefined)
    mockLoadSettings.mockResolvedValue(undefined)
  })

  it('calls updateSettings({ show_copy_toast: false }) when toggled off', async () => {
    withSettings({ show_copy_toast: true })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))

    const label = await screen.findByText(/show copy toast/i)
    const row = label.closest('[class*="flex items-start"]') as HTMLElement
    const toggle = row.querySelector('[role="switch"]') as HTMLElement
    fireEvent.click(toggle)

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ show_copy_toast: false }))
  })

  it('calls updateSettings({ show_copy_toast: true }) when toggled on', async () => {
    withSettings({ show_copy_toast: false })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))

    const label = await screen.findByText(/show copy toast/i)
    const row = label.closest('[class*="flex items-start"]') as HTMLElement
    const toggle = row.querySelector('[role="switch"]') as HTMLElement
    fireEvent.click(toggle)

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ show_copy_toast: true }))
  })
})
