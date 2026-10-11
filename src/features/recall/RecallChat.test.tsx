import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { RecallChat } from './RecallChat'
import type { RecallChatProps } from './RecallChat'
import { createRecallAdapter } from './runtime/adapter'
import { fixtureContext } from './runtime/fixtures/context'
import type { RecallHistory } from './contracts.generated'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))
vi.mock('./runtime/adapter', () => ({ createRecallAdapter: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const thread = {
  id: 'thread',
  localId: 'local',
  title: 'Chat',
  archived: false,
  presetId: 'preset',
  webEnabled: false,
  headMessageId: null,
  createdAt: 1,
  updatedAt: 1,
}
const props = (): RecallChatProps => ({
  thread,
  preset: fixtureContext().preset,
  filters: fixtureContext().filters,
  attachments: [],
  ask: null,
  onAskConsumed: vi.fn(),
  onRunning: vi.fn(),
  onComplete: vi.fn(),
  onOpenSource: vi.fn(),
})
let history: RecallHistory
beforeEach(() => {
  vi.clearAllMocks()
  history = { thread, messages: [], sources: [] }
  vi.mocked(invoke).mockImplementation(command =>
    Promise.resolve(command === 'recall_thread_load' ? history : undefined)
  )
})
describe('Recall conversation runtime presentation', () => {
  it('reopens citations against retained source snapshots without running tools again', async () => {
    history = {
      thread: { ...thread, headMessageId: 'reply' },
      messages: [
        {
          id: 'question',
          parentId: null,
          role: 'user',
          contentJson: JSON.stringify([{ type: 'text', text: 'What was the plan?' }]),
          metadataJson: '{"custom":{}}',
          statusJson: null,
          createdAt: 1,
        },
        {
          id: 'reply',
          parentId: 'question',
          role: 'assistant',
          contentJson: JSON.stringify([{ type: 'text', text: 'Ship on Friday [1](#clip-1).' }]),
          metadataJson: JSON.stringify({
            custom: { citations: [{ number: 1, clipId: 'clip', revision: 'r1' }] },
          }),
          statusJson: '{"type":"complete","reason":"stop"}',
          createdAt: 2,
        },
      ],
      sources: [
        {
          id: 'source',
          messageId: 'reply',
          clipId: 'clip',
          available: false,
          assetHash: null,
          snapshotJson: JSON.stringify({
            clip: { id: 'clip', revision: 'r1' },
            kind: 'captured',
            text: 'Friday release plan',
          }),
        },
      ],
    }
    const run = vi.fn()
    vi.mocked(createRecallAdapter).mockReturnValue({ run })
    const options = props()
    render(<RecallChat {...options} />)
    fireEvent.click(await screen.findByRole('button', { name: 'recallPage.citation' }))
    expect(screen.getByText('Friday release plan').closest('details')).toHaveAttribute('open')
    expect(screen.getByText('recallPage.missingSource')).toBeInTheDocument()
    expect(options.onOpenSource).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
  it('renders tool candidates while the answer is still streaming', async () => {
    let finish: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      finish = resolve
    })
    const content = [
      {
        type: 'tool-call' as const,
        toolCallId: 'search',
        toolName: 'search_clips',
        args: { query: 'deployment' },
        argsText: '{"query":"deployment"}',
        result: {
          items: [{ clip: { id: 'clip' }, snippet: 'Deployment checklist' }],
          exhaustive: true,
        },
      },
    ]
    vi.mocked(createRecallAdapter).mockReturnValue({
      run: async function* () {
        yield { content }
        await gate
        yield {
          content: [...content, { type: 'text' as const, text: 'Found your notes.' }],
          status: { type: 'complete', reason: 'stop' },
        }
      },
    })
    render(<RecallChat {...props()} />)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'recallPage.message' })).not.toBeDisabled()
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'recallPage.message' }), {
      target: { value: 'Find deployment notes' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'recallPage.send' }))
    expect(await screen.findByText('Deployment checklist')).toBeInTheDocument()
    expect(screen.queryByText('Found your notes.')).toBeNull()
    expect(screen.getByRole('button', { name: 'recallPage.copy' })).toBeEnabled()
    await act(async () => {
      finish()
      await gate
    })
    expect(await screen.findByText('Found your notes.')).toBeInTheDocument()
  })
})
