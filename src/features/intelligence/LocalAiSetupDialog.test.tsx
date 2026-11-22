import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useUIStore } from '../../stores/uiStore'
import { IntelligenceOverview } from './IntelligenceOverview'
import { LocalAiSetupDialog } from './LocalAiSetupDialog'
import { useLocalAiSetup, type LocalAiPlan, type LocalAiStatus } from './localAiSetup'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class {
    constructor(readonly onmessage: (event: unknown) => void) {}
  },
}))

const ready: LocalAiStatus = {
  runtime: 'running',
  installedModels: [],
  startingChat: 'qwen3.5:4b',
  candidates: [
    { id: 'qwen3.5:2b', purpose: 'chat', copyKey: 'qwenSmall', downloadBytes: 3_100_000_000 },
    { id: 'qwen3.5:4b', purpose: 'chat', copyKey: 'qwenBalanced', downloadBytes: 4_000_000_000 },
    { id: 'lfm2.5:8b', purpose: 'chat', copyKey: 'lfm', downloadBytes: 5_200_000_000 },
    {
      id: 'embeddinggemma:latest',
      purpose: 'embedding',
      copyKey: 'gemma',
      downloadBytes: 622_000_000,
    },
    {
      id: 'qwen3-embedding:0.6b',
      purpose: 'embedding',
      copyKey: 'qwenEmbedSmall',
      downloadBytes: 639_000_000,
    },
    {
      id: 'qwen3-embedding:4b',
      purpose: 'embedding',
      copyKey: 'qwenEmbedLarge',
      downloadBytes: 2_500_000_000,
    },
    { id: 'tev1:0.8b', purpose: 'decision', copyKey: 'tev', downloadBytes: 1_500_000_000 },
    { id: 'd1:3b', purpose: 'decision', copyKey: 'd1', downloadBytes: 3_700_000_000 },
    {
      id: 'pplx-decider-flash:4b',
      purpose: 'decision',
      copyKey: 'decider',
      downloadBytes: 5_600_000_000,
    },
  ],
}
let status: LocalAiStatus
let hasDefault: boolean

function Overview() {
  const open = useLocalAiSetup(state => state.open)
  return (
    <>
      <IntelligenceOverview status={null} loading={false} ocr={null} onNavigate={vi.fn()} />
      {open && <LocalAiSetupDialog />}
    </>
  )
}

beforeEach(() => {
  useLocalAiSetup.setState(useLocalAiSetup.getInitialState(), true)
  useUIStore.setState({ activeView: 'intelligence' })
  status = ready
  hasDefault = false
  invoke.mockReset().mockImplementation((command: string) => {
    if (command === 'ai_local_setup_probe') return Promise.resolve(status)
    if (command === 'privacy_settings') return Promise.resolve({ rules: [] })
    if (command === 'ai_configuration_state') {
      return Promise.resolve({
        configuration: {
          connections: [{ id: 'ollama', enabled: true }],
          presets: [
            { id: 'preset', name: 'Existing model', purpose: 'chat', connectionId: 'ollama' },
          ],
          selections: { defaultChat: hasDefault ? 'preset' : null },
        },
      })
    }
    if (command === 'open_external_url' || command === 'ai_local_setup_open') {
      status = ready
      return Promise.resolve()
    }
    return Promise.reject(new Error(command))
  })
})

