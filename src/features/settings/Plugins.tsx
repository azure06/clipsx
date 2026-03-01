import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettingsStore } from '../../stores'

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

export const Plugins = () => {
  const { settings, updateSettings } = useSettingsStore()
  const [isReady, setIsReady] = useState(false)
  const [downloadedModels, setDownloadedModels] = useState<string[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<{
    downloaded: number
    total: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void checkStatus()
    void fetchDownloadedModels()

    const unlisten = listen<ProgressPayload>('download-progress', event => {
      if (event.payload.model) {
        setDownloadingId(event.payload.model)
        setDownloadProgress({
          downloaded: event.payload.downloaded,
          total: event.payload.total,
        })
      }
    })

    return () => {
      void unlisten.then(f => f())
    }
  }, [settings?.semantic_model])

  const checkStatus = async () => {
    try {
      const status = await invoke<boolean>('get_semantic_search_status')
      setIsReady(status)
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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 MB'
    const mb = bytes / 1024 / 1024
    return `${mb.toFixed(1)} MB`
  }

  const handleSelectExistingModel = async (modelId: string) => {
    if (settings?.semantic_model === modelId && isReady) return

    try {
      setError(null)

      const isDownloaded = downloadedModels.includes(modelId)

      if (!isDownloaded) {
        setDownloadingId(modelId)
      } else {
        setActivatingId(modelId)
      }

      await invoke('change_semantic_model', { modelName: modelId })
      await updateSettings({ semantic_model: modelId })

      setIsReady(true)
      await fetchDownloadedModels()
    } catch (err) {
      setError(String(err))
      console.error('Failed to swap semantic model:', err)
    } finally {
      setDownloadingId(null)
      setActivatingId(null)
      setDownloadProgress(null)
    }
  }

  const handleDeleteModel = async (modelId: string) => {
    try {
      setError(null)
      await invoke('delete_semantic_model', { modelName: modelId })
      await fetchDownloadedModels()

      // If we just deleted the active model, the backend auto-unloaded it.
      // We should update UI state accordingly.
      if (settings?.semantic_model === modelId) {
        setIsReady(false)
      }
    } catch (err) {
      setError(String(err))
      console.error('Failed to delete semantic model:', err)
    }
  }

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
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {AVAILABLE_MODELS.map(model => {
            const isActive = settings?.semantic_model === model.id && isReady
            const isDownloaded = downloadedModels.includes(model.id)
            const isDownloadingThis = downloadingId === model.id
            const isActivatingThis = activatingId === model.id
            const isAnotherDownloadingOrActivating =
              (downloadingId !== null && downloadingId !== model.id) ||
              (activatingId !== null && activatingId !== model.id)

            let progressPct = 0
            if (isDownloadingThis && downloadProgress && downloadProgress.total > 0) {
              progressPct = Math.min(
                100,
                Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
              )
            }

            return (
              <div
                key={model.id}
                className={`flex flex-col p-4 rounded-lg border transition-all duration-200 bg-slate-100/50 dark:bg-slate-800/40 shadow-sm ${
                  isActive
                    ? 'border-blue-500 dark:border-blue-500/50 ring-1 ring-blue-500/20'
                    : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                }`}
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
                  {isDownloaded && !isActive && !isDownloadingThis && !activatingId && (
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
                <div className="mt-4 pt-3 flex flex-col gap-2">
                  {isActive ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded bg-blue-50/80 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium border border-blue-100/80 dark:border-transparent">
                        <svg
                          className="w-4 h-4"
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
                        Installed & Active
                      </div>
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
