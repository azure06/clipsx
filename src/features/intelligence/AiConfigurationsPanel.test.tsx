import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { AiConfigurationsPanel } from './AiConfigurationsPanel'
import { emptyConnection, emptyPreset } from './modelConfiguration'
import type { AiConfiguration, AiConfigurationState } from '../recall/contracts.generated'
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  write: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: mocks.read,
  stat: mocks.stat,
  writeTextFile: mocks.write,
}))
let state: AiConfigurationState

it('previews affected defaults inline, cancels with Escape, and removes a model explicitly', async () => {
  const user = userEvent.setup()
  const connection = { ...emptyConnection(), name: 'Local fixture' }
  const preset = { ...emptyPreset(connection.id), name: 'Chat fixture', modelId: 'fixture' }
  state.configuration.connections = [connection]
  state.configuration.presets = [preset]
  state.configuration.selections.defaultChat = preset.id
  state.configuration.selections.extensionGeneration = preset.id
  const original = mocks.invoke.getMockImplementation() as (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command !== 'ai_configuration_remove') return original(command, args)
    state.configuration.presets = []
    state.configuration.selections.defaultChat = null
    state.configuration.selections.extensionGeneration = null
    return Promise.resolve(structuredClone(state))
  })
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: /Manage/ }))
  const trigger = screen.getByRole('button', { name: 'Remove model Chat fixture' })
  await user.click(trigger)
  const confirmation = screen.getByRole('region', { name: 'Remove Chat fixture?' })
  expect(
    within(confirmation).getByText(/No replacement is selected automatically/)
  ).toBeInTheDocument()
  expect(
    within(confirmation).getByText(/Saved conversations and clipboard items are kept/)
  ).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'ai_configuration_remove')).toBe(
    false
  )
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Remove configuration' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Remove model Chat fixture' })
    ).not.toBeInTheDocument()
  )
  expect(mocks.invoke).toHaveBeenCalledWith('ai_configuration_remove', {
    connectionId: null,
    presetId: preset.id,
  })
  expect(screen.getAllByRole('button', { name: 'Add model' })[0]).toHaveFocus()
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'ai_configuration_import')).toBe(
    false
  )
})

it('removes a provider and shows retryable credential cleanup without losing the overview', async () => {
  const user = userEvent.setup()
  const connection = { ...emptyConnection(), name: 'Local fixture' }
  state.configuration.connections = [connection]
  state.configuration.presets = [emptyPreset(connection.id)]
  const original = mocks.invoke.getMockImplementation() as (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === 'ai_configuration_remove') {
      state.configuration.connections = []
      state.configuration.presets = []
      state.pendingCredentialRemovals = 1
      return Promise.resolve(structuredClone(state))
    }
    if (command === 'ai_configuration_retry_cleanup') {
      state.pendingCredentialRemovals = 0
      return Promise.resolve(structuredClone(state))
    }
    return original(command, args)
  })
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: /Manage/ }))
  await user.click(screen.getByRole('button', { name: 'Remove provider Local fixture' }))
  expect(screen.getByRole('region', { name: 'Remove Local fixture?' })).toHaveTextContent(
    '1 saved model configurations'
  )
  await user.click(screen.getByRole('button', { name: 'Remove configuration' }))
  const add = await screen.findByRole('button', { name: 'Add provider' })
  await waitFor(() => expect(add).toHaveFocus())
  expect(await screen.findByText(/Secure credential cleanup is pending/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(screen.queryByText(/Secure credential cleanup is pending/)).not.toBeInTheDocument()
  )
})

