import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigurationSync } from './ConfigurationSync'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  connect: vi.fn(),
  clear: vi.fn(),
  pause: vi.fn(),
  manual: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))
vi.mock('../../../stores', () => ({
  useSettingsStore: { getState: () => ({ loadSettings: vi.fn().mockResolvedValue(undefined) }) },
}))
vi.mock('../../../shared/auth/supabaseAuth', () => ({
  listSyncDevices: vi.fn().mockResolvedValue([]),
  revokeSyncDevice: vi.fn(),
}))
vi.mock('../../../shared/sync/configSync', () => ({
  getSyncStatus: mocks.status,
  connectConfigurationSync: mocks.connect,
  clearCloudConfiguration: mocks.clear,
  setSyncEnabled: mocks.pause,
  configurationSyncScheduler: { request: mocks.manual },
  SYNC_APPLIED_EVENT: 'clipsx:sync-applied',
}))

describe('ConfigurationSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({
      activeUserId: 'user-1',
      enabled: true,
      generation: 1,
      pendingRecords: 0,
      quarantinedRecords: 0,
      pendingEffects: 0,
      lastSuccessAt: null,
      lastError: null,
    })
  })

  it('routes signed-out users to Account without showing another account’s status', async () => {
    const user = userEvent.setup()
    const onOpenAccount = vi.fn()
    mocks.status.mockResolvedValue({
      activeUserId: 'other-user',
      enabled: true,
      lastError: 'Private error',
    })
    render(<ConfigurationSync userId={null} onOpenAccount={onOpenAccount} />)
    await user.click(screen.getByRole('button', { name: 'Go to Account' }))
    expect(onOpenAccount).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Not connected')
    expect(screen.queryByText('Private error')).not.toBeInTheDocument()
    expect(screen.queryByText('Advanced sync options')).not.toBeInTheDocument()
  })

  it('keeps manual sync and pause connected to their existing actions', async () => {
    const user = userEvent.setup()
    render(<ConfigurationSync userId="user-1" onOpenAccount={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(mocks.manual).toHaveBeenCalledWith('manual'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(mocks.pause).toHaveBeenCalledWith('user-1', false)
  })

  it('requires confirmation before replacing or clearing cloud settings', async () => {
    const user = userEvent.setup()
    render(<ConfigurationSync userId="user-1" onOpenAccount={vi.fn()} />)
    await screen.findByRole('button', { name: 'Sync now' })
    const summary = screen.getByText('Advanced sync options')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    await user.click(summary)
    await user.click(screen.getByRole('button', { name: 'Replace cloud settings' }))
    expect(mocks.connect).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Confirm replacement' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Replace cloud settings' }))
    await user.click(screen.getByRole('button', { name: 'Confirm replacement' }))
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledWith('user-1', true))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clear cloud settings' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Clear cloud settings' }))
    expect(mocks.clear).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm clear' }))
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce())
  })
})
