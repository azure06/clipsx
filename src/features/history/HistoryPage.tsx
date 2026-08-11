import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  CaptureSettings,
  ClipDetail as ClipDetailModel,
  ClipPage,
  ClipSummary,
  ProviderStatus,
  SearchPage,
  SearchSettings,
  Tag,
  TransformPreview,
} from '../../shared/types'
import { ClipDetail } from './ClipDetail'
import { StorageSettings } from '../settings/StorageSettings'
import { ExtensionsSettings } from '../settings/ExtensionsSettings'
import { createImeTracker } from '../../shared/keyboard/ime'
import { hasNativeSelection } from '../../shared/keyboard/selection'

const date = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
const SCOPES: ReadonlyArray<readonly [string, string]> = [
  ['all', 'All'],
  ['favorites', 'Favorites'],
  ['pinned', 'Pinned'],
]

const HistoryPage = () => {
  const [page, setPage] = useState<ClipPage>({ items: [] })
  const [selected, setSelected] = useState<ClipDetailModel | null>(null)
  const [scope, setScope] = useState('all')
  const [tagFilter, setTagFilter] = useState<string>()
  const [tags, setTags] = useState<Tag[]>([])
  const [settings, setSettings] = useState<CaptureSettings | null>(null)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [transformOpen, setTransformOpen] = useState(false)
  const [activeTransform, setActiveTransform] = useState<TransformPreview | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchPage | null>(null)
  const [searchSettings, setSearchSettings] = useState<SearchSettings | null>(null)
  const [embeddingStatus, setEmbeddingStatus] = useState<ProviderStatus | null>(null)
  const [ftsOnly, setFtsOnly] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const ime = useRef(createImeTracker())

  const load = useCallback(async () => {
    const [clips, loadedTags] = await Promise.all([
      invoke<ClipPage>('list_clips', { request: { limit: 50, scope, tagId: tagFilter } }),
      invoke<Tag[]>('list_tags'),
    ])
    setPage(clips)
    setTags(loadedTags)
  }, [scope, tagFilter])
  const select = useCallback(
    async (clip: ClipSummary) =>
      setSelected(await invoke<ClipDetailModel>('get_clip_detail', { clipId: clip.id })),
    []
  )
  const action = useCallback(
    async (command: string, args: Record<string, unknown>) => {
      await invoke(command, args)
      await load()
      if (command === 'delete_clip') setSelected(null)
      else if (selected)
        setSelected(await invoke<ClipDetailModel>('get_clip_detail', { clipId: selected.clip.id }))
    },
    [load, selected]
  )

  useEffect(() => {
    void Promise.all([
      invoke<ClipPage>('list_clips', { request: { limit: 50, scope, tagId: tagFilter } }),
      invoke<Tag[]>('list_tags'),
      invoke<SearchSettings>('get_search_settings'),
      invoke<ProviderStatus>('get_text_embedding_status'),
    ]).then(([clips, loadedTags, loadedSearchSettings, loadedEmbeddingStatus]) => {
      setPage(clips)
      setTags(loadedTags)
      setSearchSettings(loadedSearchSettings)
      setEmbeddingStatus(loadedEmbeddingStatus)
    })
  }, [scope, tagFilter])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = query.trim()
      if (!trimmed) return setResults(null)
      void invoke<SearchPage>('search_clips', {
        request: {
          query: trimmed,
          scope,
          tagId: tagFilter,
          limit: 50,
          mode: ftsOnly ? 'fts' : undefined,
        },
      }).then(setResults)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [query, scope, tagFilter, ftsOnly])
  useEffect(() => {
    const subscriptions = [
      'clip-captured',
      'clip-updated',
      'clip-deleted',
      'clip-facets-updated',
    ].map(event => listen(event, () => void load()))
    return () => {
      void Promise.all(subscriptions).then(values => values.forEach(unlisten => unlisten()))
    }
  }, [load])
  useEffect(() => {
    const tracker = ime.current
    const key = (event: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
        return
      }
      if (tracker.active || typing || hasNativeSelection()) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const next = Math.max(
          0,
          Math.min(page.items.length - 1, selectedIndex + (event.key === 'ArrowDown' ? 1 : -1))
        )
        setSelectedIndex(next)
        const clip = page.items[next]
        if (clip) void select(clip)
      } else if (event.key.toLowerCase() === 't' && selected) {
        event.preventDefault()
        setTransformOpen(true)
      } else if (event.key === 'Enter' && selected) {
        event.preventDefault()
        const policy =
          (event.ctrlKey || event.metaKey) && activeTransform
            ? { kind: 'transformed', resultId: activeTransform.resultId }
            : event.shiftKey
              ? { kind: 'plain_text', clipId: selected.clip.id }
              : { kind: 'original', clipId: selected.clip.id }
        void invoke('paste_clip_output', { policy })
      } else if (event.key === 'Delete' && selected) {
        event.preventDefault()
        void action('delete_clip', { clipId: selected.clip.id })
      }
    }
    const start = () => tracker.start()
    const end = () => tracker.end()
    window.addEventListener('keydown', key)
    window.addEventListener('compositionstart', start)
    window.addEventListener('compositionend', end)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('compositionstart', start)
      window.removeEventListener('compositionend', end)
      tracker.dispose()
    }
  }, [activeTransform, action, page.items, select, selected, selectedIndex])

  const shown =
    results?.items.map(item => ({ clip: item.clip, snippet: item.snippet })) ??
    page.items.map(clip => ({ clip, snippet: undefined }))
  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">ClipsX</h1>
          <p className="text-sm text-slate-400">Original representations, stored locally.</p>
        </div>
        <div className="flex gap-2">
          <button
            className="button"
            onClick={() =>
              void invoke('capture_clipboard')
                .then(load)
                .then(() => setNotice('Captured clipboard snapshot.'))
                .catch(error => setNotice(String(error)))
            }
          >
            Capture clipboard
          </button>
          <button
            className="button"
            onClick={() => {
              const name = window.prompt('Tag name')
              if (name?.trim())
                void invoke<Tag>('create_tag', { name: name.trim(), color: null }).then(tag =>
                  setTags(current => [...current, tag])
                )
            }}
          >
            New tag
          </button>
          <button
            className="button"
            onClick={() => void invoke<CaptureSettings>('get_capture_settings').then(setSettings)}
          >
            Storage
          </button>
          <button className="button" onClick={() => setExtensionsOpen(true)}>
            Extensions
          </button>
          <button
            className="button"
            onClick={() => {
              const endpoint = window.prompt('Ollama endpoint', 'http://localhost:11434')
              if (!endpoint) return
              void invoke<{ name: string }[]>('list_ollama_models', { endpoint })
                .then(models => {
                  const model = window.prompt(
                    `Embedding model (installed: ${models.map(item => item.name).join(', ') || 'none'})`
                  )
                  return model
                    ? invoke<ProviderStatus>('configure_text_embedding_provider', {
                        endpoint,
                        model,
                      })
                    : undefined
                })
                .then(status => status && setEmbeddingStatus(status))
                .catch(error => setNotice(String(error)))
            }}
          >
            {embeddingStatus?.enabled ? 'Semantic search' : 'Connect Ollama'}
          </button>
        </div>
      </header>
      {notice && <p className="mb-3 text-sm text-amber-300">{notice}</p>}
      <div className="mb-3 flex items-center gap-2">
        <input
          ref={searchInput}
          className="flex-1 rounded bg-slate-800 px-3 py-1.5 text-sm outline-none ring-1 ring-slate-700 focus:ring-sky-500"
          type="search"
          placeholder="Search clips… (⌘F)"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => event.key === 'Escape' && setQuery('')}
          aria-label="Search clips"
        />
        {searchSettings && (
          <button
            className="tag text-xs"
            onClick={() => {
              const next: SearchSettings = {
                syntaxMode: searchSettings.syntaxMode === 'simple' ? 'advanced' : 'simple',
              }
              void invoke('update_search_settings', { settings: next }).then(() =>
                setSearchSettings(next)
              )
            }}
          >
            {searchSettings.syntaxMode === 'simple' ? 'Simple' : 'Advanced'}
          </button>
        )}
        {embeddingStatus?.enabled && (
          <button
            className={ftsOnly ? 'tag text-xs' : 'tag text-xs text-sky-300'}
            onClick={() => setFtsOnly(value => !value)}
          >
            {ftsOnly ? 'FTS only' : 'Hybrid'}
          </button>
        )}
      </div>
      <nav className="mb-4 flex gap-2">
        {SCOPES.map(([value, label]) => (
          <button
            key={value}
            className={scope === value ? 'tab tab-active' : 'tab'}
            onClick={() => setScope(value)}
          >
            {label}
          </button>
        ))}
        {tags.map(tag => (
          <span key={tag.id} className="flex items-center rounded bg-slate-900">
            <button
              className={tagFilter === tag.id ? 'tab tab-active' : 'tab'}
              onClick={() => setTagFilter(tagFilter === tag.id ? undefined : tag.id)}
            >
              {tag.name}
            </button>
            <button
              className="px-1 text-xs text-slate-500 hover:text-red-300"
              aria-label={`Delete ${tag.name} tag`}
              onClick={() => {
                if (window.confirm(`Delete tag “${tag.name}”`))
                  void invoke('delete_tag', { tagId: tag.id }).then(load)
              }}
            >
              ×
            </button>
          </span>
        ))}
      </nav>
      <div className="grid min-h-[70vh] grid-cols-[minmax(18rem,2fr)_minmax(22rem,3fr)] gap-4">
        <section className="panel overflow-auto">
          {shown.length === 0 ? (
            <p className="p-6 text-slate-400">
              {results
                ? `No results for “${query}”.`
                : 'No clips yet. Capture your clipboard to begin.'}
            </p>
          ) : (
            shown.map(({ clip, snippet }, index) => (
              <button
                key={clip.id}
                className="clip"
                aria-selected={selected?.clip.id === clip.id}
                onClick={() => {
                  setSelectedIndex(index)
                  void select(clip)
                }}
              >
                <div className="flex justify-between gap-2">
                  <strong className="truncate">{clip.safeSummary}</strong>
                  <span>
                    {clip.isPinned ? 'Pinned ' : ''}
                    {clip.isFavorite ? 'Favorite' : ''}
                  </span>
                </div>
                {snippet && snippet !== clip.safeSummary && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-300">{snippet}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  {clip.sourceAppName ?? 'Unknown app'} · {date(clip.capturedAt)} ·{' '}
                  {clip.representationCount} representations
                </p>
                {clip.tags.length > 0 && (
                  <p className="mt-1 text-xs text-sky-300">
                    {clip.tags.map(tag => tag.name).join(', ')}
                  </p>
                )}
              </button>
            ))
          )}
          {!results && page.nextCursor && (
            <button
              className="clip text-center text-sky-300"
              onClick={() =>
                void invoke<ClipPage>('list_clips', {
                  request: { cursor: page.nextCursor, limit: 50, scope, tagId: tagFilter },
                }).then(next =>
                  setPage({ items: [...page.items, ...next.items], nextCursor: next.nextCursor })
                )
              }
            >
              Load more
            </button>
          )}
        </section>
        <section className="panel p-5">
          {selected ? (
            <ClipDetail
              detail={selected}
              action={action}
              tags={tags}
              transformOpen={transformOpen}
              setTransformOpen={setTransformOpen}
              setActiveTransform={setActiveTransform}
            />
          ) : (
            <p className="text-slate-400">Select a clip to inspect its original representations.</p>
          )}
        </section>
      </div>
      {settings && (
        <StorageSettings
          settings={settings}
          close={() => setSettings(null)}
          save={async value => {
            await invoke('update_capture_settings', { settings: value })
            setSettings(null)
          }}
        />
      )}
      {extensionsOpen && <ExtensionsSettings close={() => setExtensionsOpen(false)} />}
    </main>
  )
}

export default HistoryPage