beforeEach(() => {
  vi.clearAllMocks()
  state = {
    configuration: {
      version: 2,
      connections: [],
      presets: [],
      selections: {
        defaultChat: null,
        activeEmbedding: null,
        webSearch: null,
        extensionGeneration: null,
        defaultDecision: null,
        activeRerank: null,
      },
    },
    connectionStates: [],
  }
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === 'ai_configuration_state') return Promise.resolve(structuredClone(state))
    if (command === 'ai_configuration_import' || command === 'ai_configuration_preview') {
      const incoming = args?.['configuration'] as AiConfiguration
      const configuration = {
        ...incoming,
        connections: [
          ...state.configuration.connections.filter(
            c => !incoming.connections.some(v => v.id === c.id)
          ),
          ...incoming.connections,
        ],
        presets: [
          ...state.configuration.presets.filter(p => !incoming.presets.some(v => v.id === p.id)),
          ...incoming.presets,
        ],
      }
      if (command === 'ai_configuration_preview') return Promise.resolve(configuration)
      state = { ...state, configuration }
      return Promise.resolve(state)
    }
    if (command === 'ai_configuration_export')
      return Promise.resolve(structuredClone(state.configuration))
    if (command === 'ai_set_credential') return Promise.resolve()
    if (command === 'ai_test_decision')
      return Promise.resolve({ choice: 'schedule', confidence: 0.9 })
    throw new Error('Unexpected command')
  })
  mocks.stat.mockResolvedValue({ size: 100 })
  mocks.open.mockResolvedValue('C:/fixture/configuration.json')
  mocks.save.mockResolvedValue('C:/fixture/export.json')
  // Radix pointer interactions need these DOM APIs in jsdom.
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = () => undefined
  HTMLElement.prototype.releasePointerCapture = () => undefined
  HTMLElement.prototype.scrollIntoView = () => undefined
})

it('uses focused editors, preserves several same-provider connections, and keeps credentials out of configuration', async () => {
  const user = userEvent.setup()
  render(<AiConfigurationsPanel />)
  await screen.findByText('Models, your way')
  expect(screen.getAllByRole('button', { name: 'Add provider' })).toHaveLength(1)
  expect(screen.queryByLabelText('Connection name')).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'Add provider' })[0]!)
  expect(screen.queryByText('Models, your way')).not.toBeInTheDocument()
  const dialog = screen.getByRole('region', { name: 'Add provider' })
  await user.type(within(dialog).getByLabelText('Connection name'), 'Ollama home')
  await user.type(within(dialog).getByLabelText('API credential'), 'private-fixture-key')
  await user.click(within(dialog).getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(screen.queryByLabelText('Connection name')).not.toBeInTheDocument())
  expect(mocks.invoke).toHaveBeenCalledWith(
    'ai_set_credential',
    expect.objectContaining({ value: 'private-fixture-key' })
  )
  expect(
    JSON.stringify(mocks.invoke.mock.calls.filter(call => call[0] === 'ai_configuration_import'))
  ).not.toContain('private-fixture-key')
  await user.click(screen.getByRole('button', { name: /All configurations/ }))
  await user.click(screen.getAllByRole('button', { name: 'Add provider' })[0]!)
  await user.type(screen.getByLabelText('Connection name'), 'Ollama office')
  await user.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(state.configuration.connections).toHaveLength(2))
  expect(state.configuration.connections.map(c => c.name)).toEqual(['Ollama home', 'Ollama office'])
})

it('offers the guide on the overview and tests drafts without saving them', async () => {
  const user = userEvent.setup()
  const original = mocks.invoke.getMockImplementation() as (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) =>
    command === 'ai_test_connection' ? Promise.resolve(3) : original(command, args)
  )
  render(<AiConfigurationsPanel />)
  await screen.findByRole('button', { name: 'Local AI setup guide' })
  await user.click(screen.getByRole('button', { name: 'Add provider' }))
  await user.type(screen.getByLabelText('Connection name'), 'Draft provider')
  await user.type(screen.getByLabelText('API credential'), 'draft-key')
  await user.click(screen.getByRole('button', { name: 'Test connection' }))
  await screen.findByText(/Connected. Discovered 3 models/)
  const testCall = mocks.invoke.mock.calls.find(([command]) => command === 'ai_test_connection')
  expect(testCall?.[1]).toMatchObject({
    connection: { name: 'Draft provider' },
    credential: 'draft-key',
  })
  expect(
    mocks.invoke.mock.calls.some(
      ([command]) => command === 'ai_configuration_import' || command === 'ai_set_credential'
    )
  ).toBe(false)
  await user.type(screen.getByLabelText('API base URL'), '/changed')
  expect(screen.queryByText(/Connected. Discovered/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'Provider' }))
  await user.click(screen.getByRole('option', { name: 'OpenAI' }))
  expect(screen.getByLabelText('API credential')).toHaveValue('')
})

