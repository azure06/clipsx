import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAuiState,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  AuiIf,
} from '@assistant-ui/react'
import type {
  TextMessagePartProps,
  ToolCallMessagePartProps,
  ReasoningMessagePartProps,
} from '@assistant-ui/react'
import {
  Sparkles,
  Search,
  ArrowUp,
  Square,
  LoaderCircle,
  Check,
  CircleAlert,
  Brain,
} from 'lucide-react'
import { Button } from '../../shared/components/ui'
import type {
  AiModelPreset,
  ClipFilters,
  ClipRevision,
  RecallThread,
  RecallSourceSnapshot,
} from './contracts.generated'
import { createRecallAdapter } from './runtime/adapter'
import { conversationStore, createConversationAdapters } from './conversations'
import { isRecord } from './runtime/tools'
import { SavedSource } from './SavedSource'
import { EvidenceMarkdown, ToolSearchResults } from './RecallEvidence'
import { readCitations } from './runtime/citations'
import type { ClipboardCitation } from './runtime/citations'

const SavedSources = createContext<{ threadId: string; sources: RecallSourceSnapshot[] }>({
  threadId: '',
  sources: [],
})
const CitationSelection = createContext<{
  selected: number | null
  activation: number
  select: (number: number) => void
}>({ selected: null, activation: 0, select: () => {} })
const OpenSource = createContext<(id: string) => void>(() => {})
const textClass =
  'w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/50 dark:border-white/10 dark:bg-white/5'
