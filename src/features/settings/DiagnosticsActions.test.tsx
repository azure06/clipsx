import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsActions } from './DiagnosticsActions'

const { invoke, open, save } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open, save }))

describe('diagnostic report consent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'get_diagnostics_summary'
          ? { sentryConfigured: true, errorReportingEnabled: false }
          : null
      )
    )
  })

  it('does not upload on discovery, review or cancelled selection', async () => {
    render(<DiagnosticsActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Review report' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_diagnostics_summary'))
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled()
    open.mockResolvedValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Select crash report' }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(invoke.mock.calls.some(([command]) => command === 'send_diagnostic_report')).toBe(false)
  })

  it('sends only after consent and requires renewed consent when contents change', async () => {
    render(<DiagnosticsActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Review report' }))
    await waitFor(() =>
      expect(screen.getByText(/Automatic sanitized error reporting is off/)).toBeInTheDocument()
    )
    const consent = screen.getByRole('checkbox', { name: /I consent/ })
    fireEvent.click(consent)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include local operational logs' }))
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled()
    fireEvent.click(consent)
    invoke.mockImplementation((command: string) =>
      command === 'send_diagnostic_report'
        ? Promise.reject(new Error('offline; retained'))
        : Promise.resolve(null)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('send_diagnostic_report', {
        consent: true,
        includeLogs: true,
        selected: null,
      })
    )
    expect(await screen.findByRole('status')).toHaveTextContent('offline; retained')
  })

  it('exports without relying on app storage and does not label acceptance as processing success', async () => {
    save.mockResolvedValue('/tmp/diagnostics.zip')
    render(<DiagnosticsActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Export diagnostics' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('export_diagnostic_bundle', {
        path: '/tmp/diagnostics.zip',
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review report' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /I consent/ }))
    invoke.mockResolvedValue({ eventId: 'abc123', status: 'accepted' })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText(/Processing has not yet been confirmed/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /I consent/ })).not.toBeChecked()
  })
})