it('shows Gemini status and a safe quota reason when a draft test fails', async () => {
  const user = userEvent.setup()
  const original = mocks.invoke.getMockImplementation() as (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) =>
    command === 'ai_test_connection'
      ? Promise.reject(
          Object.assign(new Error('sensitive provider body'), {
            code: 'provider_rate_limited',
            recovery: 'retry',
            status: 429,
            reason: 'quota_exceeded',
            message: 'sensitive provider body',
          })
        )
      : original(command, args)
  )
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Add provider' }))
  await user.type(screen.getByLabelText('Connection name'), 'Gemini free')
  await user.click(screen.getByRole('combobox', { name: 'Provider' }))
  await user.click(screen.getByRole('option', { name: 'Gemini' }))
  await user.type(screen.getByLabelText('API credential'), 'fixture-secret')
  await user.click(screen.getByRole('button', { name: 'Test connection' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('HTTP 429')
  expect(alert).toHaveTextContent('exceeded its quota')
  expect(alert).not.toHaveTextContent('sensitive provider body')
  expect(alert).not.toHaveTextContent('fixture-secret')
})

it('explains secure storage failure after a successful connection test and retries without duplicating the provider', async () => {
  const user = userEvent.setup()
  const invoke = mocks.invoke.getMockImplementation() as (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
  let failCredentialSave = true
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === 'ai_test_connection') return Promise.resolve(3)
    if (command === 'ai_set_credential' && failCredentialSave)
      return Promise.reject(
        Object.assign(new Error('Secure storage unavailable'), {
          code: 'credential_storage_unavailable',
          recovery: 'wait',
        })
      )
    return invoke(command, args)
  })
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Add provider' }))
  await user.type(screen.getByLabelText('Connection name'), 'OpenRouter Linux')
  await user.click(screen.getByRole('combobox', { name: 'Provider' }))
  await user.click(screen.getByRole('option', { name: 'OpenRouter' }))
  await user.type(screen.getByLabelText('API credential'), 'fixture-secret')
  await user.click(screen.getByRole('button', { name: 'Test connection' }))
  await screen.findByText(/Connected. Discovered 3 models/)
  await user.click(screen.getByRole('button', { name: 'Save connection' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'ClipsX cannot access secure credential storage.'
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Secret Service')
  expect(screen.getByRole('alert')).not.toHaveTextContent('fixture-secret')
  expect(state.configuration.connections).toHaveLength(1)
  expect(screen.getByLabelText('API credential')).toHaveValue('fixture-secret')
  const id = state.configuration.connections[0]!.id
  failCredentialSave = false
  await user.click(screen.getByRole('button', { name: 'Save connection' }))
  await screen.findByText('Configuration saved.')
  expect(state.configuration.connections).toHaveLength(1)
  expect(state.configuration.connections[0]!.id).toBe(id)
})

it('assigns a hosted chat preset to extension generation independently of Recall and embeddings', async () => {
  const user = userEvent.setup()
  const connection = {
    ...emptyConnection(),
    name: 'Work OpenAI',
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com/v1',
  }
  const chat = { ...emptyPreset(connection.id), name: 'Work chat', modelId: 'fixture-chat' }
  const embedding = {
    ...emptyPreset(connection.id),
    name: 'Search',
    modelId: 'fixture-embedding',
    purpose: 'embedding' as const,
  }
  state.configuration.connections = [connection]
  state.configuration.presets = [chat, embedding]
  state.configuration.selections.defaultChat = chat.id
  render(<AiConfigurationsPanel />)
  await screen.findByText('Models, your way')
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  await user.click(screen.getByRole('combobox', { name: 'Extension text generation' }))
  expect(screen.queryByRole('option', { name: 'Work OpenAI / Search' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'Work OpenAI / Work chat' }))
  await waitFor(() => expect(state.configuration.selections.extensionGeneration).toBe(chat.id))
  expect(state.configuration.selections.defaultChat).toBe(chat.id)
  expect(state.configuration.selections.activeEmbedding).toBeNull()
})

it('explains hosted indexing consent when activation fails and preserves the selection', async () => {
  const user = userEvent.setup()
  const connection = {
    ...emptyConnection(),
    name: 'OpenRouter',
    provider: 'openrouter' as const,
    baseUrl: 'https://openrouter.ai/api/v1',
  }
  const embedding = {
    ...emptyPreset(connection.id),
    name: 'Free embedding',
    modelId: 'nvidia/nemotron-3-embed-1b:free',
    purpose: 'embedding' as const,
    options: {
      ...emptyPreset(connection.id).options,
      limitPolicy: 'explicit' as const,
      embedding: { dimensions: null, taskPolicy: 'symmetric', hostedIndexingEnabled: false },
    },
  }
  state.configuration.connections = [connection]
  state.configuration.presets = [embedding]
  const invoke = mocks.invoke.getMockImplementation()!
  mocks.invoke.mockImplementation((command, args) =>
    command === 'ai_configuration_import'
      ? Promise.reject(
          Object.assign(new Error('Hosted indexing disabled'), {
            code: 'hosted_indexing_disabled',
            recovery: 'wait',
          })
        )
      : (invoke(command, args) as unknown)
  )
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.click(screen.getByRole('combobox', { name: 'Semantic search' }))
  await user.click(screen.getByRole('option', { name: 'OpenRouter / Free embedding' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enable hosted indexing in this embedding preset before making it active.'
  )
  expect(state.configuration.selections.activeEmbedding).toBeNull()
})

it('previews file imports before applying and preserves feature assignments by default', async () => {
  const user = userEvent.setup()
  const connection = { ...emptyConnection(), name: 'Imported Ollama' }
  mocks.read.mockResolvedValue(
    JSON.stringify({ ...state.configuration, connections: [connection] })
  )
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Import' }))
  await user.click(screen.getByRole('button', { name: 'Choose JSON file' }))
  await screen.findByText('Review changes')
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'ai_configuration_import')).toBe(false)
  expect(
    screen.getByRole('switch', { name: 'Apply imported feature assignments' })
  ).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Import configuration' }))
  await screen.findByText('Model configuration imported.')
  expect(state.configuration.connections[0]?.name).toBe('Imported Ollama')
})

it('rejects invalid and oversized JSON without importing', async () => {
  render(<AiConfigurationsPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }))
  mocks.read.mockResolvedValue('{invalid')
  fireEvent.click(screen.getByRole('button', { name: 'Choose JSON file' }))
  await screen.findByRole('alert')
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'ai_configuration_import')).toBe(false)
  mocks.stat.mockResolvedValue({ size: 1024 * 1024 + 1 })
  mocks.read.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Choose JSON file' }))
  await waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(2))
  expect(mocks.read).not.toHaveBeenCalled()
})

