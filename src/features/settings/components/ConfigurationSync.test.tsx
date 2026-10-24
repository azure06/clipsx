import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import {
  listSyncDevices,
  renameSyncDevice,
  removeSyncDevice,
} from '../../../shared/auth/supabaseAuth'
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
  renameSyncDevice: vi.fn().mockResolvedValue(undefined),
  removeSyncDevice: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(listSyncDevices).mockResolvedValue([])
    vi.mocked(removeSyncDevice).mockReset().mockResolvedValue(undefined)
    vi.mocked(renameSyncDevice).mockReset().mockResolvedValue(undefined)
    mocks.status.mockResolvedValue({
      deviceId: 'device-current',
      deviceName: 'My laptop',
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
  const device = (overrides = {}) => ({
    deviceId: 'device-12345678',
    displayName: 'Office Mac',
    lastSeenAt: '2026-10-24T00:00:00Z',
    revokedAt: null,
    current: false,
    ...overrides,
  })
  it('distinguishes legacy placeholders and upgrades only the current device name', async () => {
    vi.mocked(listSyncDevices).mockResolvedValue([
      device({ displayName: 'This device' }),
      device({ deviceId: 'device-current', displayName: 'This device', current: true }),
    ])
    render(<ConfigurationSync userId="user-1" onOpenAccount={vi.fn()} />)
    expect(await screen.findByText('Device · 12345678')).toBeInTheDocument()
    expect(await screen.findByText('My laptop')).toBeInTheDocument()
    expect(renameSyncDevice).toHaveBeenCalledExactlyOnceWith('device-current', 'My laptop')
    expect(screen.getAllByText('This device')).toHaveLength(1)
  })
  it('renames a device and preserves the current device name locally', async () => {
    const user = userEvent.setup()
    vi.mocked(listSyncDevices).mockResolvedValue([device({ current: true })])
    render(<ConfigurationSync userId="user-1" onOpenAccount={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Rename Office Mac' }))
    const input = screen.getByRole('textbox', { name: 'Device name' })
    expect(input).toHaveFocus()
    await user.clear(input)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(input, '  Work laptop  ')
    vi.mocked(listSyncDevices).mockResolvedValue([
      device({ current: true, displayName: 'Work laptop' }),
    ])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(renameSyncDevice).toHaveBeenCalledWith('device-12345678', 'Work laptop')
    )
    expect(invoke).toHaveBeenCalledWith('set_sync_device_name', {
      deviceId: 'device-12345678',
      name: 'Work laptop',
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rename Work laptop' })).toHaveFocus()
    )
  })
  it('requires confirmation and removes revoked entries from the list', async () => {
    const user = userEvent.setup()
    vi.mocked(listSyncDevices).mockResolvedValue([device({ revokedAt: '2026-10-23T00:00:00Z' })])
    render(<ConfigurationSync userId="user-1" onOpenAccount={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Remove Office Mac' }))
    expect(removeSyncDevice).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Remove Office Mac' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove Office Mac' }))
    vi.mocked(listSyncDevices).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Remove device' }))
    await waitFor(() => expect(removeSyncDevice).toHaveBeenCalledWith('device-12345678'))
    expect(await screen.findByText('No devices to display')).toBeInTheDocument()
    expect(screen.queryByText('Office Mac')).not.toBeInTheDocument()
    expect(mocks.pause).not.toHaveBeenCalled()
  })
  it('retains failed removals for retry and stops sync when removing this computer', async () => {
    const user = userEvent.setup()
    vi.mocked(listSyncDevices).mockResolvedValue([device({ current: true })])
    vi.mocked(removeSyncDevice)
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(undefined)
    render(<ConfigurationSync userId="user-1" onOpenAccount={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Remove Office Mac' }))
    await user.click(screen.getByRole('button', { name: 'Remove device' }))
    expect(await screen.findByText('Network unavailable')).toBeInTheDocument()
    expect(screen.getByText('Office Mac')).toBeInTheDocument()
    expect(mocks.pause).not.toHaveBeenCalled()
    vi.mocked(listSyncDevices).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Remove device' }))
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith('user-1', false))
    await waitFor(() => expect(screen.queryByText('Office Mac')).not.toBeInTheDocument())
  })
})