it('opens setup from Intelligence and keeps an explicit download running after closing it', async () => {
  const user = userEvent.setup()
  let finish!: (value: LocalAiPlan) => void
  const completion = new Promise<LocalAiPlan>(resolve => {
    finish = resolve
  })
  const original = invoke.getMockImplementation() as (command: string) => Promise<unknown>
  invoke.mockImplementation(
    (command: string, args?: { progress: { onmessage: (event: unknown) => void } }) => {
      if (command !== 'ai_local_setup_finish') return original(command)
      args?.progress.onmessage({
        stage: 'downloading',
        model: 'qwen3.5:2b',
        downloadedBytes: 650_000_000,
      })
      return completion
    }
  )
  render(<Overview />)
  await user.click(await screen.findByRole('button', { name: 'Set up local AI' }))
  expect(await screen.findByRole('radio', { name: /qwen3.5:4b.*Starting point/ })).toBeChecked()
  expect(screen.getAllByRole('radio')).toHaveLength(4)
  expect(invoke).not.toHaveBeenCalledWith('ai_local_setup_finish', expect.anything())
  await user.click(screen.getByRole('radio', { name: /qwen3.5:2b/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Meaning Search' })).toHaveFocus()
  expect(screen.getByRole('radio', { name: /^Skip/ })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: /embeddinggemma:latest/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('radio', { name: /^Skip/ })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Review setup' }))
  expect(screen.getByText('Estimated download · 3.72 GB')).toBeVisible()
  const plan = {
    chat: 'qwen3.5:2b',
    embedding: 'embeddinggemma:latest',
    decision: null,
    privacy: false,
  }
  await user.click(screen.getByRole('button', { name: 'Download and set up' }))
  expect(invoke).toHaveBeenCalledWith(
    'ai_local_setup_finish',
    expect.objectContaining({
      plan,
      downloads: ['qwen3.5:2b', 'embeddinggemma:latest'],
    })
  )
  expect(screen.getByText('650 MB downloaded for qwen3.5:2b')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Continue in background' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'View local AI setup' }))
  expect(screen.getByText('650 MB downloaded for qwen3.5:2b')).toBeVisible()
  hasDefault = true
  await act(async () => {
    finish(plan)
    await completion
  })
  expect(await screen.findByText('Local AI setup complete')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Open Recall' }))
  expect(useUIStore.getState().activeView).toBe('recall')
  await waitFor(() => expect(screen.getByText('Existing model')).toBeVisible())
  expect(screen.getByRole('button', { name: 'Set up local AI' })).toBeVisible()
})

it('offers curated choices, permits skipping Recall, and retries an installed decision model', async () => {
  const user = userEvent.setup()
  status = { ...ready, startingChat: null, installedModels: ['custom-model:latest', 'd1:3b'] }
  hasDefault = true
  const original = invoke.getMockImplementation() as (command: string) => Promise<unknown>
  invoke.mockImplementation(
    (command: string, args?: { progress: { onmessage: (event: unknown) => void } }) => {
      if (command !== 'ai_local_setup_finish') return original(command)
      args?.progress.onmessage({ stage: 'verifying', model: 'd1:3b', downloadedBytes: 0 })
      return Promise.reject(new Error('fixture'))
    }
  )
  render(<Overview />)
  await user.click(await screen.findByRole('button', { name: 'Set up local AI' }))
  expect(await screen.findByRole('radio', { name: /^Skip/ })).toBeChecked()
  expect(screen.queryByText('custom-model:latest')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.queryByRole('checkbox')).toBeNull()
  await user.click(screen.getByRole('radio', { name: /d1:3b.*Already installed/ }))
  expect(screen.getByRole('checkbox', { name: /Also use for privacy checks/ })).not.toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: /Also use for privacy checks/ }))
  await user.click(screen.getByRole('button', { name: 'Review setup' }))
  expect(within(screen.getByRole('dialog')).getByText('Privacy checks')).toBeVisible()
  expect(screen.getByText('No downloads needed')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('checkbox', { name: /Also use for privacy checks/ })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Review setup' }))
  await user.click(screen.getByRole('button', { name: 'Test and apply' }))
  expect(invoke).toHaveBeenCalledWith(
    'ai_local_setup_finish',
    expect.objectContaining({
      plan: { chat: null, embedding: null, decision: 'd1:3b', privacy: true },
      downloads: [],
    })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('The setup check failed for d1:3b')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Test and apply' })).toBeEnabled())
})

it('closes without applying anything when all three roles are skipped', async () => {
  const user = userEvent.setup()
  render(<Overview />)
  await user.click(await screen.findByRole('button', { name: 'Set up local AI' }))
  await user.click(await screen.findByRole('radio', { name: /^Skip/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Review setup' }))
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(invoke).not.toHaveBeenCalledWith('ai_local_setup_finish', expect.anything())
  await user.click(screen.getByRole('button', { name: 'Set up local AI' }))
  expect(await screen.findByRole('heading', { name: 'Recall chat' })).toBeVisible()
})

it('reuses a completed download when a later model fails and the plan is retried', async () => {
  const user = userEvent.setup()
  const original = invoke.getMockImplementation() as (command: string) => Promise<unknown>
  const setup = vi
    .fn<(args: { plan: LocalAiPlan }) => Promise<LocalAiPlan>>()
    .mockImplementationOnce(() => {
      status = { ...ready, installedModels: ['qwen3.5:4b'] }
      return Promise.reject(new Error('download interrupted'))
    })
    .mockImplementation(args => Promise.resolve(args.plan))
  invoke.mockImplementation((command: string, args?: { plan: LocalAiPlan }) =>
    command === 'ai_local_setup_finish' && args ? setup(args) : original(command)
  )
  render(<Overview />)
  await user.click(await screen.findByRole('button', { name: 'Set up local AI' }))
  await user.click(await screen.findByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('radio', { name: /embeddinggemma:latest/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Review setup' }))
  await user.click(screen.getByRole('button', { name: 'Download and set up' }))
  expect(await screen.findByText('Estimated download · 622 MB')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Download and set up' }))
  expect(setup).toHaveBeenLastCalledWith(
    expect.objectContaining({
      plan: {
        chat: 'qwen3.5:4b',
        embedding: 'embeddinggemma:latest',
        decision: null,
        privacy: false,
      },
      downloads: ['embeddinggemma:latest'],
    })
  )
  expect(await screen.findByRole('heading', { name: 'Local AI setup complete' })).toBeVisible()
})

it.each([
  ['missing', 'Install Ollama', 'open_external_url'],
  ['stopped', 'Open Ollama', 'ai_local_setup_open'],
] as const)(
  'connects when Ollama is %s after the user chooses to proceed',
  async (runtime, label, command) => {
    const user = userEvent.setup()
    status = { ...ready, runtime }
    render(<Overview />)
    await user.click(await screen.findByRole('button', { name: 'Set up local AI' }))
    const connect = await screen.findByRole('button', { name: label })
    expect(invoke.mock.calls.some(([called]) => called === command)).toBe(false)
    await user.click(connect)
    expect(await screen.findByRole('radio', { name: /qwen3.5:4b.*Starting point/ })).toBeChecked()
    if (runtime === 'missing') {
      expect(invoke).toHaveBeenCalledWith(command, { url: 'https://ollama.com/download' })
    } else {
      expect(invoke).toHaveBeenCalledWith(command)
    }
  }
)