it('exports only selected connections and their models without credentials', async () => {
  const user = userEvent.setup()
  const first = { ...emptyConnection(), name: 'Home' },
    second = { ...emptyConnection(), name: 'Office' }
  state.configuration.connections = [first, second]
  state.configuration.presets = [
    { ...emptyPreset(first.id), name: 'Home chat' },
    { ...emptyPreset(second.id), name: 'Office chat' },
  ]
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: 'Export' }))
  await user.click(screen.getByRole('checkbox', { name: /Office/ }))
  await user.click(screen.getByRole('button', { name: 'Save JSON file' }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalled())
  const document = JSON.parse(mocks.write.mock.calls[0]![1] as string) as AiConfiguration
  expect(document.connections.map(c => c.id)).toEqual([first.id])
  expect(document.presets.map(p => p.connectionId)).toEqual([first.id])
})

it('tests decision models explicitly and does not turn on automation', async () => {
  const user = userEvent.setup()
  const connection = { ...emptyConnection(), name: 'Home Ollama' }
  state.configuration.connections = [connection]
  state.configuration.presets = [
    { ...emptyPreset(connection.id), name: 'Decider', modelId: 'laya', purpose: 'decision' },
  ]
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: /Manage/ }))
  await user.click(screen.getByRole('button', { name: 'Test decision' }))
  await screen.findByText(/Synthetic test returned/)
  expect(mocks.invoke).toHaveBeenCalledWith('ai_test_decision', {
    presetId: state.configuration.presets[0]!.id,
  })
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'ai_configuration_import')).toBe(false)
})

