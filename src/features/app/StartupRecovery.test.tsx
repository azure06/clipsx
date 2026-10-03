import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { StartupRecovery } from './StartupRecovery'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../settings/DiagnosticsActions', () => ({
  DiagnosticsActions: () => <div>Diagnostics available</div>,
}))

const status = {
  state: 'legacy_reset_required' as const,
  message: 'This profile uses the retired schema.',
  resetAvailable: true,
}

describe('StartupRecovery', () => {
  it('preserves newer databases without offering a reset', () => {
    render(
      <StartupRecovery
        status={{ state: 'newer_schema', message: '', migrationVersion: 16, resetAvailable: false }}
      />
    )
    expect(screen.getByText(/requires a newer ClipsX/)).toBeInTheDocument()
    expect(screen.getByText('Diagnostics available')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Show factory reset option' })
    ).not.toBeInTheDocument()
  })
  beforeEach(() => invokeMock.mockReset())
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('updates Japanese labels live while keeping the reset confirmation exact', async () => {
    render(<StartupRecovery status={status} />)
    expect(
      screen.queryByRole('button', { name: 'Reset local ClipsX data' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show factory reset option' }))
    expect(screen.getByRole('button', { name: 'Reset local ClipsX data' })).toBeDisabled()
    await act(async () => {
      await i18n.changeLanguage('ja')
    })
    expect(
      screen.getByRole('heading', { name: 'ClipsXを起動できませんでした' })
    ).toBeInTheDocument()
    const button = screen.getByRole('button', { name: i18n.t('desktopUi.resetLocalClipsxData') })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/RESET CLIPSX/), { target: { value: 'RESET CLIPSX' } })
    expect(button).toBeEnabled()
  })

  it('requires the exact reset confirmation', () => {
    render(<StartupRecovery status={status} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show factory reset option' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Show factory reset option' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Show factory reset option' }))
    fireEvent.change(screen.getByLabelText(/Type RESET CLIPSX/), {
      target: { value: 'RESET CLIPSX' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset local ClipsX data' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('access denied')
    expect(invokeMock).not.toHaveBeenCalledWith('restart_app')
  })
})