function MarkdownText({ text }: TextMessagePartProps) {
  const custom = useAuiState(s => s.message.metadata.custom)
  const messageId = useAuiState(s => s.message.id)
  const saved = useContext(SavedSources)
  const open = useContext(OpenSource)
  const { select } = useContext(CitationSelection)
  return (
    <EvidenceMarkdown
      text={text}
      citations={readCitations(custom['citations'])}
      onCitation={citation => {
        if (
          saved.sources.some(
            source => source.messageId === messageId && matchesCitation(source, citation)
          )
        )
          select(citation.number)
        else open(citation.clipId)
      }}
    />
  )
}
function matchesCitation(source: RecallSourceSnapshot, citation: ClipboardCitation) {
  if (source.clipId !== citation.clipId) return false
  try {
    const snapshot: unknown = JSON.parse(source.snapshotJson)
    if (!isRecord(snapshot)) return false
    const revision = isRecord(snapshot['clip'])
      ? snapshot['clip']['revision']
      : snapshot['revision']
    return revision === citation.revision
  } catch {
    return false
  }
}
function ReasoningActivity({ text }: ReasoningMessagePartProps) {
  const { t } = useTranslation()
  if (!text) return null
  return (
    <details className="my-2 rounded-lg border border-slate-200/70 bg-slate-100/30 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[.02]">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-slate-500 outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50">
        <Brain size={13} aria-hidden="true" />
        {t('recallOptions.reasoningOutput')}
      </summary>
      <p className="mt-2 text-[10px] text-slate-500">{t('recallOptions.reasoningOutputHelp')}</p>
      <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-slate-600 dark:text-slate-300">
        {text}
      </div>
    </details>
  )
}
function ToolActivity({ toolName, result, status }: ToolCallMessagePartProps) {
  const { t } = useTranslation()
  const open = useContext(OpenSource)
  const saved = useContext(SavedSources)
  const messageId = useAuiState(s => s.message.id)
  const clip = isRecord(result) && isRecord(result['clip']) ? result['clip'] : null
  const clipId =
    clip && typeof clip['id'] === 'string'
      ? clip['id']
      : isRecord(result) && typeof result['clipId'] === 'string'
        ? result['clipId']
        : null
  const actionId =
    isRecord(result) && typeof result['actionId'] === 'string' ? result['actionId'] : null
  const failed = status.type === 'incomplete' || (isRecord(result) && Boolean(result['error']))
  const actionClips =
    isRecord(result) && Array.isArray(result['clips'])
      ? result['clips'].flatMap((item: unknown) =>
          isRecord(item) && typeof item['clipId'] === 'string' ? [item['clipId']] : []
        )
      : []
  const canUndo = actionId && isRecord(result) && result['undoAvailable'] === true
  const undoRef = useRef(crypto.randomUUID())
  const [undoState, setUndoState] = useUndoState()
  return (
    <div className="my-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 text-xs shadow-2xs backdrop-blur-xs dark:border-white/10 dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-2">
        {status.type === 'running' ? (
          <span className="flex size-5 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300">
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
          </span>
        ) : failed ? (
          <span className="flex size-5 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
            <CircleAlert size={13} aria-hidden="true" />
          </span>
        ) : (
          <span className="flex size-5 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
            <Check size={13} aria-hidden="true" />
          </span>
        )}
        <span className="font-semibold text-slate-800 dark:text-slate-200">
          {t(`recallPage.tools.${toolName}`, { defaultValue: t('recallPage.toolActivity') })}
        </span>
        <span className="text-[11px] text-slate-500">
          {status.type === 'running'
            ? t('recallPage.working')
            : failed
              ? t('recallPage.actionFailed')
              : t('recallPage.finished')}
        </span>
      </div>
      {toolName === 'search_clips' && <ToolSearchResults result={result} open={open} />}
      {actionClips.map(id => (
        <Button
          key={id}
          size="sm"
          variant="ghost"
          className="mt-1 h-6 rounded-md px-2 text-xs"
          onClick={() => open(id)}
        >
          {t('recallPage.openSource')} · {id.slice(0, 8)}
        </Button>
      ))}
      {clipId &&
        !saved.sources.some(
          source => source.messageId === messageId && source.clipId === clipId && !source.available
        ) && (
          <Button
            key={clipId}
            size="sm"
            variant="ghost"
            className="mt-1 h-6 rounded-md px-2 text-xs"
            onClick={() => open(clipId)}
          >
            {t('recallPage.openSource')}
          </Button>
        )}
      {canUndo && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 h-6 rounded-md px-2 text-xs"
          disabled={undoState === 'busy' || undoState === 'done'}
          onClick={() => {
            setUndoState('busy')
            void invoke('assistant_undo_action', {
              request: { requestId: undoRef.current, actionId },
            })
              .then(() => setUndoState('done'))
              .catch(() => setUndoState('error'))
          }}
        >
          {undoState === 'done' ? t('recallPage.undone') : t('recallPage.undo')}
        </Button>
      )}
      {undoState === 'error' && (
        <p role="alert" className="mt-1 text-xs text-red-500">
          {t('recallPage.undoFailed')}
        </p>
      )}
    </div>
  )
}
function useUndoState() {
  return useState<'ready' | 'busy' | 'done' | 'error'>('ready')
}
function SavedEvidence() {
  const { t } = useTranslation()
  const messageId = useAuiState(s => s.message.id)
  const custom = useAuiState(s => s.message.metadata.custom)
  const { threadId, sources } = useContext(SavedSources)
  const open = useContext(OpenSource)
  const { selected, activation } = useContext(CitationSelection)
  const citations = readCitations(custom['citations'])
  const evidence = sources.filter(
    source =>
      source.messageId === messageId &&
      (!Array.isArray(custom['citations']) || citations.some(c => matchesCitation(source, c)))
  )
  const selectedSource = evidence.find(source =>
    citations.some(c => c.number === selected && matchesCitation(source, c))
  )
  if (!evidence.length) return null
  return (
    <div className="mt-3 space-y-1">
      <p className="text-[10px] font-medium text-slate-500">{t('recallPage.inspectedSources')}</p>
      {evidence.map(source => (
        <SavedSource
          key={source.id}
          source={source}
          threadId={threadId}
          open={open}
          citation={citations.find(c => matchesCitation(source, c))?.number}
          selected={selectedSource?.id === source.id}
          activation={activation}
        />
      ))}
    </div>
  )
}
function TranscriptMessage() {
  const { t } = useTranslation()
  const [selection, setSelection] = useState({ selected: null as number | null, activation: 0 })
  const role = useAuiState(s => s.message.role)
  const custom = useAuiState(s => s.message.metadata.custom)
  return (
    <CitationSelection.Provider
      value={{
        ...selection,
        select: selected =>
          setSelection(previous => ({ selected, activation: previous.activation + 1 })),
      }}
    >
      <MessagePrimitive.Root
        className={`rounded-xl p-3 ${
          role === 'user'
            ? 'ml-auto max-w-[85%] border border-violet-200/80 bg-violet-50/50 dark:border-violet-500/20 dark:bg-violet-950/30'
            : 'mr-auto w-full'
        }`}
      >
        <AuiIf condition={s => !s.message.composer.isEditing}>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold">
            {role === 'user' ? (
              <span className="text-violet-600 dark:text-violet-400">{t('recallPage.you')}</span>
            ) : (
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <Sparkles size={12} className="text-violet-500" aria-hidden="true" />
                {t('recallPage.assistant')}
              </span>
            )}
          </div>
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              Reasoning: ReasoningActivity,
              tools: { Fallback: ToolActivity },
            }}
          />
          <SavedEvidence />
          {typeof custom['model'] === 'string' && (
            <p className="mt-2 text-[10px] text-slate-400">
              {String(custom['provider'])} · {custom['model']}
            </p>
          )}
          {custom['toolsUnavailable'] === true && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
              {t('recallPage.toolsUnavailable')}
            </p>
          )}
          {custom['contextOmitted'] === true && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
              {t('recallPage.contextOmitted')}
            </p>
          )}
          {custom['webRoute'] === 'unavailable' && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
              {t('recallPage.webUnavailable')}
            </p>
          )}
          {custom['interrupted'] === true && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
              {t('recallPage.interrupted')}
            </p>
          )}
          <AuiIf condition={s => s.message.status?.type === 'incomplete'}>
            <p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-300">
              {t('recallPage.incomplete')}
            </p>
          </AuiIf>
          <ActionBarPrimitive.Root className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-1.5 dark:border-white/5">
            <ActionBarPrimitive.Edit asChild>
              <Button size="sm" variant="ghost" className="h-6 rounded-md px-2 text-xs">
                {t('recallPage.edit')}
              </Button>
            </ActionBarPrimitive.Edit>
            {role === 'assistant' && (
              <ActionBarPrimitive.Reload asChild>
                <Button size="sm" variant="ghost" className="h-6 rounded-md px-2 text-xs">
                  {t('recallPage.regenerate')}
                </Button>
              </ActionBarPrimitive.Reload>
            )}
            <BranchPickerPrimitive.Root className="flex items-center gap-1">
              <BranchPickerPrimitive.Previous asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 rounded-md px-1.5 text-xs"
                  aria-label={t('recallPage.previousBranch')}
                >
                  ‹
                </Button>
              </BranchPickerPrimitive.Previous>
              <span className="text-xs text-slate-500">
                <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
              </span>
              <BranchPickerPrimitive.Next asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 rounded-md px-1.5 text-xs"
                  aria-label={t('recallPage.nextBranch')}
                >
                  ›
                </Button>
              </BranchPickerPrimitive.Next>
            </BranchPickerPrimitive.Root>
          </ActionBarPrimitive.Root>
        </AuiIf>
        <AuiIf condition={s => s.message.composer.isEditing}>
          <ComposerPrimitive.Root>
            <ComposerPrimitive.Input className={textClass} aria-label={t('recallPage.edit')} />
            <div className="mt-2 flex gap-2">
              <ComposerPrimitive.Send asChild>
                <Button size="sm" className="h-7 rounded-lg text-xs">
                  {t('recallPage.saveEdit')}
                </Button>
              </ComposerPrimitive.Send>
              <ComposerPrimitive.Cancel asChild>
                <Button size="sm" variant="ghost" className="h-7 rounded-lg text-xs">
                  {t('common.cancel')}
                </Button>
              </ComposerPrimitive.Cancel>
            </div>
          </ComposerPrimitive.Root>
        </AuiIf>
      </MessagePrimitive.Root>
    </CitationSelection.Provider>
  )
}
export interface RecallChatProps {
  thread: RecallThread
  preset: AiModelPreset | null
  filters: ClipFilters
  attachments: ClipRevision[]
  ask: { id: string; text: string } | null
  onAskConsumed(this: void): void
  onRunning(this: void, running: boolean): void
  onComplete(this: void): void
  onOpenSource(this: void, id: string): void
  composerToolbar?: ReactNode
  composerAttachments?: ReactNode
  onOpenSearch?: () => void
}
export function RecallChat(props: RecallChatProps) {
  const { t } = useTranslation()
  const [sources, setSources] = useState<RecallSourceSnapshot[]>([])
  const [sourceVersion, setSourceVersion] = useState(0)
  useEffect(() => {
    let active = true
    const refresh = () =>
      void conversationStore
        .load(props.thread.id)
        .then(data => {
          if (active) setSources(data.sources)
        })
        .catch(() => undefined)
    refresh()
    const stops = ['clip-deleted', 'clip-updated'].map(event => listen(event, refresh))
    return () => {
      active = false
      void Promise.all(stops)
        .then(list => list.forEach(stop => stop()))
        .catch(() => undefined)
    }
  }, [props.thread.id, sourceVersion])
  const persistence = useMemo(() => createConversationAdapters(props.thread.id), [props.thread.id])
  const [controller] = useState(() => createChatController(props, persistence))
  useLayoutEffect(
    () =>
      controller.setProps({
        ...props,
        onComplete: () => {
          setSourceVersion(version => version + 1)
          props.onComplete()
        },
      }),
    [controller, props]
  )
  const adapter = controller.adapter
  const runtime = useLocalRuntime(adapter, {
    adapters: { history: persistence.history },
    maxSteps: 1,
  })
  const sent = useRef<string | null>(null)
  useEffect(() => {
    const notify = () => controller.onRunning(runtime.thread.getState().isRunning)
    notify()
    const unsubscribe = runtime.thread.subscribe(notify)
    return () => {
      unsubscribe()
      runtime.thread.cancelRun()
      controller.onRunning(false)
    }
  }, [runtime, controller])
  useEffect(() => {
    const submit = () => {
      if (
        !props.ask ||
        sent.current === props.ask.id ||
        !props.preset ||
        runtime.thread.getState().isLoading ||
        runtime.thread.getState().isRunning
      )
        return
      sent.current = props.ask.id
      runtime.thread.append(props.ask.text)
      props.onAskConsumed()
    }
    submit()
    return runtime.thread.subscribe(submit)
  }, [props, runtime])
  return (
    <OpenSource.Provider value={props.onOpenSource}>
      <SavedSources.Provider value={{ threadId: props.thread.id, sources }}>
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
            <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar [scrollbar-gutter:stable]">
              <AuiIf condition={s => s.thread.isEmpty}>
                <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-12 text-center">
                  <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/15 dark:text-violet-300">
                    <Sparkles size={24} aria-hidden="true" />
                  </div>
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                    {t('recallPage.chatEmpty')}
                  </h2>
                  <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {t('recallPage.chatHelp')}
                  </p>
                  <div className="mt-6 grid w-full gap-2.5 text-left sm:grid-cols-2">
                    {(['findExample', 'workExample'] as const).map(key => (
                      <div
                        key={key}
                        className="rounded-xl border border-slate-200/60 bg-slate-100/30 p-3 text-xs leading-relaxed text-slate-600 dark:border-white/10 dark:bg-slate-100/5 dark:text-slate-300"
                      >
                        {t(`recallPage.${key}`)}
                      </div>
                    ))}
                  </div>
                  {props.onOpenSearch && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-5 rounded-xl text-xs gap-1.5"
                      onClick={props.onOpenSearch}
                    >
                      <Search size={13} aria-hidden="true" />
                      {t('recallPage.browseClips')}
                    </Button>
                  )}
                </div>
              </AuiIf>
              <div className="mx-auto w-full max-w-3xl space-y-3">
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage: TranscriptMessage,
                    AssistantMessage: TranscriptMessage,
                  }}
                />
              </div>
              <AuiIf condition={s => s.thread.isRunning}>
                <div
                  role="status"
                  className="mx-auto mt-3 flex w-fit items-center gap-2 rounded-xl bg-violet-50/80 px-3.5 py-1.5 text-xs font-medium text-violet-700 shadow-2xs dark:bg-violet-950/40 dark:text-violet-300"
                >
                  <LoaderCircle
                    size={14}
                    className="animate-spin text-violet-500"
                    aria-hidden="true"
                  />
                  {t('recallPage.agentWorking')}
                </div>
              </AuiIf>
            </ThreadPrimitive.Viewport>
            <div className="shrink-0 p-3 sm:p-4">
              <div className="mx-auto w-full max-w-3xl rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 focus-within:ring-2 focus-within:ring-violet-500/50 dark:border-white/10 dark:bg-slate-100/5">
                {props.composerAttachments}
                <ComposerPrimitive.Root>
                  <ComposerPrimitive.Input
                    disabled={!props.preset}
                    className="max-h-48 min-h-[48px] w-full resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400 text-slate-800 dark:text-slate-100"
                    placeholder={t('recallPage.composerPlaceholder')}
                    aria-label={t('recallPage.message')}
                    rows={2}
                  />
                  <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                    <div className="min-w-0 flex-1">{props.composerToolbar}</div>
                    <div className="flex shrink-0 items-center gap-1">
                      <AuiIf condition={s => s.thread.isRunning}>
                        <ComposerPrimitive.Cancel asChild>
                          <Button size="sm" variant="outline" className="h-8 px-2">
                            <Square size={12} aria-hidden="true" />
                            {t('recallPage.stop')}
                          </Button>
                        </ComposerPrimitive.Cancel>
                      </AuiIf>
                      <AuiIf condition={s => !s.thread.isRunning}>
                        <ComposerPrimitive.Send asChild>
                          <Button
                            size="sm"
                            className="size-8 px-0"
                            disabled={!props.preset}
                            aria-label={t('recallPage.send')}
                          >
                            <ArrowUp size={15} aria-hidden="true" />
                          </Button>
                        </ComposerPrimitive.Send>
                      </AuiIf>
                    </div>
                  </div>
                </ComposerPrimitive.Root>
              </div>
              <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[10px] text-slate-400">
                {props.preset ? t('recallPage.composerHelp') : t('recallPage.setupHelp')}
              </p>
            </div>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      </SavedSources.Provider>
    </OpenSource.Provider>
  )
}

function createChatController(
  initial: RecallChatProps,
  persistence: ReturnType<typeof createConversationAdapters>
) {
  let current = initial
  const adapter = createRecallAdapter({
    configuration: () => ({
      presetId: current.preset?.id ?? '',
      filters: current.filters,
      attachments: current.attachments,
      webEnabled: current.thread.webEnabled,
      reasoning: current.thread.reasoning ?? null,
    }),
    ...persistence.hooks,
    onCheckpoint: async (id, result, terminal) => {
      await persistence.hooks.onCheckpoint?.(id, result, terminal)
      if (terminal) current.onComplete()
    },
  })
  return {
    adapter,
    setProps: (next: RecallChatProps) => {
      current = next
    },
    onRunning: (running: boolean) => current.onRunning(running),
  }
}
