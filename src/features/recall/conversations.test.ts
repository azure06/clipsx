import { describe, expect, it, vi } from 'vitest'
import type { ConversationStore } from './conversations'
import {
  createConversationAdapters,
  createConversationThreadAdapter,
  decodeMessage,
  encodeMessage,
} from './conversations'
import type { RecallHistory, RecallThread } from './contracts.generated'
import { fixtureContext } from './runtime/fixtures/context'
import type { ThreadMessage } from '@assistant-ui/react'

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
}
const message: ThreadMessage = {
  id: 'question',
  role: 'user',
  content: [{ type: 'text', text: 'Find the clip' }],
  attachments: [],
  createdAt: new Date(1),
  metadata: { custom: {} },
}
function storeFixture() {
  const history: RecallHistory = { thread, messages: [], sources: [] }
  const store: ConversationStore = {
    initialize: vi.fn(() => Promise.resolve(thread)),
    list: vi.fn(() => Promise.resolve([thread])),
    load: vi.fn(() => Promise.resolve(history)),
    update: vi.fn(() => Promise.resolve(thread)),
    delete: vi.fn(() => Promise.resolve()),
    append: vi.fn(() => Promise.resolve()),
    start: vi.fn(() => Promise.resolve()),
    checkpoint: vi.fn(() => Promise.resolve()),
  }
  return { store, history }
}
describe('Local conversation adapters', () => {
  it('saves the user before starting a run and checkpoints the same reply without replay', async () => {
    const { store } = storeFixture()
    const { history, hooks } = createConversationAdapters('thread', store)
    expect(await history.load()).toMatchObject({ unstable_resume: false, messages: [] })
    await hooks.onStart?.(fixtureContext(), {
      messages: [message],
      abortSignal: new AbortController().signal,
      runConfig: {},
      context: { tools: {}, config: {} },
      unstable_assistantMessageId: 'reply',
      unstable_getMessage: () => message,
    })
    expect(store.append).toHaveBeenCalledExactlyOnceWith('thread', encodeMessage(message, null))
    expect(vi.mocked(store.append).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(store.start).mock.invocationCallOrder[0]!
    )
    expect(store.start).toHaveBeenCalledWith({
      threadId: 'thread',
      runId: 'fixture',
      messageId: 'reply',
      parentId: 'question',
    })
    await hooks.onCheckpoint?.('fixture', { content: [{ type: 'text', text: 'partial' }] }, false)
    await hooks.onCheckpoint?.(
      'fixture',
      { content: [{ type: 'text', text: 'done' }], status: { type: 'complete', reason: 'stop' } },
      true
    )
    expect(
      vi
        .mocked(store.checkpoint)
        .mock.calls.map(([request]) => [request.sequence, request.terminal])
    ).toEqual([
      [1, false],
      [2, true],
    ])
    await hooks.onCheckpoint?.('fixture', { content: [] }, false)
    expect(store.checkpoint).toHaveBeenCalledTimes(2)
  })
  it('loads parent-linked branches and finalizes interrupted tools without resuming', async () => {
    const { store, history } = storeFixture()
    history.thread = { ...thread, headMessageId: 'edited' }
    history.messages = [
      encodeMessage(message, null),
      {
        id: 'reply',
        parentId: 'question',
        role: 'assistant',
        contentJson: JSON.stringify([
          {
            type: 'tool-call',
            toolCallId: 'call',
            toolName: 'create_clip',
            args: { text: 'saved' },
            argsText: '{}',
          },
        ]),
        metadataJson: '{"custom":{"interrupted":true}}',
        statusJson: '{"type":"incomplete","reason":"other"}',
        createdAt: 2,
      },
      { ...encodeMessage(message, null), id: 'edited' },
    ]
    const loaded = await createConversationAdapters('thread', store).history.load()
    expect(loaded.headId).toBe('edited')
    expect(loaded.messages[1]?.parentId).toBe('question')
    expect(loaded.messages[1]?.message.content[0]).toMatchObject({
      isError: true,
      result: { error: 'interrupted' },
    })
    expect(loaded.unstable_resume).toBe(false)
    expect(() =>
      decodeMessage({
        ...history.messages[0]!,
        contentJson: '[{"type":"file","data":"https://bad.invalid"}]',
      })
    ).toThrow()
  })
  it('preserves independent model/web selections while renaming or archiving', async () => {
    const { store, history } = storeFixture()
    history.thread = { ...thread, webEnabled: true, reasoning: { kind: 'effort', value: 'high' } }
    const adapter = createConversationThreadAdapter(store)
    await adapter.rename('thread', 'New title')
    expect(store.update).toHaveBeenCalledWith({
      threadId: 'thread',
      title: 'New title',
      archived: false,
      presetId: 'preset',
      webEnabled: true,
      reasoning: { kind: 'effort', value: 'high' },
    })
    await adapter.archive('thread')
    expect(store.update).toHaveBeenLastCalledWith({
      threadId: 'thread',
      title: '',
      archived: true,
      presetId: 'preset',
      webEnabled: true,
      reasoning: { kind: 'effort', value: 'high' },
    })
    await adapter.delete('thread')
    expect(store.delete).toHaveBeenCalledWith('thread')
  })
})
