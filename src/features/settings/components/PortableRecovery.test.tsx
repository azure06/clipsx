import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PortableRecovery } from './PortableRecovery'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('portable recovery', () => {
  beforeEach(() => invoke.mockReset())

  it('shows pending packages without requiring an account and retries explicitly', async () => {
    invoke.mockResolvedValueOnce([
      {
        id: 'extension_intent/example.package',
        key: 'example.package',
        kind: 'extension_intent',
        reason: 'Install this package from Extensions',
        quarantined: false,
      },
    ])
    render(<PortableRecovery />)
    expect(await screen.findByText(/example.package/)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('sync_recovery', { action: 'list', id: null })
    invoke.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'settings.retryEffects' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('sync_recovery', { action: 'retry_effects', id: null })
    )
    await waitFor(() => expect(screen.queryByText(/example.package/)).not.toBeInTheDocument())
  })

  it('keeps recovery accessible after a failed status request', async () => {
    invoke.mockRejectedValueOnce(new Error('database unavailable'))
    render(<PortableRecovery />)
    expect(await screen.findByRole('alert')).toHaveTextContent('settings.retryFailed')
    expect(screen.getByRole('button', { name: 'settings.retryEffects' })).toBeEnabled()
  })
})
