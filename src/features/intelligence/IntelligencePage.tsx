import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  LayoutDashboard,
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
import { Button, Select, Switch } from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'

type OllamaModelDescriptor = { name: string; digest: string | null; size: number | null }
type OllamaEndpointStatus = { reachable: boolean; endpoint: string; diagnostic: string | null }
type SearchSettings = { syntaxMode: 'simple' | 'advanced'; enabledSourceIds: string[] }
type GenerationProviderStatus = {
  enabled: boolean
  available: boolean
  diagnostic: string | null
  endpoint: string | null
  model: string | null
}

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

const toErrorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type IndexAction = 'reindex' | 'index_missing' | 'retry'
type ActiveIndexAction = {
  kind: IndexAction
  stage: 'submitting' | 'tracking'
}

const intelligenceSections: Array<{
  id: 'overview' | 'search' | 'models' | 'indexing' | 'vision'
  label: string
  description: string
}> = [
  { id: 'overview', label: 'Overview', description: 'What is active and needs attention' },
  { id: 'search', label: 'Search', description: 'How ClipsX finds clips' },
  { id: 'models', label: 'Models', description: 'Local Ollama models and providers' },
  { id: 'indexing', label: 'Indexing', description: 'Build and maintain search data' },
  { id: 'vision', label: 'OCR & vision', description: 'Image understanding' },
]

