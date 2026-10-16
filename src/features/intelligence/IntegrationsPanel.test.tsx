import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { IntegrationsPanel } from './IntegrationsPanel'
import type { McpGrant, McpIntegrationStatus } from '../recall/contracts.generated'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
let status: McpIntegrationStatus
let grants: McpGrant[]
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('ClipsX test')
  status = {
    configuration: { enabled: false, port: 39389 },
    endpoint: 'http://127.0.0.1:39389/mcp',
    state: 'disabled',
    diagnostic: null,
  }
  grants = []
  HTMLElement.prototype.scrollIntoView = () => undefined
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
      if (command === 'mcp_delete_grant') {
        grants = grants.filter(grant => grant.id !== args?.id)
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
  expect(screen.queryByLabelText('Client name')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add assistant' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Add assistant' }))
  fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Codex' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create access token' }))
  await screen.findByLabelText('Token for Codex')
  await waitFor(() =>
    expect(screen.getByLabelText('Token to test (or use the token shown above)')).toBeEnabled()
  )
  fireEvent.change(screen.getByLabelText('Token to test (or use the token shown above)'), {
    target: { value: 'test-token' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Test access' }))
  await screen.findByText('Authentication and tool discovery succeeded; 5 tools available.')
  expect(invokeMock).toHaveBeenCalledWith('mcp_test_access', { token: 'test-token' })
  expect(screen.queryByDisplayValue('test-token')).not.toBeInTheDocument()
  expect(screen.getByText(/codex mcp add clipsx/)).toHaveTextContent('CLIPSX_MCP_TOKEN')
})

it('leaves tokens behind when returning to the assistant overview', async () => {
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  expect(screen.getAllByRole('button', { name: 'Add assistant' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Add assistant' }))
  fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'My assistant' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create access token' }))
  await screen.findByLabelText('Token for My assistant')
  fireEvent.click(screen.getByRole('button', { name: 'All integrations' }))
  await screen.findByRole('button', { name: 'Manage My assistant' })
  expect(screen.queryByDisplayValue('fixture-token-shown-once')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Manage My assistant' }))
  expect(screen.queryByLabelText('Token for My assistant')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Test access' })).toBeDisabled()
})

it('keeps the server toggle usable when an unapplied advanced port is invalid', async () => {
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  fireEvent.change(screen.getByLabelText('Port'), { target: { value: '0' } })
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  fireEvent.click(screen.getByRole('switch', { name: 'Enable MCP' }))
  await screen.findByText('Running')
  expect(invokeMock).toHaveBeenCalledWith('mcp_configure', {
    configuration: { enabled: true, port: 39389 },
  })
})

it('supports keyboard template selection, suggested names and custom names', async () => {
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Add assistant' }))
  const template = screen.getByRole('combobox', { name: 'Setup template' })
  const name = screen.getByLabelText('Client name')
  expect(name).toHaveValue('Codex')
  expect(name).toHaveAccessibleDescription(/recognize this assistant/)
  expect(screen.getByRole('list', { name: 'Connection steps' })).toBeInTheDocument()
  expect(screen.getByText(/Creating a token does not connect/)).toBeInTheDocument()
  expect(screen.getByText(/MCP is not running/)).toBeInTheDocument()
  template.focus()
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(template).toHaveTextContent('Claude Code')
  expect(name).toHaveValue('Claude Code')
  await user.clear(name)
  await user.type(name, 'Work assistant')
  template.focus()
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(template).toHaveTextContent('Other compatible assistant')
  expect(name).toHaveValue('Work assistant')
  await user.click(screen.getByText('Allow creation and organization', { selector: 'label' }))
  expect(screen.getByRole('switch', { name: 'Allow creation and organization' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await user.click(screen.getByRole('button', { name: 'Create access token' }))
  await screen.findByLabelText('Token for Work assistant')
  expect(invokeMock).toHaveBeenCalledWith('mcp_issue_grant', {
    name: 'Work assistant',
    canWrite: true,
    rotateId: null,
  })
})

it('clears a suggested name for a generic assistant and keeps failed creation retryable', async () => {
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Add assistant' }))
  const template = screen.getByRole('combobox', { name: 'Setup template' })
  template.focus()
  await user.keyboard('{Enter}{End}{Enter}')
  expect(screen.getByLabelText('Client name')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Create access token' })).toBeDisabled()
  await user.type(screen.getByLabelText('Client name'), 'Generic')
  invokeMock.mockRejectedValueOnce(new Error('Unavailable'))
  await user.click(screen.getByRole('button', { name: 'Create access token' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Client name')).toHaveValue('Generic')
  expect(template).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Create access token' }))
  await screen.findByLabelText('Token for Generic')
})

it('restores focus when cancelling and disables edits while creating access', async () => {
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Add assistant' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'Add assistant' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Add assistant' }))
  let rejectCreation!: (reason: Error) => void
  invokeMock.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectCreation = reject
      })
  )
  await user.click(screen.getByRole('button', { name: 'Create access token' }))
  expect(screen.getByRole('combobox', { name: 'Setup template' })).toBeDisabled()
  expect(screen.getByLabelText('Client name')).toBeDisabled()
  expect(screen.getByRole('switch', { name: 'Allow creation and organization' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  rejectCreation(new Error('Unavailable'))
  await screen.findByRole('alert')
  expect(screen.getByRole('combobox', { name: 'Setup template' })).toBeEnabled()
})

it('provides copyable Codex token lookup commands without retrieving a secret', async () => {
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Setup guide' }))
  await user.click(screen.getByText('Find a previously saved token'))
  expect(screen.getByText('$env:CLIPSX_MCP_TOKEN')).toBeVisible()
  expect(screen.getByText('printenv CLIPSX_MCP_TOKEN')).toBeVisible()
  expect(screen.getByText(/ClipsX cannot recover it/)).toBeVisible()
  invokeMock.mockResolvedValueOnce(undefined)
  await user.click(screen.getByRole('button', { name: 'Copy PowerShell token lookup command' }))
  await screen.findByText('Copied')
  expect(invokeMock).toHaveBeenCalledWith('execute_clipboard_output', {
    request: {
      disposition: 'copy',
      source: { kind: 'literal_text', text: '$env:CLIPSX_MCP_TOKEN' },
    },
  })
  expect(invokeMock).not.toHaveBeenCalledWith('mcp_issue_grant', expect.anything())
  const template = screen.getByRole('combobox', { name: 'Setup template' })
  template.focus()
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(screen.queryByText('Find a previously saved token')).not.toBeInTheDocument()
})

it('sets the token before registering Codex with copyable direct shell commands', async () => {
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Setup guide' }))
  expect(screen.getByText('1. Set your token in the terminal')).toBeVisible()
  expect(screen.getByText('2. Add ClipsX to Codex CLI')).toBeVisible()
  expect(screen.getByText("$env:CLIPSX_MCP_TOKEN = 'PASTE_YOUR_TOKEN_HERE'")).toBeVisible()
  invokeMock.mockResolvedValueOnce(undefined)
  await user.click(screen.getByRole('button', { name: 'Copy token setup command' }))
  await screen.findByText('Copied')
  expect(invokeMock).toHaveBeenCalledWith('execute_clipboard_output', {
    request: {
      disposition: 'copy',
      source: {
        kind: 'literal_text',
        text: "$env:CLIPSX_MCP_TOKEN = 'PASTE_YOUR_TOKEN_HERE'",
      },
    },
  })
  const shell = screen.getByRole('combobox', { name: 'Terminal shell' })
  shell.focus()
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(screen.getByText("export CLIPSX_MCP_TOKEN='PASTE_YOUR_TOKEN_HERE'")).toBeVisible()
  expect(screen.getByText(/codex mcp add clipsx/)).toBeVisible()
  await user.click(screen.getByText('Not connecting?'))
  expect(screen.getByText(/this terminal session/)).toBeVisible()
})

it('distinguishes persistent Windows desktop setup from temporary CLI setup', async () => {
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Setup guide' }))
  const target = screen.getByRole('combobox', { name: 'Where will you use Codex?' })
  expect(target).toHaveTextContent('Codex CLI (terminal)')
  expect(screen.queryByText(/SetEnvironmentVariable/)).not.toBeInTheDocument()
  target.focus()
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(target).toHaveTextContent('Desktop app (Windows)')
  expect(screen.queryByRole('combobox', { name: 'Terminal shell' })).not.toBeInTheDocument()
  expect(screen.getByText('1. Save your token in PowerShell')).toBeVisible()
  expect(screen.getByText(/SetEnvironmentVariable/)).toHaveTextContent(
    "'CLIPSX_MCP_TOKEN', 'PASTE_YOUR_TOKEN_HERE', 'User'"
  )
  expect(screen.getByText(/persistent environment storage/)).not.toBeVisible()
  await user.click(screen.getByText('Not connecting?'))
  expect(screen.getByText(/persistent environment storage/)).toBeVisible()
  expect(screen.getByText(/Reopening a chat is not enough/)).toBeVisible()
  expect(screen.getByText(/A listed server is only configured/)).toBeVisible()
  invokeMock.mockResolvedValueOnce(undefined)
  await user.click(screen.getByRole('button', { name: 'Copy token setup command' }))
  await screen.findByText('Copied')
  expect(invokeMock).toHaveBeenCalledWith('execute_clipboard_output', {
    request: {
      disposition: 'copy',
      source: {
        kind: 'literal_text',
        text: "[Environment]::SetEnvironmentVariable('CLIPSX_MCP_TOKEN', 'PASTE_YOUR_TOKEN_HERE', 'User')",
      },
    },
  })
  await user.click(screen.getByText('Find a previously saved token'))
  expect(
    screen.getByText("[Environment]::GetEnvironmentVariable('CLIPSX_MCP_TOKEN', 'User')")
  ).toBeVisible()
  expect(screen.queryByText('printenv CLIPSX_MCP_TOKEN')).not.toBeInTheDocument()
  target.focus()
  await user.keyboard('{Enter}{ArrowUp}{Enter}')
  expect(screen.getByRole('combobox', { name: 'Terminal shell' })).toBeVisible()
  expect(screen.queryByText(/SetEnvironmentVariable/)).not.toBeInTheDocument()
})

it('defaults Windows to the simple persistent desktop command', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0)')
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Setup guide' }))
  expect(screen.getByRole('combobox', { name: 'Where will you use Codex?' })).toHaveTextContent(
    'Desktop app (Windows)'
  )
  expect(
    screen.getByText(
      "[Environment]::SetEnvironmentVariable('CLIPSX_MCP_TOKEN', 'PASTE_YOUR_TOKEN_HERE', 'User')"
    )
  ).toBeVisible()
  expect(screen.queryByText(/Read-Host/)).not.toBeInTheDocument()
  expect(screen.getByText('3. Restart Codex')).toBeVisible()
})

it('confirms deletion, supports cancellation and removes active access', async () => {
  const user = userEvent.setup()
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByRole('button', { name: 'Add assistant' }))
  await user.click(screen.getByRole('button', { name: 'Create access token' }))
  await screen.findByLabelText('Token for Codex')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete assistant' })).toBeEnabled()
  )
  await user.click(screen.getByText('Remove the configuration in your assistant app'))
  expect(screen.getByText('codex mcp remove clipsx')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Delete assistant' }))
  expect(screen.getByText('Delete Codex?')).toBeVisible()
  expect(invokeMock).not.toHaveBeenCalledWith('mcp_delete_grant', expect.anything())
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  expect(cancel).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByText('Delete Codex?')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete assistant' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Delete assistant' }))
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await screen.findByText('Deleted Codex from ClipsX.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add assistant' })).toHaveFocus())
  expect(invokeMock).toHaveBeenCalledWith('mcp_delete_grant', { id: 'client-1' })
  expect(screen.queryByDisplayValue('fixture-token-shown-once')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Manage Codex' })).not.toBeInTheDocument()
})

it('allows deleting a revoked entry and keeps a failed deletion retryable', async () => {
  const user = userEvent.setup()
  grants = [
    { id: 'old-client', name: 'Old assistant', canWrite: false, createdAt: 0, revoked: true },
  ]
  render(<IntegrationsPanel />)
  await screen.findByText('Disabled')
  await user.click(screen.getByText('Revoked access'))
  await user.click(screen.getByRole('button', { name: 'Manage Old assistant' }))
  expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete assistant' }))
  invokeMock.mockRejectedValueOnce(new Error('Unavailable'))
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await screen.findByRole('alert')
  expect(screen.getByText('Delete Old assistant?')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await screen.findByText('Deleted Old assistant from ClipsX.')
  expect(screen.queryByText('Revoked access')).not.toBeInTheDocument()
})
