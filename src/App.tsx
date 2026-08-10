import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { clipsxAssetUrl } from './shared/rendering'
import type {
  CaptureSettings,
  ClipDetail,
  ClipPage,
  ClipSummary,
  ClipViewSet,
  RenderModel,
  RendererPreferences,
  SearchPage,
  SearchSettings,
  ProviderStatus,
  Tag,
  TransformPreferences,
  TransformPreview,
  TransformerDescriptor,
} from './shared/types/architecture'

const date = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
const hasNativeSelection = () => {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    return active.selectionStart !== active.selectionEnd
  return !(window.getSelection()?.isCollapsed ?? true)
}
const App = () => {
  const [page, setPage] = useState<ClipPage>({ items: [] })
  const [selected, setSelected] = useState<ClipDetail | null>(null)
  const [scope, setScope] = useState('all')
  const [tagFilter, setTagFilter] = useState<string | undefined>()
  const [tags, setTags] = useState<Tag[]>([])
  const [settings, setSettings] = useState<CaptureSettings | null>(null)
  const [notice, setNotice] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [transformOpen, setTransformOpen] = useState(false)
  const [activeTransform, setActiveTransform] = useState<TransformPreview | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchPage | null>(null)
  const [searchSettings, setSearchSettings] = useState<SearchSettings | null>(null)
  const [embeddingStatus, setEmbeddingStatus] = useState<ProviderStatus | null>(null)
  const [ftsOnly, setFtsOnly] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composing = useRef(false)
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = async () => {
    setPage(
      await invoke<ClipPage>('list_clips', { request: { limit: 50, scope, tagId: tagFilter } })
    )
    setTags(await invoke<Tag[]>('list_tags'))
  }
  useEffect(() => {
    void invoke<ClipPage>('list_clips', { request: { limit: 50, scope, tagId: tagFilter } }).then(
      setPage
    )
    void invoke<Tag[]>('list_tags').then(setTags)
    void invoke<SearchSettings>('get_search_settings').then(setSearchSettings)
    void invoke<ProviderStatus>('get_text_embedding_status').then(setEmbeddingStatus)
  }, [scope, tagFilter])

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    const trimmed = searchQuery.trim()
    searchDebounce.current = setTimeout(() => {
      if (!trimmed) {
        setSearchResults(null)
        return
      }
      void invoke<SearchPage>('search_clips', {
        request: {
          query: trimmed,
          scope,
          tagId: tagFilter,
          limit: 50,
          mode: ftsOnly ? 'fts' : undefined,
        },
      }).then(setSearchResults)
    }, 200)
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current)
    }
  }, [searchQuery, scope, tagFilter, ftsOnly])
  useEffect(() => {
    const refresh = () =>
      void invoke<ClipPage>('list_clips', { request: { limit: 50, scope, tagId: tagFilter } }).then(
        setPage
      )
    const subscriptions = [
      'clip-captured',
      'clip-updated',
      'clip-deleted',
      'clip-facets-updated',
    ].map(event => listen(event, refresh))
    return () => {
      void Promise.all(subscriptions).then(values => values.forEach(unlisten => unlisten()))
    }
  }, [scope, tagFilter])
  const select = async (clip: ClipSummary) =>
    setSelected(await invoke<ClipDetail>('get_clip_detail', { clipId: clip.id }))
  const capture = async () => {
    try {
      await invoke('capture_clipboard')
      await load()
      setNotice('Captured clipboard snapshot.')
    } catch (e) {
      setNotice(String(e))
    }
  }
  const action = async (command: string, args: Record<string, unknown>) => {
    await invoke(command, args)
    await load()
    if (command === 'delete_clip') {
      setSelected(null)
    } else if (selected) {
      setSelected(await invoke<ClipDetail>('get_clip_detail', { clipId: selected.clip.id }))
    }
  }
  useEffect(() => {
    const start = () => {
      if (compositionTimer.current) clearTimeout(compositionTimer.current)
      composing.current = true
    }
    const end = () => {
      compositionTimer.current = setTimeout(() => {
        composing.current = false
      }, 100)
    }
    const key = (event: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      if (composing.current || typing || hasNativeSelection()) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const next = Math.max(
          0,
          Math.min(page.items.length - 1, selectedIndex + (event.key === 'ArrowDown' ? 1 : -1))
        )
        setSelectedIndex(next)
        const clip = page.items[next]
        if (clip) void select(clip)
      }
      if (event.key.toLowerCase() === 't' && selected) {
        event.preventDefault()
        setTransformOpen(true)
      }
      if (event.key === 'Enter' && selected) {
        event.preventDefault()
        if ((event.ctrlKey || event.metaKey) && activeTransform)
          void invoke('paste_clip_output', {
            policy: { kind: 'transformed', resultId: activeTransform.resultId },
          })
        else if (event.shiftKey)
          void invoke('paste_clip_output', {
            policy: { kind: 'plain_text', clipId: selected.clip.id },
          })
        else
          void invoke('paste_clip_output', {
            policy: { kind: 'original', clipId: selected.clip.id },
          })
      }
      if (event.key === 'Delete' && selected) {
        event.preventDefault()
        void action('delete_clip', { clipId: selected.clip.id })
      }
    }
    window.addEventListener('compositionstart', start)
    window.addEventListener('compositionend', end)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('compositionstart', start)
      window.removeEventListener('compositionend', end)
      window.removeEventListener('keydown', key)
      if (compositionTimer.current) clearTimeout(compositionTimer.current)
    }
  })
  const scopes: Array<[string, string]> = [
    ['all', 'All'],
    ['favorites', 'Favorites'],
    ['pinned', 'Pinned'],
  ]
  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">ClipsX</h1>
          <p className="text-sm text-slate-400">Original representations, stored locally.</p>
        </div>
        <div className="flex gap-2">
          <button className="button" onClick={() => void capture()}>
            Capture clipboard
          </button>
          <button
            className="button"
            onClick={() => {
              const name = window.prompt('Tag name')
              if (name?.trim())
                void invoke<Tag>('create_tag', { name: name.trim(), color: null }).then(tag =>
                  setTags(current => [...current, tag].sort((a, b) => a.name.localeCompare(b.name)))
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
                  if (!model) return
                  return invoke<ProviderStatus>('configure_text_embedding_provider', {
                    endpoint,
                    model,
                  })
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
          ref={searchInputRef}
          className="flex-1 rounded bg-slate-800 px-3 py-1.5 text-sm outline-none ring-1 ring-slate-700 focus:ring-sky-500"
          type="search"
          placeholder="Search clips… (⌘F)"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && setSearchQuery('')}
          aria-label="Search clips"
        />
        {searchSettings && (
          <button
            className="tag text-xs"
            title={`Syntax: ${searchSettings.syntaxMode}`}
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
            title="Toggle semantic hybrid search for this session"
          >
            {ftsOnly ? 'FTS only' : 'Hybrid'}
          </button>
        )}
      </div>
      <nav className="mb-4 flex gap-2">
        {scopes.map(([value, label]) => (
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
                if (window.confirm(`Delete tag “${tag.name}”?`))
                  void invoke('delete_tag', { tagId: tag.id }).then(() => {
                    setTags(current => current.filter(item => item.id !== tag.id))
                    if (tagFilter === tag.id) setTagFilter(undefined)
                  })
              }}
            >
              ×
            </button>
          </span>
        ))}
      </nav>
      <div className="grid min-h-[70vh] grid-cols-[minmax(18rem,2fr)_minmax(22rem,3fr)] gap-4">
        <section className="panel overflow-auto">
          {searchResults !== null ? (
            searchResults.items.length === 0 ? (
              <p className="p-6 text-slate-400">No results for "{searchQuery}".</p>
            ) : (
              searchResults.items.map(result => (
                <button
                  key={result.clip.id}
                  className="clip"
                  aria-selected={selected?.clip.id === result.clip.id}
                  onClick={() => {
                    void select(result.clip)
                  }}
                >
                  <div className="flex justify-between gap-2">
                    <strong className="truncate">{result.clip.safeSummary}</strong>
                  </div>
                  {result.snippet && result.snippet !== result.clip.safeSummary && (
                    <p className="mt-1 text-xs text-slate-300 line-clamp-2">{result.snippet}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {result.clip.sourceAppName ?? 'Unknown app'} · {date(result.clip.capturedAt)}
                  </p>
                </button>
              ))
            )
          ) : page.items.length === 0 ? (
            <p className="p-6 text-slate-400">No clips yet. Capture your clipboard to begin.</p>
          ) : (
            page.items.map(clip => (
              <button
                key={clip.id}
                className="clip"
                aria-selected={selected?.clip.id === clip.id}
                onClick={() => {
                  setSelectedIndex(page.items.indexOf(clip))
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
                <p className="mt-1 text-xs text-slate-400">
                  {clip.sourceAppName ?? 'Unknown app'} · {date(clip.capturedAt)} ·{' '}
                  {clip.representationCount} representations
                </p>
                {clip.tags.length > 0 && (
                  <p className="mt-1 text-xs text-sky-300">
                    {clip.tags.map(t => t.name).join(', ')}
                  </p>
                )}
              </button>
            ))
          )}
          {!searchResults && page.nextCursor && (
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
            <Detail
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
        <Settings
          settings={settings}
          close={() => setSettings(null)}
          save={async value => {
            await invoke('update_capture_settings', { settings: value })
            setSettings(null)
          }}
        />
      )}
    </main>
  )
}
const Detail = ({
  detail,
  action,
  tags,
  transformOpen,
  setTransformOpen,
  setActiveTransform,
}: {
  detail: ClipDetail
  action: (c: string, a: Record<string, unknown>) => Promise<void>
  tags: Tag[]
  transformOpen: boolean
  setTransformOpen: (value: boolean) => void
  setActiveTransform: (value: TransformPreview | null) => void
}) => (
  <>
    <div className="flex gap-2">
      <button
        className="button"
        onClick={() => void invoke('copy_clip_original', { clipId: detail.clip.id })}
      >
        Copy original
      </button>
      <button className="button" onClick={() => setTransformOpen(!transformOpen)}>
        Transform (T)
      </button>
      <button
        className="button"
        onClick={() =>
          void action('set_clip_pinned', { clipId: detail.clip.id, value: !detail.clip.isPinned })
        }
      >
        {detail.clip.isPinned ? 'Unpin' : 'Pin'}
      </button>
      <button
        className="button"
        onClick={() =>
          void action('set_clip_favorite', {
            clipId: detail.clip.id,
            value: !detail.clip.isFavorite,
          })
        }
      >
        {detail.clip.isFavorite ? 'Unfavorite' : 'Favorite'}
      </button>
      <button
        className="button danger"
        onClick={() => void action('delete_clip', { clipId: detail.clip.id })}
      >
        Delete
      </button>
    </div>
    <textarea
      className="mt-4 w-full rounded bg-slate-800 p-2"
      placeholder="Note"
      defaultValue={detail.clip.note}
      onBlur={e =>
        void action('update_clip_note', {
          clipId: detail.clip.id,
          note: e.currentTarget.value || null,
        })
      }
    />
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map(tag => (
        <button
          key={tag.id}
          className="tag"
          onClick={() =>
            void action(
              detail.clip.tags.some(t => t.id === tag.id) ? 'remove_clip_tag' : 'add_clip_tag',
              { clipId: detail.clip.id, tagId: tag.id }
            )
          }
        >
          {detail.clip.tags.some(t => t.id === tag.id) ? '✓ ' : ''}
          {tag.name}
        </button>
      ))}
    </div>
    <Views clipId={detail.clip.id} />
    {transformOpen && (
      <Transformations
        clipId={detail.clip.id}
        representations={detail.representations}
        close={() => setTransformOpen(false)}
        setActive={setActiveTransform}
      />
    )}
    <h2 className="mt-6 font-semibold">Raw representations</h2>
    {detail.representations.map(rep => (
      <article key={rep.id} className="mt-3 rounded border border-slate-700 p-3">
        <p className="text-sm font-medium">
          {rep.ordinal + 1}. {rep.formatKey}
        </p>
        <p className="text-xs text-slate-400">
          {rep.storageKind} · {rep.byteLength} bytes {rep.nativeType && ` · ${rep.nativeType}`}
        </p>
        {rep.textValue !== undefined && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs">
            {rep.textValue}
          </pre>
        )}
        {rep.fileReferences.length > 0 && (
          <ol className="mt-2 list-decimal pl-5 text-sm">
            {rep.fileReferences.map(file => (
              <li key={file}>{file}</li>
            ))}
          </ol>
        )}
        {rep.binaryFileId && (
          <p className="mt-2 text-xs text-slate-400">Binary asset {rep.sha256}</p>
        )}
      </article>
    ))}
  </>
)