const indexActionLabel: Record<IndexAction, string> = {
  reindex: 'Reindex',
  index_missing: 'Index missing',
  retry: 'Retry',
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
  const [activeIndexAction, setActiveIndexAction] = useState<ActiveIndexAction | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [clearingIndex, setClearingIndex] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(false)
  const [searchSources, setSearchSources] = useState<SearchSourceDescriptor[]>([])
  const [searchSettings, setSearchSettings] = useState<SearchSettings | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<GenerationProviderStatus | null>(null)
  const [generationModel, setGenerationModel] = useState('')
  const [generationSaving, setGenerationSaving] = useState(false)
  const [activeSection, setActiveSection] =
    useState<(typeof intelligenceSections)[number]['id']>('models')
  const { toast } = useToast()
  const lastFailureToastRef = useRef<string | null>(null)

  const isConfigured = Boolean(
    status?.endpoint && status?.model && status.phase !== 'not_configured'
  )

  const loadStatus = useCallback(async (): Promise<TextEmbeddingStatus | null> => {
    try {
      const [s, sources, settings, generation] = await Promise.all([
        invoke<TextEmbeddingStatus>('get_text_embedding_status'),
        invoke<SearchSourceDescriptor[]>('list_search_sources'),
        invoke<SearchSettings>('get_search_settings'),
        invoke<GenerationProviderStatus>('get_text_generation_status'),
      ])
      setStatus(s)
      setSearchSources(sources)
      setSearchSettings(settings)
      if (generation) {
        setGenerationStatus(generation)
        if (generation.model) setGenerationModel(generation.model)
        if (generation.endpoint && !s.endpoint) setEndpoint(generation.endpoint)
      }
      if (s.endpoint) setEndpoint(s.endpoint)
      if (s.model) setSelectedModel(s.model)
      if (s.phase === 'ready') lastFailureToastRef.current = null
      // Auto-expand config form when not yet configured
      if (!s.endpoint) setConfigExpanded(true)
      return s
    } catch (e) {
      toast({
        title: 'Could not refresh Intelligence status',
        description: toErrorMessage(e),
        type: 'error',
      })
      return null
    } finally {
      setLoadingStatus(false)
    }
  }, [toast])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const u1 = listen('embedding-provider-status-changed', () => void loadStatus())
    const u2 = listen('embedding-space-changed', () => void loadStatus())
    const u3 = listen('search-source-status-changed', () => void loadStatus())
    const u4 = listen('search-index-progress', () => void loadStatus())
    const u5 = listen<string>('embedding-index-failed', event => {
      void loadStatus()
      const message = event.payload
      if (lastFailureToastRef.current !== message) {
        lastFailureToastRef.current = message
        toast({
          title: 'Meaning Search needs attention',
          description: explainOllamaDiagnostic(message),
          type: 'error',
        })
      }
    })
    return () => {
      void u1.then(f => f())
      void u2.then(f => f())
      void u3.then(f => f())
      void u4.then(f => f())
      void u5.then(f => f())
    }
  }, [loadStatus, toast])

  // Detect when a background index action (reindex / index missing / retry)
  // has actually settled, since the invoke() call itself resolves almost
  // instantly while the real work continues in the background worker.
  useEffect(() => {
    if (!activeIndexAction || activeIndexAction.stage !== 'tracking' || !status) return
    if (status.phase === 'indexing' || status.pendingJobs > 0) return
    const label = indexActionLabel[activeIndexAction.kind]
    if (status.failedJobs > 0 || status.diagnostic) {
      toast({
        title: `${label} completed with issues`,
        description: status.diagnostic
          ? explainOllamaDiagnostic(status.diagnostic)
          : `${status.failedJobs} job${status.failedJobs === 1 ? '' : 's'} failed.`,
        type: 'warning',
      })
    } else {
      toast({ title: `${label} complete`, type: 'success' })
    }
    setActiveIndexAction(null)
  }, [status, activeIndexAction, toast])

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
      setConfigError(toErrorMessage(e))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await invoke('disable_text_embedding_provider')
      setConfigExpanded(true)
      toast({ title: 'Meaning Search disconnected', type: 'success' })
    } catch (e) {
      toast({ title: 'Disconnect failed', description: toErrorMessage(e), type: 'error' })
    } finally {
      setDisconnecting(false)
    }
  }

  const handleGenerationConnect = async () => {
    if (!generationModel || !endpoint.trim()) return
    setGenerationSaving(true)
    try {
      const next = await invoke<GenerationProviderStatus>('configure_text_generation_provider', {
        endpoint,
        model: generationModel,
      })
      setGenerationStatus(next)
      toast({ title: 'Local text generation configured', type: 'success' })
    } catch (e) {
      toast({ title: 'Generation setup failed', description: toErrorMessage(e), type: 'error' })
    } finally {
      setGenerationSaving(false)
    }
  }

  const handleGenerationDisconnect = async () => {
    setGenerationSaving(true)
    try {
      await invoke('disable_text_generation_provider')
      await loadStatus()
      toast({ title: 'Local text generation disabled', type: 'success' })
    } finally {
      setGenerationSaving(false)
    }
  }

  const startIndexAction = async (action: IndexAction, command: string) => {
    if (activeIndexAction) return
    setActiveIndexAction({ kind: action, stage: 'submitting' })
    try {
      await invoke(command)
      const nextStatus = await loadStatus()
      if (!nextStatus) {
        setActiveIndexAction(null)
        return
      }
      setActiveIndexAction(current =>
        current?.kind === action ? { kind: action, stage: 'tracking' } : current
      )
    } catch (e) {
      toast({
        title: `${indexActionLabel[action]} failed`,
        description: toErrorMessage(e),
        type: 'error',
      })
      setActiveIndexAction(null)
    }
  }

  const handleReindex = () => startIndexAction('reindex', 'reindex_text_embeddings')
  const handleIndexMissing = () =>
    startIndexAction('index_missing', 'index_missing_text_embeddings')
  const handleRetry = () => startIndexAction('retry', 'retry_text_embedding_provider')

  const handleClearIndex = async () => {
    if (!status?.activeSpaceId) return
    if (!window.confirm('Clear the current meaning-search index? It can be rebuilt later.')) return
    setClearingIndex(true)
    try {
      await invoke('clear_text_embedding_space', { spaceId: status.activeSpaceId })
      await loadStatus()
      toast({ title: 'Index cleared', type: 'success' })
    } catch (e) {
      toast({ title: 'Clear index failed', description: toErrorMessage(e), type: 'error' })
    } finally {
      setClearingIndex(false)
    }
  }

  const updateSearchSettings = async (next: SearchSettings) => {
    const previous = searchSettings
    setSearchSettings(next)
    setSettingsSaving(true)
    try {
      await invoke('update_search_settings', { settings: next })
      await loadStatus()
    } catch (e) {
      setSearchSettings(previous)
      toast({
        title: 'Could not update search settings',
        description: toErrorMessage(e),
        type: 'error',
      })
    } finally {
      setSettingsSaving(false)
    }
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
      <div className="relative mx-auto w-full max-w-4xl space-y-6">
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

        <nav
          aria-label="Intelligence areas"
          role="tablist"
          className="relative flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-300/70 bg-slate-100/80 p-1 shadow-[0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-slate-800/60 dark:shadow-[0_6px_18px_rgba(0,0,0,0.16)]"
        >
          {intelligenceSections.map(section => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              onClick={() => setActiveSection(section.id)}
              className={`group flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${activeSection === section.id ? 'border-violet-400/25 bg-linear-to-r from-violet-500/15 to-fuchsia-500/10 text-violet-700 dark:text-violet-200' : 'border-transparent text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/6 dark:hover:text-slate-100'}`}
              title={section.description}
            >
              {section.id === 'overview' && (
                <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {section.id === 'search' && (
                <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {section.id === 'models' && <Wand2 className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.id === 'indexing' && <Database className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.id === 'vision' && <ScanSearch className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.label}
            </button>
          ))}
        </nav>

        {activeSection === 'overview' && (
          <div
            role="tabpanel"
            className="rounded-2xl border border-violet-200/70 bg-linear-to-br from-violet-500/[0.10] via-slate-50/70 to-transparent p-5 dark:border-violet-400/15 dark:from-violet-500/[0.14] dark:via-white/[0.035]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Your local intelligence
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Configure models, tune search, and maintain derived indexes without changing your
                  clips.
                </p>
              </div>
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-sm dark:bg-white/10 dark:text-slate-300">
                {status?.phase?.replaceAll('_', ' ') ?? 'not configured'}
              </span>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-white/70 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-black/10">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Meaning search
                </p>
                <p className="mt-1 truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                  {status?.model ?? 'Not configured'}
                </p>
              </div>
              <div className="rounded-xl border border-white/70 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-black/10">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Indexed
                </p>
                <p className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-100">
                  {status?.indexedClips?.toLocaleString() ?? '—'} clips
                </p>
              </div>
              <div className="rounded-xl border border-white/70 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-black/10">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Generation
                </p>
                <p className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-100">
                  {generationStatus?.available ? 'Available' : 'Not configured'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Semantic Search */}
        {(activeSection === 'models' || activeSection === 'indexing') && (
          <div
            role="tabpanel"
            className="space-y-4 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 dark:border-white/10 dark:bg-slate-100/5"
          >
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
              <div
                id="intelligence-indexing"
                className="scroll-mt-16 space-y-3 rounded-xl border border-slate-200/60 bg-slate-100/30 p-4 dark:border-white/5 dark:bg-slate-100/5"
              >
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
                    <button
                      className="flex items-center gap-1 font-semibold underline disabled:opacity-50"
                      disabled={activeIndexAction !== null}
                      onClick={() => void handleRetry()}
                    >
                      {activeIndexAction?.kind === 'retry' && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      Retry
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    isLoading={activeIndexAction?.kind === 'reindex'}
                    disabled={activeIndexAction !== null}
                    onClick={() => void handleReindex()}
                  >
                    Reindex all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                    isLoading={activeIndexAction?.kind === 'index_missing'}
                    disabled={activeIndexAction !== null}
                    onClick={() => void handleIndexMissing()}
                  >
                    Index missing
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    isLoading={clearingIndex}
                    disabled={clearingIndex}
                    onClick={() => void handleClearIndex()}
                  >
                    Clear index
                  </Button>
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
                    {probeResult.reachable
                      ? 'Reachable'
                      : (probeResult.diagnostic ?? 'Unreachable')}
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
                      <Select
                        className="w-full py-2"
                        value={selectedModel}
                        onChange={setSelectedModel}
                        options={models.map(model => ({
                          value: model.name,
                          label: `${model.name}${model.size ? ` (${formatBytes(model.size)})` : ''}`,
                        }))}
                      />
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
                        <Button
                          variant="outline"
                          leftIcon={<Unplug className="h-3.5 w-3.5" />}
                          isLoading={disconnecting}
                          disabled={disconnecting}
                          onClick={() => void handleDisconnect()}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeSection === 'search' && (
          <div role="tabpanel">
            {/* Search Configuration — sources + advanced syntax */}
            <div
              id="intelligence-search"
              className="scroll-mt-16 space-y-4 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 dark:border-white/10 dark:bg-slate-100/5"
            >
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
                        disabled={source.mandatory || settingsSaving}
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
                  disabled={settingsSaving}
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
          </div>
        )}

        {activeSection === 'vision' && (
          <div
            role="tabpanel"
            id="intelligence-vision"
            className="scroll-mt-16 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 opacity-60 dark:border-white/10 dark:bg-slate-100/5"
          >
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
        )}

        {activeSection === 'models' && (
          <div
            role="tabpanel"
            className="space-y-4 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 dark:border-white/10 dark:bg-slate-100/5"
          >
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-pink-400" strokeWidth={1.5} />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                Local Text Generation
              </span>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${generationStatus?.available ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200/70 text-gray-500 dark:bg-white/10'}`}
              >
                {generationStatus?.available ? 'available' : 'not configured'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Extensions can request generation through ClipsX without learning your Ollama endpoint
              or model configuration.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <input
                aria-label="Generation endpoint"
                className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm outline-none dark:border-white/10 dark:bg-slate-100/5"
                placeholder="http://localhost:11434"
                value={endpoint}
                onChange={event => setEndpoint(event.target.value)}
              />
              <input
                aria-label="Generation model"
                className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm outline-none dark:border-white/10 dark:bg-slate-100/5"
                placeholder="llama3.2"
                value={generationModel}
                onChange={event => setGenerationModel(event.target.value)}
              />
              <Button
                size="sm"
                isLoading={generationSaving}
                disabled={generationSaving || !endpoint.trim() || !generationModel.trim()}
                onClick={() => void handleGenerationConnect()}
              >
                {generationStatus?.enabled ? 'Update' : 'Enable'}
              </Button>
            </div>
            {generationStatus?.diagnostic && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {generationStatus.diagnostic}
              </p>
            )}
            {generationStatus?.enabled && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Unplug className="h-3.5 w-3.5" />}
                isLoading={generationSaving}
                disabled={generationSaving}
                onClick={() => void handleGenerationDisconnect()}
              >
                Disable generation
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
