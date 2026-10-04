import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsActions } from './DiagnosticsActions'
import { StartupRecovery } from '../app/StartupRecovery'

const { invoke, open, save, copy, platform } = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  copy: vi.fn(),
  platform: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open, save }))
vi.mock('../../shared/clipboardOutput', () => ({ executeClipboardOutput: copy }))
vi.mock('../../shared/keyboard/shortcuts', () => ({ getPlatform: platform }))

const report = { path: '/Library/Logs/ClipsX-old.ips', sha256: 'abc', text: '{"exception":"test"}' }
const summary = { supportCode: 'SUPPORT123', sentryConfigured: true }
const preferences = { error_reporting_enabled: false, verbose_logging_enabled: false }
const sendButton = () => screen.getByRole('button', { name: 'Send report' })
const consentBox = () => screen.getByRole('checkbox', { name: /I consent/ })
async function prepare() {
  const button = screen.getByRole('button', { name: 'Prepare report…' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Review report' })).toHaveFocus())
}
async function tools() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'More tools' }))
  return user
}

describe('diagnostics review and local tools', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    platform.mockReturnValue('macos')
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'get_diagnostics_summary' ? summary : null)
    )
  })

  it('shows quiet discovery without opening review or uploading, and hides full paths until preview', async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'get_diagnostics_summary' ? summary : report)
    )
    render(<DiagnosticsActions />)
    expect(await screen.findByText('Crash report available: ClipsX-old.ips')).toBeInTheDocument()
    expect(screen.queryByText(report.path)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review report' })).not.toBeInTheDocument()
    await prepare()
    expect(screen.getByText('Crash reports may contain local file paths.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Preview crash report'))
    expect(screen.getByLabelText('Crash report preview')).toHaveTextContent(report.text)
    expect(sendButton()).toBeDisabled()
    expect(invoke.mock.calls.some(([command]) => command === 'send_diagnostic_report')).toBe(false)
  })

  it('allows a report without crash attachments and resets consent when logs change or review closes', async () => {
    render(<DiagnosticsActions />)
    await prepare()
    const logs = screen.getByRole('checkbox', { name: 'Include local operational logs' })
    expect(logs).not.toBeChecked()
    expect(sendButton()).toBeDisabled()
    fireEvent.click(consentBox())
    expect(sendButton()).toBeEnabled()
    fireEvent.click(logs)
    expect(sendButton()).toBeDisabled()
    fireEvent.click(consentBox())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Prepare report…' })).toHaveFocus()
    await prepare()
    expect(consentBox()).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'Include local operational logs' })
    ).not.toBeChecked()
  })

  it('removes attachments and requires new consent before sending', async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'get_diagnostics_summary'
          ? summary
          : command === 'get_crash_report'
            ? report
            : { eventId: 'event123', status: 'accepted' }
      )
    )
    render(<DiagnosticsActions />)
    await prepare()
    fireEvent.click(consentBox())
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
    expect(consentBox()).not.toBeChecked()
    expect(screen.queryByText(/Crash report available/)).not.toBeInTheDocument()
    fireEvent.click(consentBox())
    fireEvent.click(sendButton())
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('send_diagnostic_report', {
        consent: true,
        includeLogs: false,
        selected: null,
      })
    )
    expect(await screen.findByText(/Report submitted. Report ID: event123/)).toHaveTextContent(
      'Processing has not yet been confirmed.'
    )
    expect(consentBox()).not.toBeChecked()
  })

  it('locks contents during upload, prevents duplicates and preserves files on failure', async () => {
    let rejectUpload!: (reason: Error) => void
    invoke.mockImplementation((command: string) => {
      if (command === 'send_diagnostic_report')
        return new Promise((_, reject) => {
          rejectUpload = reject
        })
      return Promise.resolve(command === 'get_diagnostics_summary' ? summary : report)
    })
    render(<DiagnosticsActions />)
    await prepare()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include local operational logs' }))
    fireEvent.click(consentBox())
    fireEvent.click(sendButton())
    fireEvent.click(sendButton())
    expect(consentBox()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove attachment' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'More tools' })).toBeDisabled()
    expect(
      invoke.mock.calls.filter(([command]) => command === 'send_diagnostic_report')
    ).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('send_diagnostic_report', {
      consent: true,
      includeLogs: true,
      selected: { path: report.path, sha256: report.sha256 },
    })
    act(() => {
      rejectUpload(new Error('Upload failed; local files retained'))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('local files retained')
    expect(screen.getByText('Crash report available: ClipsX-old.ips')).toBeInTheDocument()
    expect(sendButton()).toBeEnabled()
  })

  it('waits for crash discovery before opening review so late attachments cannot bypass consent', async () => {
    let finishDiscovery!: (value: typeof report) => void
    invoke.mockImplementation((command: string) =>
      command === 'get_crash_report'
        ? new Promise(resolve => {
            finishDiscovery = resolve
          })
        : Promise.resolve(summary)
    )
    render(<DiagnosticsActions />)
    expect(screen.getByRole('button', { name: 'Prepare report…' })).toBeDisabled()
    await act(async () => {
      finishDiscovery(report)
      await Promise.resolve()
    })
    await prepare()
    expect(screen.getByText('Crash report: ClipsX-old.ips')).toBeInTheDocument()
    expect(consentBox()).not.toBeChecked()
    expect(sendButton()).toBeDisabled()
  })

  it('keeps the reviewed attachment when a selected crash file is rejected', async () => {
    invoke.mockImplementation((command: string, args?: { path?: string | null }) => {
      if (command === 'get_crash_report' && args?.path)
        return Promise.reject(new Error('This is not a ClipsX crash report'))
      return Promise.resolve(command === 'get_diagnostics_summary' ? summary : report)
    })
    open.mockResolvedValue('/tmp/invalid.ips')
    render(<DiagnosticsActions />)
    await prepare()
    const user = await tools()
    await user.click(screen.getByRole('menuitem', { name: 'Choose crash report…' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not a ClipsX crash report')
    expect(screen.getByText('Crash report available: ClipsX-old.ips')).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
  })

  it('handles canceled and successful crash selection without uploading', async () => {
    render(<DiagnosticsActions />)
    await prepare()
    fireEvent.click(consentBox())
    open.mockResolvedValue(null)
    let user = await tools()
    await user.click(screen.getByRole('menuitem', { name: 'Choose crash report…' }))
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    expect(consentBox()).toBeChecked()
    open.mockResolvedValue(report.path)
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'get_crash_report' ? report : summary)
    )
    user = await tools()
    await user.click(screen.getByRole('menuitem', { name: 'Choose crash report…' }))
    expect(await screen.findByText('Crash report available: ClipsX-old.ips')).toBeInTheDocument()
    expect(consentBox()).not.toBeChecked()
    expect(invoke.mock.calls.some(([command]) => command === 'send_diagnostic_report')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Review report' })).toHaveFocus()
  })

  it('keeps local saving available when submission is unavailable and export ignores upload options', async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'get_diagnostics_summary' ? { ...summary, sentryConfigured: false } : null
      )
    )
    save.mockResolvedValue('/tmp/diagnostics.zip')
    render(<DiagnosticsActions />)
    await prepare()
    expect(screen.getByText(/Sending reports is unavailable in this build/)).toBeInTheDocument()
    fireEvent.click(consentBox())
    expect(sendButton()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save diagnostics…' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('export_diagnostic_bundle', {
        path: '/tmp/diagnostics.zip',
      })
    )
    expect(await screen.findByText('Diagnostics saved.')).toBeInTheDocument()
  })

  it('supports canceled local saving, log-folder opening and macOS crash-file saving', async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'get_diagnostics_summary'
          ? summary
          : command === 'get_crash_report'
            ? report
            : null
      )
    )
    save.mockResolvedValue(null)
    render(<DiagnosticsActions />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Prepare report…' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save diagnostics…' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(invoke.mock.calls.some(([command]) => command === 'export_diagnostic_bundle')).toBe(
      false
    )
    let user = await tools()
    await user.click(screen.getByRole('menuitem', { name: 'Open log folder' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('open_diagnostics_log_folder'))
    save.mockResolvedValue('/tmp/ClipsX.ips')
    user = await tools()
    await user.click(screen.getByRole('menuitem', { name: 'Save crash report…' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('export_crash_report', {
        selected: { path: report.path, sha256: report.sha256 },
        destination: '/tmp/ClipsX.ips',
      })
    )
  })

  it('hides macOS selection on other platforms and provides keyboard menu operation', async () => {
    platform.mockReturnValue('windows')
    render(<DiagnosticsActions />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Prepare report…' })).toBeEnabled()
    )
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'More tools' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('menuitem', { name: 'Choose crash report…' })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('open_diagnostics_log_folder'))
    expect(screen.getByRole('button', { name: 'More tools' })).toHaveFocus()
  })

  it('shares one summary request with preferences and copies the support code with confirmation', async () => {
    const onChange = vi.fn()
    render(<DiagnosticsActions preferences={preferences} onPreferencesChange={onChange} />)
    expect(await screen.findByText('SUPPORT123')).toBeInTheDocument()
    expect(
      invoke.mock.calls.filter(([command]) => command === 'get_diagnostics_summary')
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic error reporting' }))
    expect(onChange).toHaveBeenCalledWith({ error_reporting_enabled: true })
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(await screen.findByText('Support code copied.')).toBeInTheDocument()
    expect(copy).toHaveBeenCalledWith('copy', { kind: 'literal_text', text: 'SUPPORT123' })
  })

  it('reports loading failures but keeps recovery diagnostics available without settings or storage', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'get_diagnostics_summary'
        ? Promise.reject(new Error('storage unavailable'))
        : Promise.resolve(null)
    )
    render(
      <StartupRecovery
        status={{ state: 'startup_failed', message: 'storage unavailable', resetAvailable: false }}
      />
    )
    await prepare()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load diagnostic information'
    )
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save diagnostics…' })).toBeEnabled()
    expect(sendButton()).toBeDisabled()
  })
})
