import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../../stores'
import { Switch } from '../../shared/components/ui/Switch'

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

export const Plugins = () => {
  const { settings, updateSettings } = useSettingsStore()
  const [isReady, setIsReady] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Check initial engine status
  useEffect(() => {
    void checkStatus()
  }, [settings?.semantic_model])

  const checkStatus = async () => {
    try {
      const status = await invoke<boolean>('get_semantic_search_status')
      setIsReady(status)
    } catch (err) {
      console.error('Failed to check semantic status:', err)
    }
  }

  const handleSelectExistingModel = async (modelId: string) => {
    if (settings?.semantic_model === modelId) return

    try {
      setDownloadingId(modelId) // Use the spinner to denote loading
      await invoke('change_semantic_model', { modelName: modelId })
      await updateSettings({ semantic_model: modelId })
      setIsReady(true)

      // Auto-enable semantic search if not already enabled when downloading first model
      if (settings && !settings.semantic_search_enabled) {
        handleToggleSemanticSearch(true)
      }
    } catch (err) {
      setError(String(err))
      console.error('Failed to swap semantic model:', err)
    } finally {
      setDownloadingId(null)
    }
  }

  const handleToggleSemanticSearch = (enabled: boolean) => {
    void updateSettings({ semantic_search_enabled: enabled })
  }

  return (
    <div className="h-full w-full bg-transparent text-gray-900 dark:text-gray-100 overflow-y-auto custom-scrollbar animate-fade-in relative">
      <div className="p-8 max-w-6xl mx-auto">
        <div className="flex justify-between items-end mb-8 border-b border-gray-200 dark:border-white/10 pb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">Plugins & Extensions</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enhance your clipboard with advanced, privacy-first local AI engines.
            </p>
          </div>

          {/* Master Switch */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {settings?.semantic_search_enabled ? 'Semantic Search: On' : 'Semantic Search: Off'}
            </span>
            <Switch
              checked={settings?.semantic_search_enabled ?? false}
              onChange={handleToggleSemanticSearch}
              disabled={!isReady}
            />
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
            const isDownloadingThis = downloadingId === model.id
            const isAnotherDownloading = downloadingId !== null && downloadingId !== model.id

            return (
              <div
                key={model.id}
                className={`flex flex-col p-4 rounded-lg border transition-all duration-200 bg-white dark:bg-gray-800/40 shadow-sm ${
                  isActive
                    ? 'border-blue-500 dark:border-blue-500/50 ring-1 ring-blue-500/20'
                    : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Extension Icon / Logo */}
                  <div className="shrink-0 w-12 h-12 flex items-center justify-center rounded-md bg-linear-to-br from-blue-100 to-indigo-100 dark:from-blue-900/40 dark:to-indigo-900/40 text-blue-600 dark:text-blue-400">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                      />
                    </svg>
                  </div>

                  {/* Extension Header */}
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

                {/* Extension Description */}
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed flex-1 line-clamp-3">
                  {model.desc}
                </div>

                {/* Action Buttons Footer */}
                <div className="mt-4 pt-3 flex items-center gap-2">
                  {isActive ? (
                    <div className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium border border-blue-100 dark:border-transparent">
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
                  ) : (
                    <button
                      onClick={() => void handleSelectExistingModel(model.id)}
                      disabled={isDownloadingThis || isAnotherDownloading}
                      className={`flex items-center justify-center gap-2 w-full py-1.5 rounded text-sm font-medium transition-colors ${
                        isDownloadingThis
                          ? 'bg-blue-600 text-white cursor-wait opacity-80'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600'
                      } disabled:opacity-50`}
                    >
                      {isDownloadingThis ? (
                        <>
                          <svg
                            className="animate-spin -ml-1 mr-1.5 h-3.5 w-3.5 text-white"
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
                          Installing...
                        </>
                      ) : (
                        'Install Model'
                      )}
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
