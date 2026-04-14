import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettingsStore } from '../../stores'
import { Switch } from '../../shared/components/ui'
import type { SemanticStatus } from '../../shared/types'

const AVAILABLE_MODELS = [
  {
    id: 'all-MiniLM-L6-v2',
    name: 'English Fast',
    publisher: 'MiniLM-L6',
    size: '~22MB',
    desc: 'Lightning fast engine. Highly optimized for English text.',
  },
  {
    id: 'paraphrase-multilingual-MiniLM-L12-v2',
    name: 'Multilingual Support',
    publisher: 'Paraphrase-L12',
    size: '~117MB',
    desc: 'Slightly slower, but supports 50+ languages including Japanese, Spanish, and German.',
  },
]

interface ProgressPayload {
  model: string
  downloaded: number
  total: number
}

interface IndexStats {
  totalTextClips: number
  indexedClips: number
  pendingClips: number
}

interface IndexProgressPayload {
  done: number
  total: number
}

export const Plugins = () => {
  const { settings, loadSettings } = useSettingsStore()
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus | null>(null)
  const [downloadedModels, setDownloadedModels] = useState<string[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{
    downloaded: number
    total: number
  } | null>(null)
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null)
  const [indexProgress, setIndexProgress] = useState<IndexProgressPayload | null>(null)
  const [isReindexing, setIsReindexing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchSemanticStatus()
    void fetchDownloadedModels()
    void fetchIndexStats()

    const unlistenDownload = listen<ProgressPayload>('download-progress', event => {
      if (event.payload.model) {
        setDownloadingId(event.payload.model)
        setDownloadProgress({
          downloaded: event.payload.downloaded,
          total: event.payload.total,
        })
      }
    })

    const unlistenIndex = listen<IndexProgressPayload>('semantic-index-progress', event => {
      setIsReindexing(true)
      setIndexProgress(event.payload)
    })

    const unlistenStatus = listen('semantic-status-changed', () => {
      void fetchSemanticStatus()
      void fetchIndexStats()
    })

    return () => {
      void unlistenDownload.then(f => f())
      void unlistenIndex.then(f => f())
      void unlistenStatus.then(f => f())
    }
  }, [settings?.semantic_model])

  const fetchSemanticStatus = async () => {
    try {
      const status = await invoke<SemanticStatus>('get_semantic_status')
      setSemanticStatus(status)
    } catch (err) {
      console.error('Failed to check semantic status:', err)
    }
  }

  const fetchDownloadedModels = async () => {
    try {
      const models = await invoke<string[]>('get_downloaded_models')
      setDownloadedModels(models)
    } catch (err) {
      console.error('Failed to fetch downloaded models:', err)
    }
  }

  const fetchIndexStats = async () => {
    try {
      const stats = await invoke<IndexStats>('get_semantic_index_stats')
      setIndexStats(stats)
    } catch (err) {
      console.error('Failed to fetch semantic index stats:', err)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 MB'
    const mb = bytes / 1024 / 1024
    return `${mb.toFixed(1)} MB`
  }

  const handleSelectExistingModel = async (modelId: string) => {
    if (settings?.semantic_model === modelId && semanticStatus?.state === 'ready') return

    try {
      setError(null)

      const isDownloaded = downloadedModels.includes(modelId)

      if (!isDownloaded) {
        setDownloadingId(modelId)
      } else {
        setActivatingId(modelId)
      }

      await invoke('change_semantic_model', { modelName: modelId })
      await loadSettings()
      await fetchSemanticStatus()
      await fetchDownloadedModels()
      await fetchIndexStats()
    } catch (err) {
      setError(String(err))
      console.error('Failed to swap semantic model:', err)
    } finally {
      setDownloadingId(null)
      setActivatingId(null)
      setDownloadProgress(null)
    }
  }

  const handleSemanticEnabledChange = async (enabled: boolean) => {
    try {
      setError(null)
      setIsTogglingEnabled(true)

      await invoke('set_semantic_search_enabled', { enabled })
      await loadSettings()
      await fetchSemanticStatus()
      await fetchDownloadedModels()
      await fetchIndexStats()
    } catch (err) {
      setError(String(err))
      console.error('Failed to toggle semantic search:', err)
    } finally {
      setIsTogglingEnabled(false)
      setDownloadingId(null)
      setActivatingId(null)
      setDownloadProgress(null)
    }
  }

  const handleDeleteModel = async (modelId: string) => {
    try {
      setError(null)
      await invoke('delete_semantic_model', { modelName: modelId })
      await loadSettings()
      await fetchDownloadedModels()
      await fetchSemanticStatus()
      await fetchIndexStats()
    } catch (err) {
      setError(String(err))
      console.error('Failed to delete semantic model:', err)
    }
  }

  const handleReindex = async () => {
    try {
      setError(null)
      setIsReindexing(true)
      setIndexProgress({ done: 0, total: indexStats?.pendingClips ?? 0 })
      const stats = await invoke<IndexStats>('reindex_semantic_embeddings')
      setIndexStats(stats)
    } catch (err) {
      setError(String(err))
      console.error('Failed to reindex semantic embeddings:', err)
    } finally {
      setIsReindexing(false)
      setIndexProgress(null)
      await fetchIndexStats()
    }
  }

  const statusLabel =
    semanticStatus === null
      ? 'Checking…'
      : semanticStatus.state === 'ready'
        ? 'Ready'
        : semanticStatus.state === 'indexing'
          ? 'Indexing…'
          : semanticStatus.state === 'loading'
            ? 'Loading…'
            : semanticStatus.state === 'disabled'
              ? 'Disabled'
              : semanticStatus.state === 'missing_model'
                ? 'No model selected'
                : semanticStatus.state === 'error'
                  ? 'Error'
                  : 'Unknown'

  const statusTone =
    semanticStatus?.state === 'ready'
      ? 'text-emerald-600 dark:text-emerald-400'
      : semanticStatus?.state === 'indexing'
        ? 'text-blue-500 dark:text-blue-400'
        : semanticStatus?.state === 'loading'
          ? 'text-amber-600 dark:text-amber-400'
          : semanticStatus?.state === 'error'
            ? 'text-red-600 dark:text-red-400'
            : 'text-gray-400 dark:text-gray-500'

  const statusDot =
    semanticStatus?.state === 'ready'
      ? 'bg-emerald-500'
      : semanticStatus?.state === 'indexing'
        ? 'bg-blue-500 animate-pulse'
        : semanticStatus?.state === 'loading'
          ? 'bg-amber-500 animate-pulse'
          : semanticStatus?.state === 'error'
            ? 'bg-red-500'
            : 'bg-gray-400 dark:bg-gray-600'

  const activeModelInstalled = settings?.semantic_model
    ? downloadedModels.includes(settings.semantic_model)
    : false
  const isSemanticUsable = semanticStatus?.state === 'ready' || semanticStatus?.state === 'indexing'

  return (
    <div className="h-full w-full bg-transparent text-gray-900 dark:text-gray-100 overflow-y-auto custom-scrollbar animate-fade-in relative">
      <div className="p-8 max-w-6xl mx-auto">
        <div className="flex justify-between items-end mb-8 border-b border-slate-300 dark:border-slate/10 pb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">AI Search Engines</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Install and manage local AI models for semantic search. Toggle AI mode directly from
              the search bar.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 bg-slate-100/50 dark:bg-slate-800/40 px-4 py-3">
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Semantic Search
              </div>
              <div
                className={`flex items-center justify-end gap-1.5 mt-0.5 text-xs font-medium ${statusTone}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
                {statusLabel}
              </div>
            </div>
            <Switch
              checked={settings?.semantic_search_enabled ?? false}
              disabled={
                isTogglingEnabled ||
                activatingId !== null ||
                downloadingId !== null ||
                (!activeModelInstalled && !(settings?.semantic_search_enabled ?? false))
              }
              onChange={value => void handleSemanticEnabledChange(value)}
            />
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-slate-100/50 dark:bg-slate-800/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Text Clips
            </div>
            <div className="mt-1.5 text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {indexStats?.totalTextClips ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-slate-100/50 dark:bg-slate-800/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Indexed
            </div>
            <div className="mt-1.5 text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {indexStats?.indexedClips ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-slate-100/50 dark:bg-slate-800/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  Pending
                </div>
                <div className="mt-1.5 text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {indexStats?.pendingClips ?? 0}
                </div>
              </div>
              <button
                onClick={() => void handleReindex()}
                disabled={
                  !isSemanticUsable || isReindexing || (indexStats?.pendingClips ?? 0) === 0
                }
                title={
                  !isSemanticUsable
                    ? 'Load a semantic model to index existing clips'
                    : (indexStats?.pendingClips ?? 0) === 0
                      ? 'All clips are indexed'
                      : undefined
                }
                className="mt-0.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isReindexing ? 'Indexing…' : 'Reindex'}
              </button>
            </div>
            {indexProgress && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                  <span>
                    {indexProgress.done} / {indexProgress.total} clips
                  </span>
                  <span>
                    {indexProgress.total > 0
                      ? Math.round((indexProgress.done / indexProgress.total) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="w-full bg-blue-100 dark:bg-blue-900/30 rounded-full h-1 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1 rounded-full transition-all duration-300 ease-out"
                    style={{
                      width:
                        indexProgress.total > 0
                          ? `${Math.round((indexProgress.done / indexProgress.total) * 100)}%`
                          : '0%',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {AVAILABLE_MODELS.map(model => {
            const isConfiguredModel = settings?.semantic_model === model.id
            const isActive =
              isConfiguredModel &&
              (semanticStatus?.state === 'ready' || semanticStatus?.state === 'indexing')
            const isDownloaded = downloadedModels.includes(model.id)
            const isDownloadingThis = downloadingId === model.id
            const isActivatingThis = activatingId === model.id
            const isAnotherDownloadingOrActivating =
              (downloadingId !== null && downloadingId !== model.id) ||
              (activatingId !== null && activatingId !== model.id)
            const isDegraded =
              isConfiguredModel &&
              (semanticStatus?.state === 'error' || semanticStatus?.state === 'missing_model')
            const isLoadingModel = isConfiguredModel && semanticStatus?.state === 'loading'
            const isIndexingModel = isConfiguredModel && semanticStatus?.state === 'indexing'

            let progressPct = 0
            if (isDownloadingThis && downloadProgress && downloadProgress.total > 0) {
              progressPct = Math.min(
                100,
                Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
              )
            }

            const cardRing = (() => {
              if (isActive)
                return 'border-emerald-500 dark:border-emerald-500/50 ring-1 ring-emerald-500/20'
              if (isIndexingModel)
                return 'border-blue-500 dark:border-blue-500/50 ring-1 ring-blue-500/20'
              if (isLoadingModel)
                return 'border-amber-400 dark:border-amber-500/50 ring-1 ring-amber-500/20'
              if (isDegraded) return 'border-red-400 dark:border-red-500/50 ring-1 ring-red-500/20'
              return 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
            })()

            return (
              <div
                key={model.id}
                className={`flex flex-col p-4 rounded-lg border transition-all duration-200 bg-slate-100/50 dark:bg-slate-800/40 shadow-sm ${cardRing}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className="shrink-0 w-12 h-12 flex items-center justify-center rounded-md bg-linear-to-br from-blue-100/60 to-indigo-100/60 dark:from-blue-900/40 dark:to-indigo-900/40 text-blue-600 dark:text-blue-400">
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        />
                      </svg>
                    </div>

                    {/* Header */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                        {model.name}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {model.publisher} <span className="mx-1">•</span> ONNX{' '}
                        <span className="mx-1">•</span> {model.size}
                      </p>
                    </div>
                  </div>

                  {/* Delete Button (only if downloaded and NOT active) */}
                  {isDownloaded &&
                    !isActive &&
                    !isLoadingModel &&
                    !isIndexingModel &&
                    !activatingId && (
                      <button
                        onClick={() => void handleDeleteModel(model.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                        title="Delete Model"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    )}
                </div>

                {/* Description */}
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed flex-1 line-clamp-3">
                  {model.desc}
                </div>

                {/* Status / Actions Trailer */}
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex flex-col gap-2">
                  {isActive ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-sm font-medium border border-emerald-200/80 dark:border-emerald-500/20">
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        {isIndexingModel ? 'Active · Indexing' : 'Active'}
                      </div>
                      {isIndexingModel && semanticStatus?.progress && (
                        <div className="text-[11px] text-blue-500 dark:text-blue-400 text-center tabular-nums">
                          {semanticStatus.progress.done} / {semanticStatus.progress.total} clips
                          indexed
                        </div>
                      )}
                    </div>
                  ) : isLoadingModel ? (
                    <div className="flex items-center justify-center gap-2 w-full py-1.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm font-medium border border-amber-200/70 dark:border-amber-500/20">
                      <svg
                        className="animate-spin h-3.5 w-3.5"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Loading…
                    </div>
                  ) : isDegraded ? (
                    <div className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium border border-red-200/70 dark:border-red-500/20">
                      <svg
                        className="w-3.5 h-3.5 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                        />
                      </svg>
                      <span className="flex-1 min-w-0 truncate">
                        <span className="font-semibold">Error</span>
                        {semanticStatus?.message && (
                          <span className="font-normal opacity-75">
                            {' '}
                            — {semanticStatus.message}
                          </span>
                        )}
                      </span>
                    </div>
                  ) : isDownloadingThis ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                        <span className="flex items-center gap-1.5">
                          <svg
                            className="animate-spin h-3.5 w-3.5"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            ></circle>
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          Downloading...
                        </span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="w-full bg-blue-100 dark:bg-blue-900/30 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      {downloadProgress && (
                        <div className="text-[10px] text-gray-400 text-right mt-0.5">
                          {formatBytes(downloadProgress.downloaded)} /{' '}
                          {formatBytes(downloadProgress.total)}
                        </div>
                      )}
                    </div>
                  ) : isActivatingThis ? (
                    <button
                      disabled
                      className="flex items-center justify-center gap-2 w-full py-1.5 rounded text-sm font-medium transition-colors bg-slate-100/60 dark:bg-slate-700 text-gray-900 dark:text-gray-100 opacity-80 cursor-wait"
                    >
                      <svg
                        className="animate-spin -ml-1 mr-1.5 h-3.5 w-3.5 text-gray-500 dark:text-gray-400"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Activating...
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleSelectExistingModel(model.id)}
                      disabled={isAnotherDownloadingOrActivating}
                      className="flex items-center justify-center gap-2 w-full py-1.5 rounded text-sm font-medium transition-colors bg-slate-100/60 dark:bg-slate-700 text-gray-900 dark:text-gray-100 hover:bg-slate-200/60 dark:hover:bg-slate-600 disabled:opacity-50"
                    >
                      {isDownloaded ? 'Set as Active' : `Download (${model.size})`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
