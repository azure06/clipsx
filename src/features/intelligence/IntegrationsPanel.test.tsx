import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { IntegrationsPanel } from './IntegrationsPanel'
import type { McpGrant, McpIntegrationStatus } from '../recall/contracts.generated'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
let status: McpIntegrationStatus
let grants: McpGrant[]
beforeEach(() => {
  vi.clearAllMocks()
  status = {
    configuration: { enabled: false, port: 39389 },
    endpoint: 'http://127.0.0.1:39389/mcp',
    state: 'disabled',
    diagnostic: null,
  }
  grants = []
  invokeMock.mockImplementation(
    (
      command: string,
      args?: {
        configuration?: { enabled: boolean; port: number }
        name?: string
        canWrite?: boolean
        id?: string
      }
    ) => {
      if (command === 'mcp_integration_status') return Promise.resolve(status)
      if (command === 'mcp_list_grants') return Promise.resolve(grants)
      if (command === 'assistant_action_activity') return Promise.resolve([])
      if (command === 'mcp_configure') {
        status = {
          ...status,
          configuration: args!.configuration!,
          state: args!.configuration!.enabled ? 'running' : 'disabled',
        }
        return Promise.resolve(status)
      }
      if (command === 'mcp_issue_grant') {
        const grant = {
          id: 'client-1',
          name: args!.name!,
          canWrite: args!.canWrite!,
          createdAt: 0,
          revoked: false,
        }
        grants = [grant]
        return Promise.resolve({ grant, token: 'fixture-token-shown-once' })
      }
      if (command === 'mcp_revoke_grant') {
        grants = grants.map(grant => ({ ...grant, revoked: grant.id === args?.id }))
        return Promise.resolve()
      }
      if (command === 'mcp_test_access') return Promise.resolve(5)
      return Promise.reject(new Error('Unexpected command'))
    }
  )
})

it('defaults to disabled/read-only grants and shows a new token only until dismissed', async () => {
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  expect(screen.getByRole('switch', { name: 'Enable MCP' })).toHaveAttribute(
    'aria-checked',
    'false'
  )
  expect(screen.getByRole('switch', { name: 'Allow creation and organization' })).toHaveAttribute(
    'aria-checked',
    'false'
  )
  fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Codex' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create access token' }))
  await screen.findByLabelText('Token for Codex')
  expect(invokeMock).toHaveBeenCalledWith('mcp_issue_grant', {
    name: 'Codex',
    canWrite: false,
    rotateId: null,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss token' }))
  expect(screen.queryByDisplayValue('fixture-token-shown-once')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  await screen.findByText('Revoked')
  expect(invokeMock).toHaveBeenCalledWith('mcp_revoke_grant', { id: 'client-1' })
})

it('validates ports and tests the supplied credential while keeping it out of setup text', async () => {
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  fireEvent.change(screen.getByLabelText('Port'), { target: { value: '0' } })
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Port'), { target: { value: '39389' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Enable MCP' }))
  await screen.findByText('Running')
  await waitFor(() =>
    expect(screen.getByLabelText('Token to test (or use the token shown above)')).toBeEnabled()
  )
  fireEvent.change(screen.getByLabelText('Token to test (or use the token shown above)'), {
    target: { value: 'test-token' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await screen.findByText('Connected; 5 tools available.')
  expect(invokeMock).toHaveBeenCalledWith('mcp_test_access', { token: 'test-token' })
  expect(screen.queryByDisplayValue('test-token')).not.toBeInTheDocument()
  expect(screen.getByText(/codex mcp add clipsx/)).toHaveTextContent('CLIPSX_MCP_TOKEN')
})