it('browses installed models by reported purpose and configures a selected embedding', async () => {
  const user = userEvent.setup()
  const connection = { ...emptyConnection(), name: 'Home Ollama' }
  state.configuration.connections = [connection]
  const invoke = mocks.invoke.getMockImplementation()!
  mocks.invoke.mockImplementation((command, args) =>
    command === 'ai_discover_models'
      ? Promise.resolve([
          {
            id: 'embed-local',
            purposes: ['embedding'],
            capabilities: { tools: null, vision: null, webSearch: null, source: null },
          },
          {
            id: 'chat-local',
            purposes: ['chat'],
            capabilities: { tools: null, vision: null, webSearch: null, source: null },
          },
          {
            id: 'decision-local',
            purposes: ['decision'],
            capabilities: { tools: null, vision: null, webSearch: null, source: null },
          },
        ])
      : (invoke(command, args) as unknown)
  )
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: /Manage/ }))
  expect(screen.queryByText('Active models')).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'Add model' })[0]!)
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('ai_discover_models', { connectionId: connection.id })
  )
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Purpose' })).not.toBeDisabled())
  await user.click(screen.getByRole('combobox', { name: 'Purpose' }))
  await user.click(screen.getByRole('option', { name: 'Text embeddings' }))
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  expect(screen.queryByRole('option', { name: 'chat-local' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'decision-local' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'embed-local' }))
  expect(screen.queryByLabelText('Model ID')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save preset' }))
  await waitFor(() => expect(state.configuration.presets[0]?.purpose).toBe('embedding'))
})

it('saves a discovered OpenRouter embedding with hosted indexing enabled', async () => {
  const user = userEvent.setup()
  const connection = {
    ...emptyConnection(),
    name: 'OpenRouter',
    provider: 'openrouter' as const,
    baseUrl: 'https://openrouter.ai/api/v1',
  }
  state.configuration.connections = [connection]
  const invoke = mocks.invoke.getMockImplementation()!
  mocks.invoke.mockImplementation((command, args) =>
    command === 'ai_discover_models'
      ? Promise.resolve([
          {
            id: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
            purposes: ['embedding'],
            capabilities: {
              tools: false,
              vision: false,
              webSearch: null,
              source: 'provider_catalog',
            },
          },
        ])
      : (invoke(command, args) as unknown)
  )
  render(<AiConfigurationsPanel />)
  await user.click(await screen.findByRole('button', { name: /Manage/ }))
  await user.click(screen.getAllByRole('button', { name: 'Add model' })[0]!)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Purpose' })).not.toBeDisabled())
  await user.click(screen.getByRole('combobox', { name: 'Purpose' }))
  await user.click(screen.getByRole('option', { name: 'Text embeddings' }))
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  await user.click(
    screen.getByRole('option', { name: 'nvidia/llama-nemotron-embed-vl-1b-v2:free' })
  )
  const consent = screen.getByRole('switch', {
    name: 'Allow background indexing to send clipboard text to this hosted provider',
  })
  expect(consent).not.toBeChecked()
  await user.click(consent)
  expect(consent).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Save preset' }))
  await waitFor(() => expect(state.configuration.presets).toHaveLength(1))
  expect(state.configuration.presets[0]).toMatchObject({
    modelId: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    purpose: 'embedding',
    options: {
      limitPolicy: 'explicit',
      embedding: { dimensions: null, taskPolicy: 'symmetric', hostedIndexingEnabled: true },
    },
  })
})
