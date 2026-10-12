import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { RecallOptions } from './RecallOptions'
import { fixtureContext } from './runtime/fixtures/context'
import type { AiConfiguration, AssistantModelOptions, RecallThread } from './contracts.generated'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
const context = fixtureContext()
const thread: RecallThread = {
  id: 'thread',
  localId: 'local',
  title: '',
  archived: false,
  presetId: 'preset',
  webEnabled: false,
  headMessageId: null,
  createdAt: 1,
  updatedAt: 1,
  reasoning: null,
}
const configuration: AiConfiguration = {
  version: 2,
  connections: [{ ...context.connection, name: 'Local Ollama' }],
  presets: [context.preset],
  selections: {
    defaultChat: 'preset',
    activeEmbedding: null,
    webSearch: null,
    extensionGeneration: null,
    defaultDecision: null,
  },
}
const props = () => ({
  configuration,
  preset: context.preset,
  presetId: 'preset',
  thread,
  disabled: false,
  onPreset: vi.fn(),
  onReasoning: vi.fn(),
  onWeb: vi.fn(),
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue({
    reasoning: [
      { kind: 'effort', value: 'low' },
      { kind: 'effort', value: 'high' },
    ],
    reasoningSource: 'fixture',
  })
})
describe('Recall model and tool options', () => {
  it('uses compact controls and changes reasoning independently from the shared model preset', async () => {
    const user = userEvent.setup()
    const options = props()
    render(<RecallOptions {...options} />)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('assistant_model_options', { presetId: 'preset' })
    )
    const trigger = screen.getByRole('button', { name: 'recallOptions.reasoning' })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'recallOptions.efforts.high' })
    )
    expect(options.onReasoning).toHaveBeenCalledExactlyOnceWith({ kind: 'effort', value: 'high' })
    expect(options.onPreset).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledOnce()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'recallPage.model' })).toBeEnabled()
  })
  it('puts optional web access in the tools menu and keeps automatic clipboard tools explicit', async () => {
    const user = userEvent.setup()
    const options = props()
    render(<RecallOptions {...options} />)
    await user.click(screen.getByRole('button', { name: 'recallOptions.tools' }))
    expect(screen.getByText('recallOptions.clipboardAutomatic')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'recallPage.webResearch' }))
    expect(options.onWeb).toHaveBeenCalledExactlyOnceWith(true)
    expect(options.onReasoning).not.toHaveBeenCalled()
  })
  it('searches model presets by connection and disables controls during a run', async () => {
    const user = userEvent.setup()
    const options = props()
    const { rerender } = render(<RecallOptions {...options} />)
    await user.click(screen.getByRole('combobox', { name: 'recallPage.model' }))
    await user.type(screen.getByRole('searchbox'), 'Local Ollama')
    expect(screen.getByRole('option', { name: /Local Ollama/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    rerender(<RecallOptions {...options} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'recallOptions.reasoning' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'recallOptions.tools' })).toBeDisabled()
  })
  it('ignores late capability replies from the previously selected model', async () => {
    const pending = new Map<string, (value: AssistantModelOptions) => void>()
    vi.mocked(invoke).mockImplementation(
      (_, args) =>
        new Promise(resolve => pending.set((args as { presetId: string }).presetId, resolve))
    )
    const user = userEvent.setup()
    const options = props()
    const { rerender } = render(<RecallOptions {...options} />)
    rerender(
      <RecallOptions {...options} presetId="second" preset={{ ...context.preset, id: 'second' }} />
    )
    await act(async () => {
      pending.get('second')?.({
        reasoning: [{ kind: 'effort', value: 'low' }],
        reasoningSource: 'fixture',
      })
      pending.get('preset')?.({
        reasoning: [{ kind: 'effort', value: 'high' }],
        reasoningSource: 'fixture',
      })
      await Promise.resolve()
    })
    await user.click(screen.getByRole('button', { name: 'recallOptions.reasoning' }))
    expect(
      screen.getByRole('menuitemradio', { name: 'recallOptions.efforts.low' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'recallOptions.efforts.high' })).toBeNull()
  })
})
