import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
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
  contextOpen: true,
  onContextOpen: vi.fn(),
})
let history: RecallHistory
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  history = { thread, messages: [], sources: [] }
  vi.mocked(invoke).mockImplementation(command =>
    Promise.resolve(command === 'recall_thread_load' ? history : undefined)
  )
})
describe('Recall conversation runtime presentation', () => {
  it('starts a handed-off Recall question once', async () => {
    const run = vi.fn()
    const onAskConsumed = vi.fn()
    vi.mocked(createRecallAdapter).mockImplementation(() => ({
      run: async function* () {
        await Promise.resolve()
        run()
        yield {
          content: [{ type: 'text' as const, text: 'Found the notes.' }],
          status: { type: 'complete' as const, reason: 'stop' as const },
        }
      },
    }))
    const handoff = { ...props(), ask: { id: 'handoff-1', text: 'find notes' }, onAskConsumed }
    const view = render(<RecallChat {...handoff} />)
    expect(await screen.findByText('Found the notes.')).toBeInTheDocument()
    expect(onAskConsumed).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()
    view.rerender(<RecallChat {...handoff} />)
    expect(run).toHaveBeenCalledOnce()
  })
  it('keeps the running conversation mounted when its draft acquires a saved ID', async () => {
    const initialize = vi.fn()
    const run = vi.fn()
    vi.mocked(createRecallAdapter).mockImplementation(options => ({
      run: async function* (input) {
        run()
        await options.onStart?.(fixtureContext(), input)
        expect(input.abortSignal.aborted).toBe(false)
        const answer = {
          content: [{ type: 'text' as const, text: 'Your saved answer.' }],
          status: { type: 'complete' as const, reason: 'stop' as const },
        }
        await options.onCheckpoint?.(fixtureContext().runId, answer, true)
        yield answer
      },
    }))
    function DraftChat() {
      const [current, setCurrent] = useState({ ...thread, id: 'draft:local' })
      return (
        <RecallChat
          {...props()}
          thread={current}
          initializeThread={() => {
            initialize()
            setCurrent(thread)
            return Promise.resolve(thread.id)
          }}
        />
      )
    }
    render(<DraftChat />)
    const input = screen.getByRole('textbox', { name: 'recallPage.message' })
    await waitFor(() => expect(input).toBeEnabled())
    expect(initialize).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Save this conversation' } })
    fireEvent.click(screen.getByRole('button', { name: 'recallPage.send' }))
    expect(await screen.findByText('Your saved answer.')).toBeInTheDocument()
    expect(initialize).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()
    expect(createRecallAdapter).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith(
      'recall_message_append',
      expect.objectContaining({ threadId: thread.id })
    )
    const started = vi.mocked(invoke).mock.calls.find(([command]) => command === 'recall_run_start')
    expect(started?.[1]).toMatchObject({ request: { threadId: thread.id } })
  })
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
          contentJson: JSON.stringify([
            { type: 'reasoning', text: 'Provider-supplied summary.' },
            { type: 'text', text: 'Ship on Friday [1](#clip-1).' },
          ]),
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
    expect(screen.getByText('Provider-supplied summary.').closest('details')).not.toHaveAttribute(
      'open'
    )
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
  it('reports draft text and IME composition without running the model, even without a preset', async () => {
    const run = vi.fn()
    vi.mocked(createRecallAdapter).mockReturnValue({ run })
    const onDraft = vi.fn(),
      onCompositionStart = vi.fn(),
      onCompositionEnd = vi.fn()
    render(
      <RecallChat
        {...props()}
        preset={null}
        onDraft={onDraft}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
    )
    const input = screen.getByRole('textbox', { name: 'recallPage.message' })
    expect(input).toBeEnabled()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '検索' } })
    fireEvent.compositionEnd(input)
    await waitFor(() => expect(onDraft).toHaveBeenLastCalledWith('検索'))
    expect(onCompositionStart).toHaveBeenCalledOnce()
    expect(onCompositionEnd).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'recallPage.send' })).toBeDisabled()
    expect(run).not.toHaveBeenCalled()
  })
  it('selects the evidence for an older answer when its citation is clicked', async () => {
    const question = (id: string, parentId: string | null) => ({
      id,
      parentId,
      role: 'user',
      contentJson: JSON.stringify([{ type: 'text', text: id }]),
      metadataJson: '{"custom":{}}',
      statusJson: null,
      createdAt: 1,
    })
    const answer = (id: string, parentId: string, clipId: string) => ({
      id,
      parentId,
      role: 'assistant',
      contentJson: JSON.stringify([{ type: 'text', text: id + ' [1](#clip-1)' }]),
      metadataJson: JSON.stringify({
        custom: { citations: [{ number: 1, clipId, revision: 'r' }] },
      }),
      statusJson: '{"type":"complete","reason":"stop"}',
      createdAt: 2,
    })
    history = {
      thread: { ...thread, headMessageId: 'new-answer' },
      messages: [
        question('old-question', null),
        answer('old-answer', 'old-question', 'old-clip'),
        question('new-question', 'old-answer'),
        answer('new-answer', 'new-question', 'new-clip'),
      ],
      sources: ['old', 'new'].map(id => ({
        id,
        messageId: id + '-answer',
        clipId: id + '-clip',
        assetHash: null,
        available: false,
        snapshotJson: JSON.stringify({
          clip: { id: id + '-clip', revision: 'r' },
          kind: 'captured',
          text: id + ' evidence',
        }),
      })),
    }
    const run = vi.fn()
    vi.mocked(createRecallAdapter).mockReturnValue({ run })
    render(<RecallChat {...props()} />)
    await screen.findByText('new evidence')
    expect(screen.queryByText('old evidence')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'recallPage.citation' })[0]!)
    expect(await screen.findByText('old evidence')).toBeInTheDocument()
    expect(screen.queryByText('new evidence')).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
})

it.each([
  ['cancelled', 'stopped'],
  ['length', 'outputLimitReached'],
  ['error', 'responseFailed'],
])('explains an incomplete %s reply', async (reason, key) => {
  history = {
    thread: { ...thread, headMessageId: 'answer' },
    sources: [],
    messages: [
      {
        id: 'question',
        parentId: null,
        role: 'user',
        contentJson: '[{"type":"text","text":"Find a clip"}]',
        metadataJson: '{"custom":{}}',
        statusJson: null,
        createdAt: 1,
      },
      {
        id: 'answer',
        parentId: 'question',
        role: 'assistant',
        contentJson: '[{"type":"reasoning","text":"Working"}]',
        metadataJson: '{"custom":{}}',
        statusJson: JSON.stringify({ type: 'incomplete', reason }),
        createdAt: 2,
      },
    ],
  }
  vi.mocked(createRecallAdapter).mockReturnValue({ run: vi.fn() })
  render(<RecallChat {...props()} />)
  expect(await screen.findByText('recallPage.' + key)).toBeInTheDocument()
})
