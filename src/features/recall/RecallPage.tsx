import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import * as Dialog from '@radix-ui/react-dialog'
import { Sparkles, PanelRight, X, SlidersHorizontal, Paperclip, PanelLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Select } from '../../shared/components/ui'
import { DocumentationLink } from '../../shared/components/DocumentationLink'
import { ClipPreview } from '../clipboard/ClipPreview'
import type { ClipDetail, ClipSummary } from '../../shared/types/v2'
import { useToast } from '../../shared/contexts/ToastContext'
import type {
  AiConfiguration,
  ClipboardFilters,
  ClipboardStatus,
  ClipFilters,
  ClipMatch,
  ClipRevision,
  RecallThread,
} from './contracts.generated'
import { emptyFilters, useProgressiveSearch } from './useProgressiveSearch'
import { RecallChat } from './RecallChat'
import { RecallOptions } from './RecallOptions'
import { ThreadSidebar } from './ThreadSidebar'
import {
  conversationStore,
  createConversationThreadAdapter,
  createDraftConversation,
} from './conversations'

export interface RecallPageProps {
  onInitialAskConsumed?: () => void
  initialAsk?: boolean
  initialQuery?: string
  initialFilters?: ClipFilters
}
export function RecallPage({
  initialQuery = '',
  initialFilters = emptyFilters,
  initialAsk = false,
  onInitialAskConsumed,
}: RecallPageProps) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [query, setQuery] = useState(initialQuery)
  const [draftSeed, setDraftSeed] = useState(initialQuery)
  const [filters, storeFilters] = useState(initialFilters)
  const [status, setStatus] = useState<ClipboardStatus | null>(null)
  const [facets, setFacets] = useState<ClipboardFilters | null>(null)
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null)
  const [threads, setThreads] = useState<RecallThread[]>([])
  const [thread, setThread] = useState<RecallThread | null>(null)
  const [draft, setDraft] = useState<ReturnType<typeof createDraftConversation> | null>(null)
  const [threadOffset, setThreadOffset] = useState(0)
  const [attachments, setAttachments] = useState<ClipRevision[]>([])
  const [ask, setAsk] = useState<{ id: string; text: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [contextOpen, setContextOpen] = useState(() => window.innerWidth >= 1280)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024)
  const [attachmentLabels, setAttachmentLabels] = useState<Record<string, string>>({})
  const busyRef = useRef(false)
  const [preview, setPreview] = useState<ClipSummary | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewRequest = useRef({ generation: 0 })
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const contextToggle = useRef<HTMLButtonElement | null>(null)
  const sidebarToggle = useRef<HTMLButtonElement | null>(null)
  const previewFocus = useRef<HTMLElement | null>(null)
  const threadAdapter = useMemo(() => createConversationThreadAdapter(), [])
  const search = useProgressiveSearch(
    query,
    filters,
    status?.semanticReady ?? false,
    undefined,
    Boolean(query.trim()) && !running
  )
  const setFilters = (next: import('react').SetStateAction<ClipFilters>) => {
    search.invalidate()
    storeFilters(next)
  }
  const changeQuery = useCallback((next: string) => {
    setDraftSeed('')
    setQuery(next)
  }, [])
  const selected = [...(search.keyword?.items ?? []), ...search.related].find(
    item => item.clip.id === search.selectedId
  )
  const presetId = thread?.presetId ?? configuration?.selections.defaultChat ?? null
  const preset =
    configuration?.presets.find(
      p =>
        p.id === presetId &&
        p.purpose === 'chat' &&
        configuration.connections.some(c => c.id === p.connectionId && c.enabled)
    ) ?? null
  const fail = useCallback(() => {
    toast({ title: t('recallPage.operationFailed'), type: 'error' })
  }, [toast, t])
  const reloadThreads = useCallback(async () => {
    const rows = await conversationStore.list(0)
    setThreads(rows)
    setThreadOffset(rows.length)
  }, [])
  useEffect(() => {
    let active = true
    const load = async () => {
      const [state, filters, config, listed] = await Promise.allSettled([
        invoke<ClipboardStatus>('assistant_clipboard_status'),
        invoke<ClipboardFilters>('assistant_clipboard_filters'),
        invoke<AiConfiguration>('ai_configuration_export'),
        conversationStore.list(0),
      ])
      if (!active) return
      if (state.status === 'fulfilled') setStatus(state.value)
      if (filters.status === 'fulfilled') setFacets(filters.value)
      if (config.status === 'fulfilled') setConfiguration(config.value)
      if ([state, filters, config, listed].some(result => result.status === 'rejected'))
        setError(true)
      if (listed.status !== 'fulfilled') return
      const rows = listed.value
      setThreads(rows)
      setThreadOffset(rows.length)
      const existing = initialAsk ? undefined : rows.find(row => !row.archived)
      const fresh = existing ? null : createDraftConversation()
      const current = existing ?? fresh!.thread
      if (active) {
        setThread(current)
        setDraft(fresh)
        if (initialAsk) onInitialAskConsumed?.()
      }
    }
    void load().catch(() => {
      if (active) setError(true)
    })
    const reload = () =>
      void Promise.all([
        invoke<ClipboardStatus>('assistant_clipboard_status'),
        invoke<ClipboardFilters>('assistant_clipboard_filters'),
      ])
        .then(([state, filters]) => {
          if (active) {
            setStatus(state)
            setFacets(filters)
          }
        })
        .catch(() => undefined)
    const listeners = [
      'embedding-provider-status-changed',
      'clip-captured',
      'clip-deleted',
      'clip-updated',
    ].map(event => listen(event, reload))
    listeners.push(
      listen('ai-configuration-changed', () => {
        void invoke<AiConfiguration>('ai_configuration_export')
          .then(config => {
            if (active) setConfiguration(config)
          })
          .catch(() => undefined)
      })
    )
    return () => {
      active = false
      void Promise.all(listeners).then(stops => stops.forEach(stop => stop()))
    }
    // Entry intent is consumed once when this keyed page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const perform = async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await work()
      setError(false)
    } catch {
      fail()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const changeThread = async (id: string) => {
    const data = await conversationStore.load(id)
    setThread(data.thread)
    setDraft(null)
    setDraftSeed('')
    setQuery('')
    setAttachments([])
    setAttachmentLabels({})
    setAsk(null)
  }
  const saveThread = async (
    change: Partial<Pick<RecallThread, 'presetId' | 'webEnabled' | 'reasoning'>>
  ) => {
    if (!thread) return
    if (draft && thread.id.startsWith('draft:')) {
      setThread(draft.update(change))
      return
    }
    const next = await conversationStore.update({
      threadId: thread.id,
      title: thread.title,
      archived: thread.archived,
      presetId: thread.presetId,
      webEnabled: thread.webEnabled,
      reasoning: thread.reasoning ?? null,
      ...change,
    })
    setThread(next)
    await reloadThreads()
  }
  const closePreview = useCallback(() => {
    previewRequest.current.generation++
    setPreview(null)
    setPreviewLoading(false)
    setPreviewFailed(false)
    if (previewFocus.current?.isConnected) previewFocus.current.focus()
  }, [])
  useEffect(() => {
    // Thread changes and unmount invalidate a pending preview.
    const pending = previewRequest.current
    pending.generation++
    setPreview(null)
    setPreviewLoading(false)
    setPreviewFailed(false)
    return () => {
      pending.generation++
    }
  }, [thread?.id])
  const openSource = useCallback((id: string) => {
    previewFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const request = ++previewRequest.current.generation
    setContextOpen(true)
    setPreview(null)
    setPreviewLoading(true)
    setPreviewFailed(false)
    void (async () => {
      await invoke('assistant_read_clip', { request: { clipId: id } })
      const detail = await invoke<ClipDetail>('get_clip_detail', { clipId: id })
      if (request === previewRequest.current.generation) setPreview(detail.clip)
    })()
      .catch(() => {
        if (request === previewRequest.current.generation) setPreviewFailed(true)
      })
      .finally(() => {
        if (request === previewRequest.current.generation) setPreviewLoading(false)
      })
  }, [])
  const copy = (id: string) =>
    void invoke('execute_clipboard_output', {
      request: { disposition: 'copy', source: { kind: 'original', clipId: id } },
    }).catch(fail)
  const attach = (item: ClipMatch) => {
    if (running || attachments.length >= 10) return
    setAttachmentLabels(current => ({
      ...current,
      [item.clip.id]:
        item.snippet?.slice(0, 64) || item.clip.sourceAppName || t('recallPage.imageOrFiles'),
    }))
    setAttachments(current =>
      current.some(a => a.clipId === item.clip.id)
        ? current
        : [...current, { clipId: item.clip.id, revision: item.clip.revision }].slice(0, 10)
    )
  }
  const openContext = () => {
    previewRequest.current.generation++
    setPreview(null)
    setPreviewLoading(false)
    setPreviewFailed(false)
    setContextOpen(true)
  }
  const closeContext = () => {
    closePreview()
    setContextOpen(false)
    // Restore focus after the context content has been removed.
    requestAnimationFrame(() => contextToggle.current?.focus())
  }
  const scopeLabels = [
    filters.scope && filters.scope !== 'all'
      ? t(`recallPage.${filters.scope}`, { defaultValue: filters.scope })
      : null,
    filters.tagId
      ? (facets?.tags.find(tag => tag.id === filters.tagId)?.name ?? t('recallPage.tag'))
      : null,
    ...filters.sourceAppIds.map(
      id =>
        facets?.sourceApplications.find(app => app.id === id)?.name ?? t('recallPage.application')
    ),
    ...filters.representationFamilies,
    ...filters.facetIds,
    filters.capturedAfter
      ? t('recallPage.after') +
        ' ' +
        new Date(filters.capturedAfter).toLocaleDateString(i18n.language)
      : null,
    filters.capturedBefore
      ? t('recallPage.before') +
        ' ' +
        new Date(filters.capturedBefore).toLocaleDateString(i18n.language)
      : null,
    search.filters.excludedClipIds.length
      ? t('recallPage.excludedCount', { count: search.filters.excludedClipIds.length })
      : null,
  ].filter(Boolean)
  const resultRow = (item: ClipMatch) => (
    <li
      key={item.clip.id}
      className={`group rounded-xl border p-2.5 transition-all duration-150 ${
        selected?.clip.id === item.clip.id
          ? 'border-violet-400/80 bg-violet-50/50 ring-1 ring-violet-500/30 dark:border-violet-500/40 dark:bg-violet-950/20'
          : 'border-slate-200/60 bg-slate-100/30 hover:bg-slate-200/30 dark:border-white/10 dark:bg-slate-100/5 dark:hover:bg-white/10'
      }`}
    >
      <button
        className="w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
        data-recall-result={item.clip.id}
        onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          const buttons = Array.from(
            event.currentTarget
              .closest('ul')
              ?.querySelectorAll<HTMLButtonElement>('button[data-recall-result]') ?? []
          )
          const current = buttons.indexOf(event.currentTarget)
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : Math.max(
                    0,
                    Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))
                  )
          const next = buttons[index]
          if (next) {
            event.preventDefault()
            search.setSelectedId(next.dataset['recallResult'] ?? null)
            next.focus()
          }
        }}
        onClick={() => {
          search.setSelectedId(item.clip.id)
          openSource(item.clip.id)
        }}
        aria-pressed={selected?.clip.id === item.clip.id}
      >
        <span className="block line-clamp-3 whitespace-pre-wrap break-words text-xs font-medium text-slate-800 dark:text-slate-100">
          {item.snippet || t('recallPage.imageOrFiles')}
        </span>
        <span className="mt-1 block text-[10px] text-slate-500">
          {item.clip.sourceAppName ?? t('recallPage.unknownApp')} ·{' '}
          {new Date(item.clip.capturedAt).toLocaleString(i18n.language)}
        </span>
      </button>
      <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-1.5 dark:border-white/5">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 rounded-md px-2 text-xs"
          onClick={() => openSource(item.clip.id)}
        >
          {t('recallPage.preview')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 rounded-md px-2 text-xs"
          onClick={() => copy(item.clip.id)}
        >
          {t('recallPage.copy')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 rounded-md px-2 text-xs"
          onClick={() => attach(item)}
          disabled={
            search.pending ||
            running ||
            attachments.length >= 10 ||
            attachments.some(a => a.clipId === item.clip.id)
          }
        >
          {t('recallPage.attach')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 rounded-md px-2 text-xs"
          disabled={running || search.pending}
          onClick={() => search.dismiss(item.clip.id)}
        >
          {t('recallPage.dismiss')}
        </Button>
      </div>
    </li>
  )
  const attachableMatches = [...(search.keyword?.items ?? []), ...search.related]
    .filter(item => !attachments.some(source => source.clipId === item.clip.id))
    .slice(0, Math.min(3, 10 - attachments.length))
  const suggestions = (
    <section aria-label={t('recallContext.suggestions')}>
      <div className="space-y-2.5">
        <p className="text-xs leading-relaxed text-slate-500">
          {t('recallContext.suggestionHelp')}
        </p>
        {query.trim() && attachableMatches.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={running || search.pending || search.composing}
            onClick={() => attachableMatches.forEach(attach)}
          >
            <Paperclip size={12} aria-hidden="true" />
            {t('recallContext.attachMatches')}
          </Button>
        )}
        <details className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-2 text-xs dark:border-white/5 dark:bg-white/[0.02]">
          <summary className="cursor-pointer font-medium text-slate-600 outline-none select-none hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:text-slate-300 dark:hover:text-slate-100">
            {t('recallPage.filters')}
            {(filters.scope && filters.scope !== 'all') ||
            filters.tagId ||
            filters.capturedAfter ||
            filters.capturedBefore ||
            filters.sourceAppIds.length ||
            filters.representationFamilies.length ||
            filters.facetIds.length
              ? ' · ' + t('recallPage.filtersActive')
              : ''}
          </summary>
          <fieldset disabled={running} className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select
                disabled={running}
                value={filters.scope ?? 'all'}
                onChange={scope => setFilters(current => ({ ...current, scope }))}
                ariaLabel={t('recallPage.scope')}
                options={[
                  { value: 'all', label: t('recallPage.all') },
                  { value: 'favorites', label: t('recallPage.favorites') },
                  { value: 'pinned', label: t('recallPage.pinned') },
                ]}
              />
              <Select
                disabled={running}
                value={filters.sourceAppIds[0] ?? 'all'}
                onChange={app =>
                  setFilters(current => ({ ...current, sourceAppIds: app === 'all' ? [] : [app] }))
                }
                ariaLabel={t('recallPage.application')}
                options={[
                  { value: 'all', label: t('recallPage.allApplications') },
                  ...(facets?.sourceApplications ?? []).map(app => ({
                    value: app.id,
                    label: app.name,
                  })),
                ]}
              />
              <Select
                disabled={running}
                value={filters.tagId ?? 'all'}
                onChange={tag =>
                  setFilters(current => ({ ...current, tagId: tag === 'all' ? null : tag }))
                }
                ariaLabel={t('recallPage.tag')}
                options={[
                  { value: 'all', label: t('recallPage.allTags') },
                  ...(facets?.tags ?? []).map(tag => ({ value: tag.id, label: tag.name })),
                ]}
              />
              <Select
                disabled={running}
                value={filters.representationFamilies[0] ?? 'all'}
                onChange={family =>
                  setFilters(current => ({
                    ...current,
                    representationFamilies: family === 'all' ? [] : [family],
                  }))
                }
                ariaLabel={t('recallPage.format')}
                options={[
                  { value: 'all', label: t('recallPage.allFormats') },
                  ...(facets?.representationFamilies ?? []).map(family => ({
                    value: family,
                    label: family,
                  })),
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="datetime-local"
                label={t('recallPage.after')}
                value={filters.capturedAfter ? localDate(filters.capturedAfter) : ''}
                onChange={value =>
                  setFilters(current => ({
                    ...current,
                    capturedAfter: value ? new Date(value).getTime() : null,
                  }))
                }
              />
              <Input
                type="datetime-local"
                label={t('recallPage.before')}
                value={filters.capturedBefore ? localDate(filters.capturedBefore) : ''}
                onChange={value =>
                  setFilters(current => ({
                    ...current,
                    capturedBefore: value ? new Date(value).getTime() : null,
                  }))
                }
              />
            </div>
          </fieldset>
        </details>
      </div>
      <div className="mt-3">
        {!query.trim() && (
          <p className="py-4 text-xs text-slate-500">{t('recallContext.typeToFind')}</p>
        )}
        {query.trim() && (
          <>
            <div className="mb-2.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
              <span>{t('recallPage.keywordMatches')}</span>
              <span
                role="status"
                className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-white/5"
              >
                {search.pending
                  ? t('recallPage.searching')
                  : t('recallPage.resultCount', { count: search.keyword?.items.length ?? 0 })}
              </span>
            </div>
            {search.error && (
              <p role="alert" className="text-xs text-red-600">
                {t('recallPage.searchFailed')}
              </p>
            )}
            {!search.pending && !search.error && search.keyword?.items.length === 0 && (
              <p className="py-5 text-xs text-slate-500">{t('recallPage.noMatches')}</p>
            )}
            <ul className="space-y-2">{search.keyword?.items.map(resultRow)}</ul>
            {search.keyword?.nextCursor && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-7 rounded-lg text-xs"
                disabled={search.pending || search.paging}
                onClick={() => void search.loadMore()}
              >
                {t('recallPage.moreResults')}
              </Button>
            )}
            {search.related.length > 0 && (
              <>
                <h3 className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {t('recallPage.relatedMatches')}
                </h3>
                <ul className="space-y-2">{search.related.map(resultRow)}</ul>
              </>
            )}
            {search.keyword && !search.keyword.exhaustive && (
              <p className="mt-3 text-xs text-amber-600">{t('recallPage.retrievalIncomplete')}</p>
            )}
          </>
        )}
      </div>
    </section>
  )
  const composerAttachments = attachments.length > 0 && (
    <div className="mb-2 flex flex-wrap gap-1.5" aria-label={t('recallPage.attachedSources')}>
      {attachments.map(item => (
        <Button
          key={item.clipId}
          size="sm"
          variant="outline"
          disabled={running}
          className="max-w-64 gap-1.5 px-2 py-1 text-xs"
          aria-label={t('recallPage.removeAttachment', {
            id: attachmentLabels[item.clipId] ?? item.clipId.slice(0, 8),
          })}
          onClick={() => setAttachments(current => current.filter(a => a.clipId !== item.clipId))}
        >
          <Paperclip size={12} className="shrink-0 text-violet-500" aria-hidden="true" />
          <span className="truncate">
            {attachmentLabels[item.clipId] ?? item.clipId.slice(0, 8)}
          </span>
          <X size={12} className="shrink-0" aria-hidden="true" />
        </Button>
      ))}
    </div>
  )
  const composerToolbar = (
    <RecallOptions
      configuration={configuration}
      preset={preset}
      presetId={presetId}
      thread={thread}
      disabled={busy || running || !thread}
      onPreset={id => void perform(() => saveThread({ presetId: id, reasoning: null }))}
      onReasoning={reasoning => void perform(() => saveThread({ reasoning }))}
      onWeb={webEnabled => void perform(() => saveThread({ webEnabled }))}
    />
  )
  const chat = (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-slate-100/30 dark:border-white/10 dark:bg-slate-100/5"
      aria-label={t('recallPage.chat')}
    >
      {/* Slim scope bar — styled as clean card sub-header */}
      <div className="shrink-0 border-b border-slate-200/50 bg-slate-50/50 px-3.5 py-2 flex items-center justify-between gap-2 dark:border-white/5 dark:bg-white/[0.01]">
        <button
          type="button"
          onClick={openContext}
          className="group flex max-w-full items-center gap-1.5 rounded-lg px-2 py-0.5 text-left text-xs text-slate-500 transition-colors hover:bg-violet-50 hover:text-violet-600 focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
        >
          <SlidersHorizontal
            size={12}
            className="shrink-0 text-slate-400 group-hover:text-violet-500"
            aria-hidden="true"
          />
          <span className="truncate font-medium">
            {scopeLabels.length ? scopeLabels.join(' · ') : t('recallPage.allEligibleClips')}
          </span>
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {thread ? (
          <RecallChat
            key={thread.localId}
            initializeThread={
              draft
                ? async () => {
                    const saved = await draft.ensure()
                    setThread(current => (current?.localId === saved.localId ? saved : current))
                    void reloadThreads().catch(() => undefined)
                    return saved.id
                  }
                : undefined
            }
            composerToolbar={composerToolbar}
            composerAttachments={composerAttachments}
            contextOpen={contextOpen}
            onContextOpen={openContext}
            onContextClose={closeContext}
            suggestions={suggestions}
            preview={
              preview || previewLoading || previewFailed ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/60 p-2 dark:border-white/10">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={closePreview}
                    >
                      {t('recallContext.backToContext')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-8 px-0"
                      aria-label={t('recallContext.closePreview')}
                      onClick={closePreview}
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="relative min-h-0 flex-1 overflow-hidden p-2">
                    {preview && (
                      <ClipPreview key={preview.id} clip={preview} trackHistorySearch={false} />
                    )}
                    {previewLoading && (
                      <p role="status" className="p-3 text-xs text-slate-500">
                        {t('common.loading')}
                      </p>
                    )}
                    {previewFailed && (
                      <p role="alert" className="p-3 text-xs text-amber-600">
                        {t('recallPage.missingSource')}
                      </p>
                    )}
                  </div>
                </div>
              ) : null
            }
            initialDraft={draftSeed}
            onDraft={changeQuery}
            onCompositionStart={search.compositionStart}
            onCompositionEnd={search.compositionEnd}
            thread={thread}
            preset={preset}
            filters={search.filters}
            attachments={attachments}
            ask={ask}
            onAskConsumed={() => {
              setAsk(null)
              if (initialAsk) onInitialAskConsumed?.()
            }}
            onRunning={setRunning}
            onComplete={() => {
              void reloadThreads().catch(() => undefined)
            }}
            onOpenSource={openSource}
          />
        ) : (
          <p className="p-4 text-xs text-slate-500">{t('common.loading')}</p>
        )}
      </div>
    </section>
  )
  return (
    <div className="recall-workspace relative flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 sm:p-4">
      <header className="shrink-0 rounded-2xl border border-violet-300/40 bg-linear-to-br from-violet-500/10 via-fuchsia-500/5 to-white/35 px-3 py-2.5 dark:border-violet-400/15 dark:to-white/[.02]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('recallPage.toggleSidebar')}
              ref={sidebarToggle}
              onClick={() => setSidebarOpen(prev => !prev)}
              className="size-8 rounded-xl p-0 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              <PanelLeft size={15} aria-hidden="true" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/15 dark:text-violet-300">
                <Sparkles size={14} aria-hidden="true" />
              </div>
              <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {t('recallPage.title')}
              </h1>
            </div>
            {thread?.title && (
              <span className="hidden md:inline-block max-w-48 truncate rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/5 dark:text-slate-400">
                {thread.title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={contextOpen ? 'outline' : 'ghost'}
              ref={contextToggle}
              aria-expanded={contextOpen}
              aria-label={t('recallContext.title')}
              onClick={contextOpen ? closeContext : openContext}
              className={`h-8 rounded-xl text-xs gap-1.5 ${
                Boolean(query.trim()) && !running
                  ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/30 dark:text-violet-300'
                  : ''
              }`}
            >
              <PanelRight size={13} aria-hidden="true" />
              <span className="hidden sm:inline">{t('recallContext.title')}</span>
              {query.trim() && (
                <span
                  className="rounded bg-violet-500/10 px-1.5 text-[10px]"
                  aria-label={t('recallPage.resultCount', {
                    count: (search.keyword?.items.length ?? 0) + search.related.length,
                  })}
                >
                  {(search.keyword?.items.length ?? 0) + search.related.length}
                </span>
              )}
            </Button>
            <DocumentationLink guide="recall" label={t('documentation.recallGuide')} compact />
          </div>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-600 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400"
        >
          {t('recallPage.operationFailed')}
        </p>
      )}
      <div className="relative flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className="flex shrink-0">
          <ThreadSidebar
            threads={threads}
            thread={thread}
            busy={busy}
            running={running}
            open={sidebarOpen}
            onSelectThread={id =>
              void perform(async () => {
                await changeThread(id)
                if (window.innerWidth < 1024) setSidebarOpen(false)
              })
            }
            onNewThread={() =>
              void perform(async () => {
                const fresh = createDraftConversation()
                setDraft(fresh)
                setThread(fresh.thread)
                setDraftSeed('')
                setQuery('')
                setAttachments([])
                setAttachmentLabels({})
                setAsk(null)
                await reloadThreads()
                if (window.innerWidth < 1024) setSidebarOpen(false)
              })
            }
            onLoadMore={() =>
              void perform(async () => {
                const more = await conversationStore.list(threadOffset)
                setThreads(current => [...current, ...more])
                setThreadOffset(threadOffset + more.length)
              })
            }
            onRename={(id, title) =>
              void perform(async () => {
                await threadAdapter.rename(id, title)
                if (thread?.id === id) setThread({ ...thread, title })
                await reloadThreads()
              })
            }
            onArchive={(id, archived) =>
              void perform(async () => {
                await (archived ? threadAdapter.unarchive(id) : threadAdapter.archive(id))
                if (thread?.id === id) setThread({ ...thread, archived: !archived })
                await reloadThreads()
              })
            }
            onDelete={id => setDeleteTargetId(id)}
            onClose={() => {
              setSidebarOpen(false)
              sidebarToggle.current?.focus()
            }}
          />
        </div>
        <div className="min-h-0 min-w-0 flex-1">{chat}</div>
      </div>
      <Dialog.Root
        open={deleteTargetId !== null}
        onOpenChange={open => {
          if (!open) setDeleteTargetId(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/30" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-slate-50 p-4 outline-none dark:border-white/10 dark:bg-slate-950">
            <Dialog.Title className="text-sm font-semibold">
              {t('recallPage.deleteThread')}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              {t('recallPage.deleteWarning')}
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  {t('common.cancel')}
                </Button>
              </Dialog.Close>
              <Button
                size="sm"
                disabled={busy || running}
                onClick={() =>
                  void perform(async () => {
                    if (!deleteTargetId) return
                    await threadAdapter.delete(deleteTargetId)
                    const rows = await conversationStore.list(0)
                    const existing = rows.find(row => !row.archived)
                    const fresh = existing ? null : createDraftConversation()
                    setDraft(fresh)
                    setThread(existing ?? fresh!.thread)
                    setDraftSeed('')
                    setQuery('')
                    setAttachments([])
                    setAttachmentLabels({})
                    setAsk(null)
                    setDeleteTargetId(null)
                    await reloadThreads()
                  })
                }
              >
                {t('recallPage.deleteThread')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
function localDate(timestamp: number) {
  const date = new Date(timestamp)
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
