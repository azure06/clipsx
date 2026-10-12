// Opt-in native driver: consumes the production adapter; never supplies mock IPC or HTTP.
import { invoke } from '@tauri-apps/api/core'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import type {
  ClipboardActionResult,
  ClipReadResult,
  ReasoningSelection,
} from '../../contracts.generated'
import { readCitations } from '../citations'
import { isRecord } from '../tools'
import { conversationStore, createConversationAdapters } from '../../conversations'
import { createRecallAdapter } from '../adapter'
import { nativeAgentBridge } from '../native'
import { createRustFetch } from '../transport'

const requests: { tools: string[]; choice: unknown }[] = []
const completedTools: { name: string; failed: boolean }[] = []

function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code)
}

async function verify() {
  const { phase, fixture } = await invoke<{
    phase: string
    fixture: {
      presetId: string
      sourceId: string
      imageId: string
      imageRepresentationId: string
      reasoning?: ReasoningSelection | null
    }
  }>('acceptance_probe_info')
  const configuration = () => ({
    presetId: fixture.presetId,
    filters: null,
    attachments: [],
    webEnabled: false,
    reasoning: fixture.reasoning ?? null,
  })
  const thread = await conversationStore.initialize('native-acceptance-main')
  if (phase === 'restart') {
    const history = await conversationStore.load(thread.id)
    check(
      history.messages.some(message => message.contentJson.includes('ORCHID-42')),
      'conversation_not_retained'
    )
    check(
      history.sources.some(
        source =>
          source.clipId === fixture.sourceId &&
          !source.available &&
          source.snapshotJson.includes('ORCHID-42')
      ),
      'source_snapshot_not_retained'
    )
    const interrupted = await conversationStore.initialize('native-acceptance-interrupted')
    const interruptedHistory = await conversationStore.load(interrupted.id)
    check(
      interruptedHistory.messages.some(message =>
        message.metadataJson.includes('"interrupted":true')
      ),
      'run_not_interrupted'
    )
    const image = interruptedHistory.sources.find(source => source.assetHash)
    check(image, 'image_snapshot_missing')
    const bytes = await invoke<string>('recall_snapshot_image', {
      threadId: interrupted.id,
      snapshotId: image.id,
    })
    check(bytes.length > 0, 'image_snapshot_not_readable')
    let denied = false
    try {
      await invoke('assistant_read_clip', { request: { clipId: fixture.sourceId } })
    } catch {
      denied = true
    }
    check(denied, 'deleted_source_still_readable')
    await invoke('acceptance_probe_finish', {
      report: {
        passed: true,
        phase,
        conversationRetained: true,
        missingSourceLabel: true,
        imageSnapshotRetained: true,
        interruptedRun: true,
        userAgent: navigator.userAgent,
      },
    })
    return
  }
  const { hooks } = createConversationAdapters(thread.id)
  const outcomes = new Map<string, unknown>()
  const adapter = createRecallAdapter({
    configuration,
    ...hooks,
    transport: runId => {
      const transport = createRustFetch(runId)
      return (url, init) => {
        check(typeof init?.body === 'string', 'expected_json_request')
        const body = JSON.parse(init.body) as {
          tools?: { function?: { name?: string } }[]
          tool_choice?: unknown
        }
        requests.push({
          tools: body.tools?.flatMap(tool => tool.function?.name ?? []) ?? [],
          choice: body.tool_choice,
        })
        return transport(url, init)
      }
    },
    onResult: (name, result) => {
      outcomes.set(name, result)
      completedTools.push({ name, failed: isRecord(result) && typeof result['error'] === 'string' })
    },
  })
  const user: ThreadMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    createdAt: new Date(),
    attachments: [],
    metadata: { custom: {} },
    content: [
      {
        type: 'text',
        text: 'Use search_clips with query "native acceptance", then read_clip on the matching text clip. Call create_clip with text="NATIVE ACCEPTANCE SAVED", format="plain_text", and sources containing the clip ID, representation ID, and representation fingerprint from read_clip. Finally report the launch code and committed saved clip ID. Perform the tools.',
      },
    ],
  }
  const input: ChatModelRunOptions = {
    messages: [user],
    abortSignal: new AbortController().signal,
    runConfig: {},
    context: { tools: {}, config: {} },
    unstable_assistantMessageId: crypto.randomUUID(),
    unstable_getMessage: () => {
      throw new Error('no_pending_message')
    },
  }
  const updates = adapter.run(input)
  check('next' in updates, 'streaming_adapter_required')
  let last: ChatModelRunResult | undefined
  for await (const update of updates) last = update
  check(last?.status?.type === 'complete', 'model_run_incomplete')
  const answer =
    last.content
      ?.filter(part => part.type === 'text')
      .map(part => part.text)
      .join('') ?? ''
  check(answer.includes('ORCHID-42'), 'answer_not_grounded')
  check(
    outcomes.has('search_clips') && outcomes.has('read_clip') && outcomes.has('create_clip'),
    'model_tools_missing'
  )
  const created = outcomes.get('create_clip') as ClipboardActionResult
  check(Array.isArray(created.clips) && created.clips.length === 1, 'generated_clip_missing')
  const generated = await invoke<ClipReadResult>('assistant_read_clip', {
    request: { clipId: created.clips[0]!.clipId },
  })
  check(generated.text === 'NATIVE ACCEPTANCE SAVED', 'generated_text_mismatch')
  const read = outcomes.get('read_clip') as ClipReadResult
  check(read.clip.id === fixture.sourceId, 'wrong_source_read')
  const citation = readCitations(last.metadata?.custom?.['citations']).find(
    entry => entry.clipId === fixture.sourceId && entry.revision === read.clip.revision
  )
  check(citation, 'source_citation_missing')
  check(
    answer.includes(`[${citation.number}](#clip-${citation.number})`),
    'answer_citation_missing'
  )
  const persisted = await conversationStore.load(thread.id)
  check(
    persisted.messages.length === 2 &&
      persisted.sources.some(source => source.clipId === fixture.sourceId),
    'conversation_not_persisted'
  )
  const context = await nativeAgentBridge.begin({ ...configuration(), runId: crypto.randomUUID() })
  const mutation = {
    requestId: crypto.randomUUID(),
    clips: created.clips,
    favorite: true,
    addTags: ['Native acceptance'],
  }
  const organized = (await nativeAgentBridge.tool(
    context.runId,
    'organize_clips',
    mutation
  )) as ClipboardActionResult
  const replay = (await nativeAgentBridge.tool(
    context.runId,
    'organize_clips',
    mutation
  )) as ClipboardActionResult
  check(replay.actionId === organized.actionId, 'mutation_retry_not_idempotent')
  const organizedClip = await invoke<ClipReadResult>('assistant_read_clip', {
    request: { clipId: created.clips[0]!.clipId },
  })
  check(
    organizedClip.clip.favorite &&
      organizedClip.clip.tags.some(tag => tag.name === 'Native acceptance'),
    'organization_not_applied'
  )
  await nativeAgentBridge.tool(context.runId, 'undo_clipboard_action', {
    requestId: crypto.randomUUID(),
    actionId: organized.actionId,
  })
  const restored = await invoke<ClipReadResult>('assistant_read_clip', {
    request: { clipId: created.clips[0]!.clipId },
  })
  check(
    restored.clip.favorite === generated.clip.favorite &&
      JSON.stringify(restored.clip.tags) === JSON.stringify(generated.clip.tags),
    'organization_undo_not_restored'
  )
  await nativeAgentBridge.finish(context.runId)

  // Leave a real persisted run unfinished. The next process must interrupt, never replay, it.
  const interrupted = await conversationStore.initialize('native-acceptance-interrupted')
  const parentId = crypto.randomUUID()
  await conversationStore.append(interrupted.id, {
    id: parentId,
    parentId: null,
    role: 'user',
    contentJson: '[{"type":"text","text":"Inspect the synthetic image"}]',
    statusJson: null,
    metadataJson: '{}',
    createdAt: Date.now(),
  })
  const interruptedContext = await nativeAgentBridge.begin({
    ...configuration(),
    runId: crypto.randomUUID(),
  })
  await conversationStore.start({
    threadId: interrupted.id,
    runId: interruptedContext.runId,
    messageId: crypto.randomUUID(),
    parentId,
  })
  await nativeAgentBridge.tool(interruptedContext.runId, 'read_clip_image', {
    clipId: fixture.imageId,
    representationId: fixture.imageRepresentationId,
  })
  await invoke('acceptance_probe_finish', {
    report: {
      passed: true,
      phase,
      model: last.metadata?.custom?.['model'],
      reasoning: last.metadata?.custom?.['reasoning'],
      citations: true,
      searchReadCreate: true,
      generatedClipId: created.clips[0]!.clipId,
      savedConversation: true,
      imageSnapshot: true,
      idempotency: true,
      organizationUndo: true,
      userAgent: navigator.userAgent,
    },
  })
}
void verify().catch(async error => {
  const causes: { name: string; code?: string }[] = []
  let current: unknown = error
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    causes.push({
      name: current.name,
      ...(/^Recall transport: [a-z_]+$/.test(current.message)
        ? { code: current.message.slice('Recall transport: '.length) }
        : {}),
    })
    current = current.cause
  }
  await invoke('acceptance_probe_finish', {
    report: {
      passed: false,
      failure:
        error instanceof Error
          ? error.message
          : isRecord(error) &&
              typeof error['code'] === 'string' &&
              /^[a-z_]{1,64}$/.test(error['code'])
            ? `native_${error['code']}`
            : 'native_operation_failed',
      causes,
      completedTools,
      requests,
      userAgent: navigator.userAgent,
    },
  })
})
