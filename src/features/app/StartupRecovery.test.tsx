import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupRecovery } from './StartupRecovery'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const status = {
  state: 'legacy_reset_required' as const,
  message: 'This profile uses the retired schema.',
  resetAvailable: true,
}

describe('StartupRecovery', () => {
  beforeEach(() => invokeMock.mockReset())

  it('requires the exact reset confirmation', () => {
    render(<StartupRecovery status={status} />)
    const button = screen.getByRole('button', { name: 'Reset local ClipsX data' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Type RESET CLIPSX/), {
      target: { value: 'reset clipsx' },
    })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Type RESET CLIPSX/), {
      target: { value: 'RESET CLIPSX' },
    })
    expect(button).toBeEnabled()
  })

  it('resets owned data and restarts after a complete reset', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'factory_reset') {
        return Promise.resolve({ deleted: ['clips.db'], failures: [], restartRequired: true })
      }
      return Promise.resolve(null)
    })
    render(<StartupRecovery status={status} />)
    fireEvent.change(screen.getByLabelText(/Type RESET CLIPSX/), {
      target: { value: 'RESET CLIPSX' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset local ClipsX data' }))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('factory_reset', { confirmation: 'RESET CLIPSX' })
      expect(invokeMock).toHaveBeenCalledWith('restart_app')
    })
  })

  it('reports partial reset failures and does not restart', async () => {
    invokeMock.mockResolvedValue({
      deleted: [],
      failures: ['clips.db: access denied'],
      restartRequired: true,
    })
    render(<StartupRecovery status={status} />)
    fireEvent.change(screen.getByLabelText(/Type RESET CLIPSX/), {
      target: { value: 'RESET CLIPSX' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset local ClipsX data' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('access denied')
    expect(invokeMock).not.toHaveBeenCalledWith('restart_app')
  })
})
