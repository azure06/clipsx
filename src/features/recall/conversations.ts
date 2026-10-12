import { invoke } from '@tauri-apps/api/core'
import type {
  ChatModelRunOptions,
  ThreadHistoryAdapter,
  ThreadMessage,
  RemoteThreadListAdapter,
} from '@assistant-ui/react'
import { createAssistantStream } from 'assistant-stream'
import { z } from 'zod'
import type {
  RecallCheckpoint,
  RecallHistory,
  RecallMessage,
  RecallRunStart,
  RecallThread,
  RecallThreadUpdate,
} from './contracts.generated'
import type { RecallAdapterOptions } from './runtime/adapter'
import { isRecord } from './runtime/tools'

export interface ConversationStore {
  initialize(this: void, localId: string): Promise<RecallThread>
  list(this: void, offset: number): Promise<RecallThread[]>
  load(this: void, threadId: string): Promise<RecallHistory>
  update(this: void, request: RecallThreadUpdate): Promise<RecallThread>
  delete(this: void, threadId: string): Promise<void>
  append(this: void, threadId: string, message: RecallMessage): Promise<void>
  start(this: void, request: RecallRunStart): Promise<void>
  checkpoint(this: void, request: RecallCheckpoint): Promise<void>
}
export const conversationStore: ConversationStore = {
  initialize: localId => invoke('recall_thread_initialize', { localId }),
  list: offset => invoke('recall_thread_list', { offset }),
  load: threadId => invoke('recall_thread_load', { threadId }),
  update: request => invoke('recall_thread_update', { request }),
  delete: threadId => invoke('recall_thread_delete', { threadId }),
  append: (threadId, message) => invoke('recall_message_append', { threadId, message }),
  start: request => invoke('recall_run_start', { request }),
  checkpoint: request => invoke('recall_run_checkpoint', { request }),
}
export function encodeMessage(message: ThreadMessage, parentId: string | null): RecallMessage {
  return {
    id: message.id,
    parentId,
    role: message.role,
    contentJson: JSON.stringify(message.content),
    statusJson: message.role === 'assistant' ? JSON.stringify(message.status) : null,
    metadataJson: JSON.stringify(message.metadata),
    createdAt: message.createdAt.getTime(),
  }
}
export function decodeMessage(message: RecallMessage): ThreadMessage {
  const partSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('reasoning'), text: z.string() }),
    z.object({
      type: z.literal('source'),
      sourceType: z.literal('url'),
      id: z.string(),
      url: z.string(),
      title: z.string().optional(),
    }),
    z.object({
      type: z.literal('tool-call'),
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.record(z.string(), z.json()),
      argsText: z.string().default(''),
      result: z.unknown().optional(),
      isError: z.boolean().optional(),
    }),
  ])
  const content = z.array(partSchema).parse(JSON.parse(message.contentJson) as unknown)
  const metadata: unknown = JSON.parse(message.metadataJson)
  const status = message.statusJson
    ? z
        .discriminatedUnion('type', [
          z.object({ type: z.literal('running') }),
          z.object({ type: z.literal('complete'), reason: z.enum(['stop', 'unknown']) }),
          z.object({
            type: z.literal('incomplete'),
            reason: z.enum([
              'cancelled',
              'tool-calls',
              'length',
              'content-filter',
              'other',
              'error',
            ]),
          }),
        ])
        .parse(JSON.parse(message.statusJson) as unknown)
    : null
  if (
    !Array.isArray(content) ||
    !content.every(part => isRecord(part) && typeof part['type'] === 'string') ||
    !isRecord(metadata) ||
    !['user', 'assistant'].includes(message.role)
  )
    throw new Error('invalid_saved_message')
  // Rust validates typed parts on every write. Interrupted tools are terminal, never resumed.
  const parts = content.map(part => {
    if (isRecord(part) && part['type'] === 'tool-call' && !Object.hasOwn(part, 'result'))
      return { ...part, result: { error: 'interrupted' }, isError: true }
    return part
  })
  const base = {
    id: message.id,
    createdAt: new Date(message.createdAt),
    metadata: { custom: isRecord(metadata['custom']) ? metadata['custom'] : {} },
  }
  if (message.role === 'user')
    return {
      ...base,
      role: 'user',
      attachments: [],
      content: content.filter(part => part.type === 'text'),
    }
  return {
    ...base,
    role: 'assistant',
    content: parts,
    status: status ?? { type: 'incomplete', reason: 'other' },
    metadata: {
      ...base.metadata,
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
    },
  }
}

