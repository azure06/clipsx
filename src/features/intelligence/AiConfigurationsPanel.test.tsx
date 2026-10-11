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
  await screen.findByText('Which models power ClipsX?')
  expect(screen.queryByLabelText('Connection name')).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'Add provider' })[0]!)
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Connection name'), 'Ollama home')
  await user.type(within(dialog).getByLabelText('API credential'), 'private-fixture-key')
  await user.click(within(dialog).getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(mocks.invoke).toHaveBeenCalledWith(
    'ai_set_credential',
    expect.objectContaining({ value: 'private-fixture-key' })
  )
  expect(
    JSON.stringify(mocks.invoke.mock.calls.filter(call => call[0] === 'ai_configuration_import'))
  ).not.toContain('private-fixture-key')
  await user.click(screen.getAllByRole('button', { name: 'Add provider' })[0]!)
  await user.type(screen.getByLabelText('Connection name'), 'Ollama office')
  await user.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(state.configuration.connections).toHaveLength(2))
  expect(state.configuration.connections.map(c => c.name)).toEqual(['Ollama home', 'Ollama office'])
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
  await screen.findByText('Which models power ClipsX?')
  await user.click(screen.getByRole('combobox', { name: 'Extension text generation' }))
  expect(screen.queryByRole('option', { name: 'Work OpenAI / Search' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'Work OpenAI / Work chat' }))
  await waitFor(() => expect(state.configuration.selections.extensionGeneration).toBe(chat.id))
  expect(state.configuration.selections.defaultChat).toBe(chat.id)
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
  await user.click(await screen.findByRole('button', { name: /Home Ollama/ }))
  await user.click(screen.getByRole('button', { name: 'Test decision' }))
  await screen.findByText(/Synthetic test returned/)
  expect(mocks.invoke).toHaveBeenCalledWith('ai_test_decision', {
    presetId: state.configuration.presets[0]!.id,
  })
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'ai_configuration_import')).toBe(false)
})