const Transformations = ({
  clipId,
  representations,
  close,
  setActive,
}: {
  clipId: string
  representations: ClipDetail['representations']
  close: () => void
  setActive: (value: TransformPreview | null) => void
}) => {
  const [items, setItems] = useState<TransformerDescriptor[]>([])
  const [preferences, setPreferences] = useState<TransformPreferences>({
    favoriteTransformerIds: [],
  })
  const [transformerId, setTransformerId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [rootName, setRootName] = useState('Root')
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void Promise.all([
      invoke<TransformerDescriptor[]>('list_transformer_contributions', { clipId }),
      invoke<TransformPreferences>('get_transform_preferences'),
    ]).then(([descriptors, prefs]) => {
      const ordered = [...descriptors].sort((a, b) => {
        const af = prefs.favoriteTransformerIds.includes(a.id) ? 0 : 1
        const bf = prefs.favoriteTransformerIds.includes(b.id) ? 0 : 1
        return af - bf || a.label.localeCompare(b.label)
      })
      setItems(ordered)
      setPreferences(prefs)
      setTransformerId(ordered[0]?.id ?? '')
      setSourceId(
        representations.find(rep => rep.textValue !== undefined)?.id ?? representations[0]?.id ?? ''
      )
    })
  }, [clipId, representations])
  const run = async () => {
    try {
      const parameters =
        transformerId === 'builtin.transform.json.to_typescript' ? { rootName } : {}
      const value = await invoke<TransformPreview>('create_transform_preview', {
        clipId,
        transformerId,
        sourceId,
        parameters,
      })
      setPreview(value)
      setActive(value)
      setError('')
    } catch (reason) {
      setError(String(reason))
    }
  }
  const favorite = async () => {
    if (!transformerId) return
    const ids = preferences.favoriteTransformerIds.includes(transformerId)
      ? preferences.favoriteTransformerIds.filter(id => id !== transformerId)
      : [...preferences.favoriteTransformerIds, transformerId]
    const next = { favoriteTransformerIds: ids }
    await invoke('update_transform_preferences', { preferences: next })
    setPreferences(next)
  }
  return (
    <section
      className="mt-6 rounded border border-sky-800 bg-slate-900 p-3"
      aria-label="Transformations"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Transform</h2>
        <button className="tag" onClick={close}>
          Esc
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          Utility
          <select
            className="mt-1 w-full rounded bg-slate-800 p-2"
            value={transformerId}
            onChange={e => setTransformerId(e.target.value)}
          >
            {items.map(item => (
              <option key={item.id} value={item.id}>
                {preferences.favoriteTransformerIds.includes(item.id) ? '★ ' : ''}
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Source
          <select
            className="mt-1 w-full rounded bg-slate-800 p-2"
            value={sourceId}
            onChange={e => setSourceId(e.target.value)}
          >
            {representations
              .filter(rep => rep.textValue !== undefined || rep.binaryFileId)
              .map(rep => (
                <option key={rep.id} value={rep.id}>
                  {rep.formatKey}
                </option>
              ))}
          </select>
        </label>
      </div>
      {transformerId === 'builtin.transform.json.to_typescript' && (
        <label className="mt-2 block text-sm">
          Root type name
          <input
            className="mt-1 w-full rounded bg-slate-800 p-2"
            value={rootName}
            onChange={e => setRootName(e.target.value)}
          />
        </label>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className="button"
          disabled={!transformerId || !sourceId}
          onClick={() => void run()}
        >
          Preview
        </button>
        <button className="tag" disabled={!transformerId} onClick={() => void favorite()}>
          {preferences.favoriteTransformerIds.includes(transformerId) ? 'Unfavorite' : 'Favorite'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {preview && (
        <div className="mt-3">
          <RenderView model={preview.model} />
          <p className="mt-2 text-xs text-slate-400">
            Expires {date(preview.expiresAt)} ·{' '}
            {preview.outputs
              .map(output => `${output.canonicalMimeType ?? 'binary'} ${output.byteLength} bytes`)
              .join(', ')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="button"
              onClick={() =>
                void invoke('copy_clip_output', {
                  policy: { kind: 'transformed', resultId: preview.resultId },
                })
              }
            >
              Copy transformed
            </button>
            <button
              className="button"
              onClick={() =>
                void invoke('paste_clip_output', {
                  policy: { kind: 'transformed', resultId: preview.resultId },
                })
              }
            >
              Paste transformed
            </button>
            <button
              className="button"
              onClick={() =>
                void invoke<string>('save_transform_result', { resultId: preview.resultId }).then(
                  close
                )
              }
            >
              Save as new clip
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
const Views = ({ clipId }: { clipId: string }) => {
  const [viewSet, setViewSet] = useState<ClipViewSet | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [model, setModel] = useState<RenderModel | null>(null)
  useEffect(() => {
    void invoke<ClipViewSet>('get_clip_views', { clipId }).then(value => {
      setViewSet(value)
      setActive(value.views[0]?.id ?? null)
    })
  }, [clipId])
  useEffect(() => {
    const view = viewSet?.views.find(item => item.id === active)
    if (view)
      void invoke<RenderModel>('render_clip_view', {
        clipId,
        rendererId: view.rendererId,
        sourceId: view.sourceId,
      }).then(setModel)
  }, [active, clipId, viewSet])
  if (!viewSet || viewSet.views.length === 0) return null
  const activeView = viewSet.views.find(view => view.id === active)
  const makeDefault = async () => {
    if (!activeView) return
    const preferences = await invoke<RendererPreferences>('get_renderer_preferences')
    if (activeView.facetId) preferences.byFacetId[activeView.facetId] = activeView.rendererId
    else if (activeView.mimeType)
      preferences.byMimeType[activeView.mimeType] = activeView.rendererId
    else return
    await invoke('update_renderer_preferences', { preferences })
  }
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Views</h2>
        {activeView && !activeView.isOriginal && (activeView.facetId || activeView.mimeType) && (
          <button className="tag" onClick={() => void makeDefault()}>
            Use as default
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {viewSet.views.map(view => (
          <button
            key={view.id}
            className={active === view.id ? 'tab tab-active' : 'tab'}
            onClick={() => setActive(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>
      {model && <RenderView model={model} />}
    </section>
  )
}
const RenderView = ({ model }: { model: RenderModel }) => {
  if (model.kind === 'html')
    return (
      <iframe
        className="mt-3 min-h-48 w-full rounded bg-white"
        sandbox=""
        srcDoc={model.sanitizedHtml}
        title="Sanitized HTML preview"
      />
    )
  if (model.kind === 'image') {
    const source = clipsxAssetUrl(model.artifactId)
    return <img className="mt-3 max-h-80 rounded" src={source} alt="Captured clipboard" />
  }
  if (model.kind === 'tree')
    return (
      <pre className="mt-3 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-xs">
        {JSON.stringify(model.value, null, 2)}
      </pre>
    )
  if (model.kind === 'table')
    return (
      <div className="mt-3 overflow-auto">
        <table className="text-sm">
          <thead>
            <tr>
              {model.columns.map(column => (
                <th key={column} className="border border-slate-700 p-2 text-left">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-slate-700 p-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  if (model.kind === 'key_value')
    return (
      <dl className="mt-3 space-y-1 text-sm">
        {model.entries.map(([key, value]) => (
          <div key={key}>
            <dt className="inline font-medium">{key}: </dt>
            <dd className="inline text-slate-300">{value}</dd>
          </div>
        ))}
      </dl>
    )
  const text =
    model.kind === 'code'
      ? model.text
      : model.kind === 'text'
        ? model.text
        : model.kind === 'markdown'
          ? model.markdown
          : model.kind === 'error'
            ? model.message
            : 'Binary preview unavailable'
  return (
    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs">
      {text}
    </pre>
  )
}
const Settings = ({
  settings,
  close,
  save,
}: {
  settings: CaptureSettings
  close: () => void
  save: (s: CaptureSettings) => Promise<void>
}) => {
  const [value, setValue] = useState(settings)
  const field = (key: keyof CaptureSettings, label: string) => (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded bg-slate-800 p-2"
        type="number"
        value={value[key] ?? ''}
        placeholder="Disabled"
        onChange={e =>
          setValue({ ...value, [key]: e.target.value === '' ? undefined : Number(e.target.value) })
        }
      />
    </label>
  )
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60">
      <section className="panel w-full max-w-md p-5">
        <h2 className="text-lg font-semibold">Storage limits</h2>
        <p className="my-2 text-sm text-slate-400">
          Blank disables a limit. Pinned and favorite clips are protected.
        </p>
        <p className="mb-3 text-xs text-slate-500">
          Currently using {value.managedBytesUsed.toLocaleString()} managed bytes.
        </p>
        {value.retentionWarning && (
          <p className="mb-3 rounded bg-amber-950 p-2 text-sm text-amber-200">
            {value.retentionWarning}
          </p>
        )}
        <div className="space-y-3">
          {field('maxOrdinaryClips', 'Maximum ordinary clips')}
          {field('maxAgeDays', 'Expiry days')}
          {field('maxManagedBytes', 'Managed bytes')}
          {field('maxRepresentationBytes', 'Maximum representation bytes')}
          {field('maxSnapshotBytes', 'Maximum snapshot bytes')}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="button" onClick={close}>
            Cancel
          </button>
          <button className="button" onClick={() => void save(value)}>
            Save
          </button>
        </div>
      </section>
    </div>
  )
}
export default App
