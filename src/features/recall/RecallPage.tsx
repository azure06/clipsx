import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { Button, Input, Select, Switch, Tabs } from '../../shared/components/ui'
import { ClipPreview } from '../clipboard/ClipPreview'
import type { ClipDetail, ClipSummary } from '../../shared/types/v2'
import { useUIStore } from '../../stores/uiStore'
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
import { conversationStore, createConversationThreadAdapter } from './conversations'

export interface RecallPageProps {
  initialQuery?: string
  initialFilters?: ClipFilters
}
export function RecallPage({ initialQuery = '', initialFilters = emptyFilters }: RecallPageProps) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [query, setQuery] = useState(initialQuery)
  const [filters, storeFilters] = useState(initialFilters)
  const [status, setStatus] = useState<ClipboardStatus | null>(null)
  const [facets, setFacets] = useState<ClipboardFilters | null>(null)
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null)
  const [threads, setThreads] = useState<RecallThread[]>([])
  const [thread, setThread] = useState<RecallThread | null>(null)
  const [threadOffset, setThreadOffset] = useState(0)
  const [attachments, setAttachments] = useState<ClipRevision[]>([])
  const [ask, setAsk] = useState<{ id: string; text: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [pane, setPane] = useState('find')
  const [title, setTitle] = useState('')
  const [preview, setPreview] = useState<ClipSummary | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const previewFocus = useRef<HTMLElement | null>(null)
  const threadAdapter = useMemo(() => createConversationThreadAdapter(), [])
  const search = useProgressiveSearch(query, filters, status?.semanticReady ?? false)
  const setFilters = (next: import('react').SetStateAction<ClipFilters>) => {
    search.invalidate()
    storeFilters(next)
  }
  const changeQuery = (next: string) => {
    search.invalidate()
    setQuery(next)
  }
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
      const current =
        rows.find(row => !row.archived) ?? (await conversationStore.initialize(crypto.randomUUID()))
      if (active) {
        setThread(current)
        setThreads(previous =>
          previous.some(row => row.id === current.id) ? previous : [current, ...previous]
        )
        setTitle(current.title)
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
    return () => {
      active = false
      void Promise.all(listeners).then(stops => stops.forEach(stop => stop()))
    }
  }, [])
  const perform = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
      setError(false)
    } catch {
      fail()
    } finally {
      setBusy(false)
    }
  }
  const changeThread = async (id: string) => {
    const data = await conversationStore.load(id)
    setThread(data.thread)
    setTitle(data.thread.title)
    setAttachments([])
    setAsk(null)
  }
  const saveThread = async (change: Partial<Pick<RecallThread, 'presetId' | 'webEnabled'>>) => {
    if (!thread) return
    const next = await conversationStore.update({
      threadId: thread.id,
      title: thread.title,
      archived: thread.archived,
      presetId: thread.presetId,
      webEnabled: thread.webEnabled,
      ...change,
    })
    setThread(next)
    await reloadThreads()
  }
  const openSource = useCallback(
    (id: string) => {
      previewFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      void (async () => {
        await invoke('assistant_read_clip', { request: { clipId: id } })
        const detail = await invoke<ClipDetail>('get_clip_detail', { clipId: id })
        setPreview(detail.clip)
      })().catch(fail)
    },
    [fail]
  )
  const copy = (id: string) =>
    void invoke('execute_clipboard_output', {
      request: { disposition: 'copy', source: { kind: 'original', clipId: id } },
    }).catch(fail)
  const attach = (item: ClipMatch) =>
    setAttachments(current =>
      current.some(a => a.clipId === item.clip.id)
        ? current
        : [...current, { clipId: item.clip.id, revision: item.clip.revision }].slice(0, 10)
    )
  const askNow = () => {
    if (!query.trim() || !preset || running || search.composing) return
    setAsk({ id: crypto.randomUUID(), text: query.trim() })
    setPane('chat')
  }
  const resultRow = (item: ClipMatch) => (
    <li
      key={item.clip.id}
      className={`group rounded-lg border p-2 ${selected?.clip.id === item.clip.id ? 'border-violet-400/70 bg-violet-50/40 dark:bg-violet-500/5' : 'border-transparent hover:bg-slate-100/70 dark:hover:bg-white/5'}`}
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
        onClick={() => search.setSelectedId(item.clip.id)}
        aria-pressed={selected?.clip.id === item.clip.id}
      >
        <span className="block line-clamp-3 whitespace-pre-wrap break-words text-xs text-slate-800 dark:text-slate-100">
          {item.snippet || t('recallPage.imageOrFiles')}
        </span>
        <span className="mt-1 block text-[10px] text-slate-500">
          {item.clip.sourceAppName ?? t('recallPage.unknownApp')} ·{' '}
          {new Date(item.clip.capturedAt).toLocaleString(i18n.language)}
        </span>
      </button>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => copy(item.clip.id)}>
          {t('recallPage.copy')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => attach(item)}
          disabled={attachments.length >= 10}
        >
          {t('recallPage.attach')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => search.dismiss(item.clip.id)}>
          {t('recallPage.dismiss')}
        </Button>
      </div>
    </li>
  )
  const find = (
    <section
      className="flex h-full min-h-0 flex-col border-r border-slate-200 dark:border-white/10"
      aria-label={t('recallPage.find')}
    >
      <div className="shrink-0 space-y-2 border-b border-slate-200 p-3 dark:border-white/10">
        <h2 className="text-sm font-semibold">{t('recallPage.find')}</h2>
        <form
          onSubmit={event => {
            event.preventDefault()
            if (!search.composing) search.retrieve()
          }}
          className="flex items-end gap-2"
        >
          <Input
            label={t('recallPage.search')}
            value={query}
            onChange={changeQuery}
            className="flex-1"
            placeholder={t('recallPage.searchPlaceholder')}
            onCompositionStart={search.compositionStart}
            onCompositionEnd={search.compositionEnd}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || search.composing) {
                if (event.key === 'Enter') event.preventDefault()
              }
            }}
          />
          <Button type="submit" size="sm" variant="outline">
            {t('recallPage.find')}
          </Button>
          <Button
            size="sm"
            disabled={!query.trim() || !preset || running || search.composing}
            onClick={askNow}
          >
            {t('recallPage.ask')}
          </Button>
        </form>
        <div className="grid grid-cols-2 gap-2">
          <Select
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
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] text-slate-500">
          <span>{t('recallPage.keywordMatches')}</span>
          <span role="status">
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
        <ul className="space-y-1">{search.keyword?.items.map(resultRow)}</ul>
        {search.keyword?.nextCursor && (
          <Button
            size="sm"
            variant="ghost"
            disabled={search.pending || search.paging}
            onClick={() => void search.loadMore()}
          >
            {t('recallPage.moreResults')}
          </Button>
        )}
        {search.related.length > 0 && (
          <>
            <h3 className="mt-4 mb-2 text-[10px] font-semibold text-slate-500">
              {t('recallPage.relatedMatches')}
            </h3>
            <ul className="space-y-1">{search.related.map(resultRow)}</ul>
          </>
        )}
        {search.keyword && !search.keyword.exhaustive && (
          <p className="mt-3 text-xs text-amber-600">{t('recallPage.retrievalIncomplete')}</p>
        )}
      </div>
      {selected && (
        <div className="shrink-0 border-t border-slate-200 p-3 dark:border-white/10">
          <p className="mb-2 line-clamp-2 whitespace-pre-wrap break-words text-xs">
            {selected.snippet || t('recallPage.imageOrFiles')}
          </p>
          <Button size="sm" variant="outline" onClick={() => openSource(selected.clip.id)}>
            {t('recallPage.preview')}
          </Button>
        </div>
      )}
    </section>
  )
  const chat = (
    <section className="flex h-full min-h-0 flex-col" aria-label={t('recallPage.chat')}>
      <div className="shrink-0 space-y-2 border-b border-slate-200 p-3 dark:border-white/10">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            ariaLabel={t('recallPage.thread')}
            value={thread?.id ?? ''}
            options={threads.map(row => ({
              value: row.id,
              label:
                (row.archived ? t('recallPage.archivedPrefix') : '') +
                (row.title || t('recallPage.untitled')),
            }))}
            disabled={busy || running}
            onChange={id => void perform(() => changeThread(id))}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || running}
            onClick={() =>
              void perform(async () => {
                const next = await conversationStore.initialize(crypto.randomUUID())
                setThread(next)
                setTitle('')
                setAttachments([])
                setAsk(null)
                await reloadThreads()
              })
            }
          >
            {t('recallPage.newThread')}
          </Button>
          {threads.length >= 200 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const more = await conversationStore.list(threadOffset)
                  setThreads(current => [...current, ...more])
                  setThreadOffset(threadOffset + more.length)
                })
              }
            >
              {t('recallPage.moreThreads')}
            </Button>
          )}
        </div>
        {thread && (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              aria-label={t('recallPage.threadTitle')}
              value={title}
              onChange={setTitle}
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await threadAdapter.rename(thread.id, title)
                  setThread({ ...thread, title })
                  await reloadThreads()
                })
              }
            >
              {t('recallPage.rename')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || running}
              onClick={() =>
                void perform(async () => {
                  await (thread.archived
                    ? threadAdapter.unarchive(thread.id)
                    : threadAdapter.archive(thread.id))
                  setThread({ ...thread, archived: !thread.archived })
                  await reloadThreads()
                })
              }
            >
              {thread.archived ? t('recallPage.unarchive') : t('recallPage.archive')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || running}
              onClick={() => setDeleteOpen(true)}
            >
              {t('recallPage.deleteThread')}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Select
            className="min-w-0 flex-1"
            value={presetId ?? ''}
            onChange={presetId => void perform(() => saveThread({ presetId }))}
            disabled={busy || !thread}
            label={t('recallPage.model')}
            placeholder={t('recallPage.selectModel')}
            options={(configuration?.presets ?? [])
              .filter(p => p.purpose === 'chat')
              .map(p => ({
                value: p.id,
                label: p.name + ' · ' + p.modelId,
                disabled: !configuration?.connections.some(
                  c => c.id === p.connectionId && c.enabled
                ),
              }))}
          />
          <Switch
            checked={thread?.webEnabled ?? false}
            disabled={busy || !thread}
            label={t('recallPage.webResearch')}
            onChange={webEnabled => void perform(() => saveThread({ webEnabled }))}
          />
        </div>
        {!preset && (
          <p className="text-xs text-slate-500">
            {t('recallPage.setupHelp')}{' '}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => useUIStore.getState().setActiveView('intelligence')}
            >
              {t('recallPage.configureModels')}
            </Button>
          </p>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label={t('recallPage.attachedSources')}>
            {attachments.map(item => (
              <Button
                key={item.clipId}
                size="sm"
                variant="outline"
                aria-label={t('recallPage.removeAttachment', { id: item.clipId })}
                onClick={() =>
                  setAttachments(current => current.filter(a => a.clipId !== item.clipId))
                }
              >
                {item.clipId.slice(0, 8)} ×
              </Button>
            ))}
          </div>
        )}
      </div>
      {thread ? (
        <RecallChat
          key={thread.id}
          thread={thread}
          preset={preset}
          filters={search.filters}
          attachments={attachments}
          ask={ask}
          onAskConsumed={() => setAsk(null)}
          onRunning={setRunning}
          onComplete={() => {
            void reloadThreads().catch(() => undefined)
          }}
          onOpenSource={openSource}
        />
      ) : (
        <p className="p-3 text-xs text-slate-500">{t('common.loading')}</p>
      )}
    </section>
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-200 px-4 py-2 dark:border-white/10">
        <h1 className="text-sm font-semibold">{t('recallPage.title')}</h1>
        <p className="text-[10px] text-slate-500">{t('recallPage.subtitle')}</p>
      </header>
      {error && (
        <p role="alert" className="p-3 text-xs text-red-600">
          {t('recallPage.operationFailed')}
        </p>
      )}
      <Tabs
        className="min-h-0 flex-1"
        activeTab={pane}
        onTabChange={setPane}
        keepMounted
        listClassName="lg:hidden"
        panelsClassName="min-h-0 grid grid-cols-1 overflow-hidden lg:grid-cols-2"
        panelClassName="min-h-0 h-full lg:data-[state=inactive]:block"
        tabs={[
          { id: 'find', label: t('recallPage.find'), content: find },
          { id: 'chat', label: t('recallPage.chat'), content: chat },
        ]}
      />
      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
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
                    if (!thread) return
                    await threadAdapter.delete(thread.id)
                    const rows = await conversationStore.list(0)
                    const next =
                      rows.find(row => !row.archived) ??
                      (await conversationStore.initialize(crypto.randomUUID()))
                    setThread(next)
                    setTitle(next.title)
                    setAttachments([])
                    setAsk(null)
                    setDeleteOpen(false)
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
      <Dialog.Root
        open={preview !== null}
        onOpenChange={open => {
          if (!open) setPreview(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/30" />
          <Dialog.Content
            onCloseAutoFocus={event => {
              event.preventDefault()
              if (previewFocus.current?.isConnected) previewFocus.current.focus()
            }}
            className="fixed inset-4 z-[91] flex min-h-0 flex-col rounded-xl border border-slate-200 bg-slate-100 p-3 outline-none dark:border-white/10 dark:bg-slate-950"
          >
            <Dialog.Title className="text-sm font-semibold">{t('recallPage.preview')}</Dialog.Title>
            <Dialog.Description className="sr-only">
              {t('recallPage.sourcePreview')}
            </Dialog.Description>
            <div className="min-h-0 flex-1">{preview && <ClipPreview clip={preview} />}</div>
            <Dialog.Close asChild>
              <Button size="sm" variant="outline">
                {t('common.close')}
              </Button>
            </Dialog.Close>
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
