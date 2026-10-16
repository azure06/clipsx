import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Settings, ShortcutRecorder } from './Settings'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUpdaterStore } from '../../stores/updaterStore'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue([]) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { t: (key: string) => key, resolvedLanguage: 'en' },
  }),
}))
vi.mock('../../shared/hooks/useTheme', () => ({ useTheme: () => ({ setThemeMode: vi.fn() }) }))

describe('global shortcut recorder', () => {
  it('clears an existing shortcut using the keyboard and shows the disabled state', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<ShortcutRecorder value="Ctrl+Alt+V" onChange={onChange} />)
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'settings.clearShortcut' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('')
    rerender(<ShortcutRecorder value="" onChange={onChange} />)
    expect(screen.getByText('settings.shortcutDisabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.clearShortcut' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'settings.shortcutAria' })).toHaveFocus()
  })

  it('can record a shortcut after disabling it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ShortcutRecorder value="" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'settings.shortcutAria' }))
    await user.keyboard('{Control>}{Alt>}v{/Alt}{/Control}')
    expect(onChange).toHaveBeenCalledWith('Ctrl+Alt+V')
  })

  it('cancels recording with Escape or Tab without changing the saved shortcut', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ShortcutRecorder value="Ctrl+Alt+V" onChange={onChange} />)
    const recorder = screen.getByRole('button', { name: 'settings.shortcutAria' })
    await user.click(recorder)
    await user.keyboard('{Escape}')
    expect(recorder).toHaveAttribute('aria-pressed', 'false')
    expect(recorder).toHaveFocus()
    await user.click(recorder)
    await user.tab()
    expect(screen.getByRole('button', { name: 'settings.clearShortcut' })).toHaveFocus()
    expect(recorder).toHaveAttribute('aria-pressed', 'false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a failed clear in Keyboard settings and retains the saved shortcut', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      isLoading: false,
      failedEffects: [],
      saveError: null,
      error: null,
    })
    useUpdaterStore.setState({ initialize: vi.fn().mockResolvedValue(undefined) })
    invoke.mockImplementation((command: string) =>
      command === 'update_app_settings'
        ? Promise.reject(new Error('Could not remove shortcut'))
        : Promise.resolve([])
    )
    render(<Settings initialTab="keyboard" />)
    await userEvent.click(screen.getByRole('button', { name: 'settings.clearShortcut' }))
    expect(await screen.findByText(/settings.shortcutChangeFailed/)).toHaveTextContent(
      'Could not remove shortcut'
    )
    expect(useSettingsStore.getState().settings?.global_shortcut).toBe(
      DEFAULT_SETTINGS.global_shortcut
    )
    expect(screen.getByRole('button', { name: 'settings.clearShortcut' })).toBeEnabled()
  })
})
