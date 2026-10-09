import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { AiConfigurationsPanel } from './AiConfigurationsPanel'
import type { AiConfigurationState } from '../recall/contracts.generated'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
let state: AiConfigurationState
beforeEach(() => {
  vi.clearAllMocks()
  state = {
    configuration: {
      version: 1,
      connections: [],
      presets: [],
      selections: { defaultChat: null, activeEmbedding: null, webSearch: null },
    },
    connectionStates: [],
  }
  invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === 'ai_configuration_state' || command === 'ai_configuration_import') {
      if (args?.['configuration'])
        state = {
          ...state,
          configuration: args['configuration'] as AiConfigurationState['configuration'],
        }
      return Promise.resolve(state)
    }
    if (command === 'ai_configuration_export') return Promise.resolve(state.configuration)
    if (command === 'ai_set_credential') return Promise.resolve()
    throw new Error('Unexpected command')
  })
})
it('saves credentials through the dedicated command and preserves several named connections', async () => {
  render(<AiConfigurationsPanel />)
  await screen.findByLabelText('Connection name')
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Ollama home' } })
  fireEvent.change(screen.getByLabelText('API credential'), {
    target: { value: 'private-fixture-key' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() =>
    expect(invokeMock).toHaveBeenCalledWith(
      'ai_set_credential',
      expect.objectContaining({ value: 'private-fixture-key' })
    )
  )
  expect(screen.getByLabelText('API credential')).toHaveValue('')
  const imports = invokeMock.mock.calls.filter(call => call[0] === 'ai_configuration_import')
  expect(JSON.stringify(imports)).not.toContain('private-fixture-key')
  fireEvent.click(screen.getByRole('button', { name: 'New connection' }))
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Ollama office' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(state.configuration.connections).toHaveLength(2))
  expect(state.configuration.connections.map(c => c.name)).toEqual(['Ollama home', 'Ollama office'])
})
it('keeps general chat and embeddings independent and validates JSON before invoking import', async () => {
  render(<AiConfigurationsPanel />)
  await screen.findByLabelText('Connection name')
  fireEvent.click(screen.getByText('Configuration JSON'))
  fireEvent.change(screen.getByLabelText('AI configuration JSON document'), {
    target: { value: '{invalid' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }))
  await screen.findByRole('alert')
  expect(invokeMock.mock.calls.some(call => call[0] === 'ai_configuration_import')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))
  await waitFor(() =>
    expect(screen.getByLabelText('AI configuration JSON document')).toHaveValue(
      JSON.stringify(state.configuration, null, 2)
    )
  )
  expect(state.configuration.selections).toEqual({
    defaultChat: null,
    activeEmbedding: null,
    webSearch: null,
  })
})
