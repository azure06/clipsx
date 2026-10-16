import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import i18n from '../../i18n'
import { AboutAppInfo } from './AboutAppInfo'
import { Settings } from './Settings'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUpdaterStore } from '../../stores/updaterStore'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'
import type { ReleaseInfo } from '../../shared/types/updater'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../../shared/hooks/useTheme', () => ({ useTheme: () => ({ setThemeMode: vi.fn() }) }))
vi.mock('./DiagnosticsActions', () => ({ DiagnosticsActions: () => null }))
vi.mock('./components/PortableRecovery', () => ({ PortableRecovery: () => null }))

const info: ReleaseInfo = {
  updaterConfigured: true,
  version: '1.2.3',
  commit: 'abcdef0123456789abcdef0123456789abcdef01',
  modified: true,
  os: 'windows',
  architecture: 'x86_64',
  buildType: 'development',
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  invoke.mockReset()
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'get_release_info' ? info : undefined)
  )
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    isLoading: false,
    error: null,
    saveError: null,
    failedEffects: [],
  })
  useUpdaterStore.setState({
    initialize: vi.fn().mockResolvedValue(undefined),
    currentVersion: info.version,
    updaterConfigured: true,
    status: 'idle',
    error: null,
    update: null,
    updateReady: false,
    isChecking: false,
    isDownloading: false,
  })
})

describe('About app information', () => {
  it('shows native metadata and copies the full revision using the host clipboard', async () => {
    render(<AboutAppInfo />)
    expect(await screen.findByText('abcdef012345 (Locally modified)')).toHaveAttribute(
      'title',
      info.commit
    )
    expect(screen.getByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByText('windows')).toBeInTheDocument()
    expect(screen.getByText('x86_64')).toBeInTheDocument()
    expect(screen.getByText('Development')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy app info' }))
    expect(invoke).toHaveBeenCalledWith('execute_clipboard_output', {
      request: {
        disposition: 'copy',
        source: {
          kind: 'literal_text',
          text: `ClipsX 1.2.3\nCommit: ${info.commit}\nWorking tree: Locally modified\nOperating system: windows\nArchitecture: x86_64\nBuild type: Development`,
        },
      },
    })
    expect(await screen.findByRole('status')).toHaveTextContent('App information copied.')
  })

  it('supports missing Git and Japanese release labels', async () => {
    await i18n.changeLanguage('ja')
    invoke.mockResolvedValue({ ...info, commit: null, modified: null, buildType: 'release' })
    render(<AboutAppInfo />)
    expect(await screen.findByText('取得できません')).toBeInTheDocument()
    expect(screen.getByText('リリース版')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アプリ情報をコピー' })).toBeEnabled()
  })

  it('shows loading and retries metadata failures', async () => {
    invoke.mockRejectedValueOnce(new Error('offline'))
    render(<AboutAppInfo />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading app information')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load app information.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('1.2.3')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports clipboard failure and allows another attempt', async () => {
    render(<AboutAppInfo />)
    const copy = await screen.findByRole('button', { name: 'Copy app info' })
    invoke.mockRejectedValueOnce(new Error('clipboard busy'))
    await userEvent.click(copy)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy app information.')
    await userEvent.click(copy)
    expect(await screen.findByRole('status')).toHaveTextContent('App information copied.')
  })

  it('navigates to About by keyboard and keeps update failures separate from metadata', async () => {
    useUpdaterStore.setState({ status: 'error', error: 'network failed' })
    render(<Settings initialTab="general" />)
    screen.getByRole('button', { name: 'About' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('abcdef012345 (Locally modified)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument()
    )
  })

  it('preserves update check, install and restart actions', async () => {
    const check = vi.fn(),
      install = vi.fn(),
      restart = vi.fn()
    useUpdaterStore.setState({
      checkForUpdates: check,
      downloadAndInstallUpdate: install,
      restartToApplyUpdate: restart,
      update: { currentVersion: info.version, version: '1.2.4', date: null, body: null },
    })
    render(<Settings initialTab="about" />)
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Install update' }))
    expect(check).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledOnce()
    useUpdaterStore.setState({ updateReady: true })
    await userEvent.click(await screen.findByRole('button', { name: 'Restart now' }))
    expect(restart).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument()
  })

  it('disables update actions while checking or installing', async () => {
    useUpdaterStore.setState({
      status: 'checking',
      isChecking: true,
      isDownloading: true,
      update: { currentVersion: info.version, version: '1.2.4', date: null, body: null },
    })
    render(<Settings initialTab="about" />)
    expect(await screen.findByText('abcdef012345 (Locally modified)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Install update' })).toBeDisabled()
  })
})
