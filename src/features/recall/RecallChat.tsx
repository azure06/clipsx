import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { RecallSplitView } from './RecallSplitView'
import { RecallContext } from './RecallContext'
import type { ContextSelection } from './RecallContext'
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
  PanelRight,
  X,
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
import { EvidenceMarkdown } from './RecallEvidence'
import { readCitations } from './runtime/citations'

const SavedSources = createContext<{ threadId: string; sources: RecallSourceSnapshot[] }>({
  threadId: '',
  sources: [],
})
const SelectContext = createContext<(messageId: string, citation?: number) => void>(() => {})
const OpenSource = createContext<(id: string) => void>(() => {})
const AttachmentActions = createContext<{ count: number; clear: () => void }>({
  count: 0,
  clear: () => {},
})
const textClass =
  'w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/50 dark:border-white/10 dark:bg-white/5'
function MarkdownText({ text }: TextMessagePartProps) {
  const custom = useAuiState(s => s.message.metadata.custom)
  const messageId = useAuiState(s => s.message.id)
  const select = useContext(SelectContext)
  return (
    <EvidenceMarkdown
      text={text}
      citations={readCitations(custom['citations'])}
      onCitation={citation => select(messageId, citation.number)}
    />
  )
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
  const selectContext = useContext(SelectContext)
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
      {toolName === 'search_clips' && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 h-6 px-2 text-xs"
          onClick={() => selectContext(messageId)}
        >
          {t('recallContext.viewContext')}
        </Button>
      )}
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
function TranscriptMessage() {
  const { t } = useTranslation()
  const selectContext = useContext(SelectContext)
  const attachmentActions = useContext(AttachmentActions)
  const messageId = useAuiState(s => s.message.id)
  const role = useAuiState(s => s.message.role)
  const custom = useAuiState(s => s.message.metadata.custom)
  const status = useAuiState(s => s.message.status)
  const incompleteKey =
    status?.type === 'incomplete'
      ? status.reason === 'cancelled'
        ? 'stopped'
        : status.reason === 'length'
          ? 'outputLimitReached'
          : status.reason === 'content-filter'
            ? 'responseFiltered'
            : [
                  'context_limit',
                  'question_exceeds_context',
                  'context_compaction_failed',
                  'context_overflow',
                ].includes(String(custom['failure']))
              ? 'contextBlocked'
              : custom['failure'] === 'request_timeout'
                ? 'requestTimedOut'
                : custom['failure'] === 'citation_validation_failed'
                  ? 'citationValidationFailed'
                  : 'responseFailed'
      : 'incomplete'
  return (
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
        {role === 'assistant' && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 h-6 px-2 text-xs"
            onClick={() => selectContext(messageId)}
          >
            <PanelRight size={12} aria-hidden="true" />
            {t('recallContext.viewContext')}
          </Button>
        )}
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
        {isRecord(custom['contextStatus']) &&
          ['compacting', 'compacted'].includes(String(custom['contextStatus']['state'])) && (
            <p role="status" className="mt-1 text-xs text-slate-500">
              {t(
                custom['contextStatus']['state'] === 'compacting'
                  ? 'recallReliability.compacting'
                  : 'recallReliability.compacted'
              )}
            </p>
          )}
        {custom['limitsEstimated'] === true && (
          <p className="mt-1 text-xs text-slate-500">{t('recallReliability.unverifiedLimits')}</p>
        )}
        {custom['contextOmitted'] === true && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
            {t('recallPage.contextOmitted')}
          </p>
        )}
        {typeof custom['shortenedSources'] === 'number' && custom['shortenedSources'] > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
            {t('recallPage.evidenceShortened', { count: custom['shortenedSources'] })}
          </p>
        )}
        {typeof custom['omittedSources'] === 'number' && custom['omittedSources'] > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
            {t('recallPage.evidenceOmitted', { count: custom['omittedSources'] })}
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
            {t(`recallPage.${incompleteKey}`)}
          </p>
          {incompleteKey === 'contextBlocked' && attachmentActions.count > 0 && (
            <ActionBarPrimitive.Reload asChild>
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-7 px-2 text-xs"
                onClick={attachmentActions.clear}
              >
                {t('recallPage.removeAttachmentsAndRegenerate')}
              </Button>
            </ActionBarPrimitive.Reload>
          )}
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
  )
}
export interface RecallChatProps {
  thread: RecallThread
  initializeThread?: () => Promise<string>
  preset: AiModelPreset | null
  filters: ClipFilters
  attachments: ClipRevision[]
  ask: { id: string; text: string; retrieve?: boolean } | null
  onAskConsumed(this: void): void
  onClearAttachments?(this: void): void
  onRunning(this: void, running: boolean): void
  onComplete(this: void): void
  onOpenSource(this: void, id: string): void
  composerToolbar?: ReactNode
  composerAttachments?: ReactNode
  contextOpen?: boolean
  onContextOpen?: () => void
  onContextClose?: () => void
  suggestions?: ReactNode
  preview?: ReactNode
  initialDraft?: string
  onDraft?: (text: string) => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
}
export function RecallChat(props: RecallChatProps) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<ContextSelection>({
    messageId: null,
    citation: null,
    activation: 0,
  })
  const contextClose = useRef<HTMLButtonElement | null>(null)
  const hadPreview = useRef(false)
  useEffect(() => {
    if (hadPreview.current && !props.preview && props.contextOpen) {
      if (document.activeElement === document.body) contextClose.current?.focus()
    }
    hadPreview.current = Boolean(props.preview)
  }, [props.preview, props.contextOpen])
  const selectContext = (messageId: string | null, citation?: number) => {
    setSelection(previous => ({
      messageId,
      citation: citation ?? null,
      activation: previous.activation + 1,
    }))
    props.onContextOpen?.()
  }
  const [sources, setSources] = useState<RecallSourceSnapshot[]>([])
  const [sourceVersion, setSourceVersion] = useState(0)
  useEffect(() => {
    let active = true
    const refresh = () =>
      !props.thread.id.startsWith('draft:') &&
      void conversationStore
        .load(props.thread.id)
        .then(data => {
          if (active) setSources(data.sources)
        })
        .catch(() => undefined)
    refresh()
    const stops = ['clip-deleted', 'clip-updated', 'clip-facets-updated'].map(event =>
      listen(event, refresh)
    )
    return () => {
      active = false
      void Promise.all(stops)
        .then(list => list.forEach(stop => stop()))
        .catch(() => undefined)
    }
  }, [props.thread.id, sourceVersion])
  // Keep the runtime and queued writes mounted when a draft acquires its database ID.
  const [persistence] = useState(() =>
    createConversationAdapters(props.thread.id, conversationStore, props.initializeThread)
  )
  const [controller] = useState(() =>
    createChatController(props, persistence, () => setSourceVersion(version => version + 1))
  )
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
  const draftSeeded = useRef(false)
  useEffect(() => {
    if (!draftSeeded.current) {
      draftSeeded.current = true
      if (props.initialDraft) runtime.thread.composer.setText(props.initialDraft)
    }
    const notify = () => controller.onDraft(runtime.thread.composer.getState().text)
    notify()
    return runtime.thread.composer.subscribe(notify)
  }, [runtime, controller, props.initialDraft])
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
      controller.prepareInitialRetrieval(props.ask.retrieve ? props.ask.text : undefined)
      runtime.thread.append(props.ask.text)
      props.onAskConsumed()
    }
    submit()
    return runtime.thread.subscribe(submit)
  }, [props, runtime, controller])
  return (
    <OpenSource.Provider value={props.onOpenSource}>
      <SavedSources.Provider value={{ threadId: props.thread.id, sources }}>
        <AssistantRuntimeProvider runtime={runtime}>
          <SelectContext.Provider value={selectContext}>
            <RecallSplitView open={Boolean(props.contextOpen)}>
              <ThreadPrimitive.Root className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
                    </div>
                  </AuiIf>
                  <div className="mx-auto w-full max-w-3xl space-y-3">
                    <AttachmentActions.Provider
                      value={{
                        count: props.attachments.length,
                        clear: controller.clearAttachments,
                      }}
                    >
                      <ThreadPrimitive.Messages
                        components={{
                          UserMessage: TranscriptMessage,
                          AssistantMessage: TranscriptMessage,
                        }}
                      />
                    </AttachmentActions.Provider>
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
                        onCompositionStart={props.onCompositionStart}
                        onCompositionEnd={props.onCompositionEnd}
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
              {props.contextOpen && (
                <aside
                  className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                  aria-label={t('recallContext.title')}
                >
                  {!props.preview && (
                    <div className="flex shrink-0 items-center justify-between p-3 pb-2">
                      <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {t('recallContext.title')}
                      </h2>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 px-0"
                        aria-label={t('recallContext.close')}
                        ref={contextClose}
                        onClick={props.onContextClose}
                      >
                        <X size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <RecallContext
                      threadId={props.thread.id}
                      sources={sources}
                      suggestions={props.suggestions}
                      preview={props.preview}
                      selection={selection}
                      onSelect={selectContext}
                      open={props.onOpenSource}
                    />
                  </div>
                </aside>
              )}
            </RecallSplitView>
          </SelectContext.Provider>
        </AssistantRuntimeProvider>
      </SavedSources.Provider>
    </OpenSource.Provider>
  )
}

function createChatController(
  initial: RecallChatProps,
  persistence: ReturnType<typeof createConversationAdapters>,
  refreshSources: () => void
) {
  let current = initial
  let pendingRetrieval: string | undefined
  const adapter = createRecallAdapter({
    initialRetrieval: () => {
      const query = pendingRetrieval
      pendingRetrieval = undefined
      return query
    },
    configuration: () => ({
      presetId: current.preset?.id ?? '',
      filters: current.filters,
      attachments: current.attachments,
      webEnabled: current.thread.webEnabled,
      reasoning: current.thread.reasoning ?? null,
    }),
    ...persistence.hooks,
    onStart: async (context, input) => {
      await persistence.hooks.onStart?.(context, input)
      refreshSources()
    },
    onCheckpoint: async (id, result, terminal) => {
      await persistence.hooks.onCheckpoint?.(id, result, terminal)
      if (terminal) current.onComplete()
    },
  })
  return {
    adapter,
    prepareInitialRetrieval: (query: string | undefined) => {
      pendingRetrieval = query
    },
    setProps: (next: RecallChatProps) => {
      current = next
    },
    // Applies before the regenerate that follows, ahead of the parent re-render.
    clearAttachments: () => {
      current = { ...current, attachments: [] }
      current.onClearAttachments?.()
    },
    onRunning: (running: boolean) => current.onRunning(running),
    onDraft: (text: string) => current.onDraft?.(text),
  }
}
