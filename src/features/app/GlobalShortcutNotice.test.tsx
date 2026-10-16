import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { GlobalShortcutNotice } from './GlobalShortcutNotice'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('global shortcut registration notice', () => {
  beforeEach(() => useSettingsStore.setState({ failedEffects: [] }))

  it('shows registration failures outside Settings and opens recovery', async () => {
    useSettingsStore.setState({ failedEffects: ['shortcut'] })
    const onOpenSettings = vi.fn()
    render(<GlobalShortcutNotice onOpenSettings={onOpenSettings} />)
    expect(screen.getByRole('alert')).toHaveTextContent('settings.effectRecovery.shortcut')
    await userEvent.click(screen.getByRole('button', { name: 'settings.shortcutSettings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    act(() => useSettingsStore.setState({ failedEffects: [] }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays hidden when shortcut registration succeeds', () => {
    useSettingsStore.setState({ failedEffects: ['autostart'] })
    render(<GlobalShortcutNotice onOpenSettings={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
