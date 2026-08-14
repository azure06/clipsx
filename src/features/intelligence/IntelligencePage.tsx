import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  Plus,
  PlugZap,
  RefreshCw,
  ScanSearch,
  Server,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Unplug,
  Wand2,
} from 'lucide-react'
import type { SearchSourceDescriptor, TextEmbeddingStatus } from '../../shared/types/v2'
import { Switch } from '../../shared/components/ui'

type OllamaModelDescriptor = { name: string; digest: string | null; size: number | null }
type OllamaEndpointStatus = { reachable: boolean; endpoint: string; diagnostic: string | null }
type SearchSettings = { syntaxMode: 'simple' | 'advanced'; enabledSourceIds: string[] }

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const explainOllamaDiagnostic = (diagnostic: string): string => {
  if (diagnostic === 'Ollama returned 400 Bad Request') {
    return 'Ollama rejected a previous embedding request. Retry now; if it happens again, ClipsX will show Ollama’s specific reason. It is often an outdated Ollama version, a model that cannot create embeddings, or text that exceeds the model context.'
  }
  return diagnostic
}

export const IntelligencePage = () => {
  const [endpoint, setEndpoint] = useState('http://localhost:11434')
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<OllamaEndpointStatus | null>(null)
  const [models, setModels] = useState<OllamaModelDescriptor[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [selectedModel, setSelectedModel] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [status, setStatus] = useState<TextEmbeddingStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [reindexing, setReindexing] = useState(false)
  const [indexingMissing, setIndexingMissing] = useState(false)
  const [clearingIndex, setClearingIndex] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(false)
  const [searchSources, setSearchSources] = useState<SearchSourceDescriptor[]>([])
  const [searchSettings, setSearchSettings] = useState<SearchSettings | null>(null)

  const isConfigured = Boolean(
    status?.endpoint && status?.model && status.phase !== 'not_configured'
  )

  const loadStatus = useCallback(async () => {
    try {
      const [s, sources, settings] = await Promise.all([
        invoke<TextEmbeddingStatus>('get_text_embedding_status'),
        invoke<SearchSourceDescriptor[]>('list_search_sources'),
        invoke<SearchSettings>('get_search_settings'),
      ])
      setStatus(s)
      setSearchSources(sources)
      setSearchSettings(settings)
      if (s.endpoint) setEndpoint(s.endpoint)
      if (s.model) setSelectedModel(s.model)
      // Auto-expand config form when not yet configured
      if (!s.endpoint) setConfigExpanded(true)
    } catch {
      /* silent */
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const u1 = listen('embedding-provider-status-changed', () => void loadStatus())
    const u2 = listen('embedding-space-changed', () => void loadStatus())
    const u3 = listen('embedding-index-progress', () => void loadStatus())
    const u4 = listen('search-source-status-changed', () => void loadStatus())
    const u5 = listen('search-index-progress', () => void loadStatus())
    return () => {
      void u1.then(f => f())
      void u2.then(f => f())
      void u3.then(f => f())
      void u4.then(f => f())
      void u5.then(f => f())
    }
  }, [loadStatus])

  const handleProbe = async () => {
    setProbing(true)
    setProbeResult(null)
    setModels([])
    setConfigError(null)
    try {
      const result = await invoke<OllamaEndpointStatus>('probe_ollama_endpoint', { endpoint })
      setProbeResult(result)
      if (result.reachable) {
        setLoadingModels(true)
        try {
          const ms = await invoke<OllamaModelDescriptor[]>('list_ollama_models', { endpoint })
          setModels(ms)
          if (ms.length > 0) {
            setSelectedModel(prev => {
              const stillValid = ms.some(m => m.name === prev)
              return stillValid ? prev : (ms[0]?.name ?? '')
            })
          }
        } catch {
          /* keep models empty */
        } finally {
          setLoadingModels(false)
        }
      }
    } catch {
      /* probe error */
    } finally {
      setProbing(false)
    }
  }

  const handleConnect = async () => {
    if (!selectedModel) return
    setConnecting(true)
    setConfigError(null)
    try {
      const next = await invoke<TextEmbeddingStatus>('configure_text_embedding_provider', {
        endpoint,
        model: selectedModel,
      })
      setStatus(next)
      setConfigExpanded(false)
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await invoke('disable_text_embedding_provider')
      setConfigExpanded(true)
    } catch {
      /* silent */
    }
  }

  const handleReindex = async () => {
    setReindexing(true)
    try {
      await invoke('reindex_text_embeddings')
    } catch {
      /* silent */
    } finally {
      setReindexing(false)
    }
  }

  const handleIndexMissing = async () => {
    setIndexingMissing(true)
    try {
      await invoke('index_missing_text_embeddings')
    } catch {
      /* silent */
    } finally {
      setIndexingMissing(false)
    }
  }

  const handleClearIndex = async () => {
    if (!status?.activeSpaceId) return
    if (!window.confirm('Clear the current meaning-search index? It can be rebuilt later.')) return
    setClearingIndex(true)
    try {
      await invoke('clear_text_embedding_space', { spaceId: status.activeSpaceId })
      await loadStatus()
    } catch {
      /* silent */
    } finally {
      setClearingIndex(false)
    }
  }

  const handleRetry = async () => {
    await invoke('retry_text_embedding_provider')
    await loadStatus()
  }

  const updateSearchSettings = async (next: SearchSettings) => {
    setSearchSettings(next)
    await invoke('update_search_settings', { settings: next })
    await loadStatus()
  }

  const toggleSource = async (sourceId: string) => {
    if (!searchSettings || sourceId === 'builtin.search.fts') return
    const enabledSourceIds = searchSettings.enabledSourceIds.includes(sourceId)
      ? searchSettings.enabledSourceIds.filter(id => id !== sourceId)
      : [...searchSettings.enabledSourceIds, sourceId]
    await updateSearchSettings({ ...searchSettings, enabledSourceIds })
  }

  const canConnect = Boolean(selectedModel && endpoint.trim())
  const showModelSelector = probeResult?.reachable || Boolean(status?.model)

  // Progress bar math
  const indexing = status?.phase === 'indexing'
  const total = status?.totalClips ?? 0
  const progressPct = total > 0 ? Math.round((status!.indexedClips / total) * 100) : 100

  return (
    <div className="relative flex h-full flex-col overflow-auto p-8">
      <div
        aria-hidden
        className="animate-dot-drift pointer-events-none absolute inset-0 opacity-[0.4] dark:opacity-[0.25]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(139 92 246) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 30%, transparent 75%)',
        }}
      />
      <div className="relative mx-auto w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-violet-500/20 to-pink-500/20">
            <Sparkles className="h-5 w-5 text-violet-500" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Intelligence</h1>
            <p className="text-xs text-gray-500">
              On-device AI — semantic search, image search, and more
            </p>
          </div>
        </div>

        {/* Semantic Search */}
        <div className="space-y-4 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 dark:border-white/10 dark:bg-slate-100/5">
          {/* Section header */}
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Semantic Search
            </span>
            {loadingStatus && (
              <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-gray-400" />
            )}
            {!loadingStatus && status && (
              <span
                className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.phase === 'ready' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : status.phase === 'degraded' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'}`}
              >
                {status.phase === 'ready' ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
                {status.phase.replaceAll('_', ' ')}
              </span>
            )}
          </div>

          {/* Index stats + progress bar */}
          {isConfigured && status && (
            <div className="space-y-3 rounded-xl border border-slate-200/60 bg-slate-100/30 p-4 dark:border-white/5 dark:bg-slate-100/5">
              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span>
                    {indexing
                      ? `Indexing… ${status.indexedClips.toLocaleString()} / ${total.toLocaleString()} clips`
                      : `${status.indexedClips.toLocaleString()} clips indexed`}
                  </span>
                  <span className="tabular-nums font-medium">{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      indexing
                        ? 'bg-linear-to-r from-violet-500 to-pink-500 animate-pulse'
                        : 'bg-linear-to-r from-violet-500 to-emerald-500'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {indexing && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    {status.pendingJobs.toLocaleString()} clips pending
                  </p>
                )}
              </div>

              {status.diagnostic && (
                <div className="flex items-start justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                  <span>
                    <span className="font-semibold">Meaning Search needs attention. </span>
                    {explainOllamaDiagnostic(status.diagnostic)}
                    {status.failedJobs > 0 && (
                      <span className="mt-1 block">
                        {status.failedJobs.toLocaleString()} indexing job
                        {status.failedJobs === 1 ? '' : 's'} can be retried.
                      </span>
                    )}
                  </span>
                  <button className="font-semibold underline" onClick={() => void handleRetry()}>
                    Retry
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                  disabled={reindexing}
                  onClick={() => void handleReindex()}
                >
                  {reindexing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Reindex all
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                  disabled={indexingMissing}
                  onClick={() => void handleIndexMissing()}
                >
                  {indexingMissing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Index missing
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-red-200/70 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10"
                  disabled={clearingIndex}
                  onClick={() => void handleClearIndex()}
                >
                  {clearingIndex ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Clear index
                </button>
              </div>
            </div>
          )}

          {/* Config toggle — show summary when configured, expand on demand */}
          {isConfigured && (
            <button
              className="flex w-full items-center gap-1.5 text-[11px] text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
              onClick={() => setConfigExpanded(v => !v)}
            >
              {configExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {configExpanded
                ? 'Hide configuration'
                : `Configuration — ${status?.model ?? ''} @ ${status?.endpoint ?? ''}`}
            </button>
          )}

          {/* Ollama config form — always shown when not connected, toggled when connected */}
          {(!isConfigured || configExpanded) && (
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Ollama Endpoint
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-white/10 dark:bg-slate-100/5">
                  <Server className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                    placeholder="http://localhost:11434"
                    value={endpoint}
                    onChange={e => setEndpoint(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void handleProbe()
                    }}
                  />
                </div>
                <button
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                  disabled={probing || !endpoint.trim()}
                  onClick={() => void handleProbe()}
                >
                  {probing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {probing ? 'Testing…' : 'Test'}
                </button>
              </div>

              {probeResult && (
                <div
                  className={`flex items-center gap-1.5 text-xs ${probeResult.reachable ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                >
                  {probeResult.reachable ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {probeResult.reachable ? 'Reachable' : (probeResult.diagnostic ?? 'Unreachable')}
                </div>
              )}

              {showModelSelector && (
                <div className="space-y-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Embedding Model
                  </div>
                  {loadingModels ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading models…
                    </div>
                  ) : models.length > 0 ? (
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm outline-none dark:border-white/10 dark:bg-slate-100/5"
                      value={selectedModel}
                      onChange={e => setSelectedModel(e.target.value)}
                    >
                      {models.map(m => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                          {m.size ? ` (${formatBytes(m.size)})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-white/10 dark:bg-slate-100/5">
                      <input
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                        placeholder="e.g. nomic-embed-text"
                        value={selectedModel}
                        onChange={e => setSelectedModel(e.target.value)}
                      />
                    </div>
                  )}

                  {configError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
                      {configError}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
                      disabled={!canConnect || connecting}
                      onClick={() => void handleConnect()}
                    >
                      {connecting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PlugZap className="h-3.5 w-3.5" />
                      )}
                      {connecting
                        ? 'Validating model…'
                        : status?.phase === 'disabled'
                          ? 'Enable'
                          : isConfigured
                            ? 'Update'
                            : 'Connect'}
                    </button>
                    {isConfigured && status?.phase !== 'disabled' && (
                      <button
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs transition-colors hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
                        onClick={() => void handleDisconnect()}
                      >
                        <Unplug className="h-3.5 w-3.5" />
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search Configuration — sources + advanced syntax */}
        <div className="space-y-4 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 dark:border-white/10 dark:bg-slate-100/5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Search Configuration
            </span>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Sources
            </div>
            <p className="text-xs text-gray-500">
              Choose which independent searches contribute candidates. Indexing continues when a
              source is off.
            </p>
            <div className="space-y-2 pt-1">
              {searchSources.map(source => (
                <div
                  key={source.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/60 px-3 py-2 dark:border-white/10"
                >
                  <div>
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                      {source.label}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {source.mandatory ? 'Always on' : source.state.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <Switch
                    size="sm"
                    checked={source.enabled}
                    disabled={source.mandatory}
                    onChange={() => void toggleSource(source.id)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="h-px bg-slate-200/60 dark:bg-white/10" />

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Advanced keyword queries
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Allow raw FTS5 syntax such as <code>car OR truck</code> and <code>title*</code>.
                This only changes Keyword Search.
              </p>
            </div>
            <Switch
              size="sm"
              className="shrink-0"
              checked={searchSettings?.syntaxMode === 'advanced'}
              onChange={checked =>
                searchSettings &&
                void updateSearchSettings({
                  ...searchSettings,
                  syntaxMode: checked ? 'advanced' : 'simple',
                })
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 opacity-60 dark:border-white/10 dark:bg-slate-100/5">
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Visual Image Search
            </span>
            <span className="ml-auto rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/10">
              coming soon
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Semantic search over screenshots and images — find a beach photo by searching "ocean
            sunset".
          </p>
        </div>

        {/* AI Generation — coming soon */}
        <div className="rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 opacity-60 dark:border-white/10 dark:bg-slate-100/5">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-pink-400" strokeWidth={1.5} />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              AI Generation
            </span>
            <span className="ml-auto rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/10">
              coming soon
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Summarize, expand, and transform clipboard content with a local model.
          </p>
        </div>
      </div>
    </div>
  )
}