/** One adapter instance stays bound to one thread, including writes after a UI switch. */
export function createConversationAdapters(
  threadId: string,
  store: ConversationStore = conversationStore
) {
  const saved = new Set<string>()
  let queue = Promise.resolve()
  const write = (message: ThreadMessage, parentId: string | null) => {
    const operation = queue.then(async () => {
      await store.append(threadId, encodeMessage(message, parentId))
      saved.add(message.id)
    })
    queue = operation.catch(() => undefined)
    return operation
  }
  const history: ThreadHistoryAdapter = {
    load: async () => {
      const data = await store.load(threadId)
      data.messages.forEach(message => saved.add(message.id))
      return {
        headId: data.thread.headMessageId,
        messages: data.messages.map(message => ({
          parentId: message.parentId,
          message: decodeMessage(message),
        })),
        unstable_resume: false,
      }
    },
    append: item => write(item.message, item.parentId),
    update: item => write(item.message, item.parentId),
  }
  const sequences = new Map<string, number>()
  const hooks: Pick<RecallAdapterOptions, 'onStart' | 'onCheckpoint'> = {
    onStart: async (context, input: ChatModelRunOptions) => {
      await queue
      let parentId: string | null = null
      for (const message of input.messages) {
        if (message.role === 'system') continue
        if (!saved.has(message.id)) await write(message, parentId)
        parentId = message.id
      }
      const latest = input.messages[input.messages.length - 1]
      if (!latest || latest.role !== 'user' || !parentId || !input.unstable_assistantMessageId)
        throw new Error('missing_run_message')
      await store.start({
        threadId,
        runId: context.runId,
        messageId: input.unstable_assistantMessageId,
        parentId,
      })
      sequences.set(context.runId, 0)
    },
    onCheckpoint: async (runId, result, terminal) => {
      if (!sequences.has(runId)) return
      const sequence = sequences.get(runId)! + 1
      sequences.set(runId, sequence)
      await store.checkpoint({
        runId,
        sequence,
        contentJson: JSON.stringify(result.content ?? []),
        metadataJson: JSON.stringify(result.metadata ?? { custom: {} }),
        statusJson: result.status ? JSON.stringify(result.status) : null,
        terminal,
      })
      if (terminal) sequences.delete(runId)
    },
  }
  return { history, hooks }
}
export function createConversationThreadAdapter(
  store: ConversationStore = conversationStore
): RemoteThreadListAdapter {
  const metadata = (thread: RecallThread) => ({
    remoteId: thread.id,
    title: thread.title,
    status: thread.archived ? ('archived' as const) : ('regular' as const),
    lastMessageAt: new Date(thread.updatedAt),
  })
  const update = async (id: string, change: Partial<RecallThreadUpdate>) => {
    const { thread } = await store.load(id)
    await store.update({
      threadId: id,
      title: thread.title,
      archived: thread.archived,
      presetId: thread.presetId,
      webEnabled: thread.webEnabled,
      reasoning: thread.reasoning ?? null,
      ...change,
    })
  }
  return {
    list: async params => {
      const offset = Number(params?.after ?? 0)
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid_thread_cursor')
      const threads = await store.list(offset)
      return {
        threads: threads.map(metadata),
        ...(threads.length === 200 ? { nextCursor: String(offset + 200) } : {}),
      }
    },
    initialize: async localId => ({ remoteId: (await store.initialize(localId)).id }),
    rename: (id, title) => update(id, { title }),
    archive: id => update(id, { archived: true }),
    unarchive: id => update(id, { archived: false }),
    delete: id => store.delete(id),
    fetch: async id => metadata((await store.load(id)).thread),
    generateTitle: async (id, messages) => {
      const title =
        messages
          .find(m => m.role === 'user')
          ?.content.filter(p => p.type === 'text')
          .map(p => p.text)
          .join(' ')
          .trim()
          .slice(0, 64) ?? ''
      await update(id, { title })
      return createAssistantStream(async controller => {
        controller.appendText(title)
        await Promise.resolve()
      })
    },
  }
}
