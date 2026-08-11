import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { Box, CheckCircle2, Database, Plug, RefreshCw } from 'lucide-react'

type CoreUtility = { id: string; kind: string; label: string; version: string }
type Extension = {
  packageId: string
  version: string
  enabled: boolean
  status: string
  displayName: string
}
type ProviderStatus = {
  enabled: boolean
  activeSpaceId: string | null
  pendingSpaceId: string | null
  indexedClips: number
  pendingJobs: number
  diagnostic: string | null
}

// Reuses the archived Plugins surface, but its data is now the v2 contribution/provider catalog.
export const Plugins = () => {
  const [utilities, setUtilities] = useState<CoreUtility[]>([])
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    setError(null)
    try {
      const [core, installed, status] = await Promise.all([
        invoke<CoreUtility[]>('list_core_utilities'),
        invoke<Extension[]>('list_extensions'),
        invoke<ProviderStatus>('get_text_embedding_status'),
      ])
      setUtilities(core)
      setExtensions(installed)
      setProvider(status)
    } catch (value) {
      setError(String(value))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  const setExtension = async (extension: Extension, enabled: boolean) => {
    await invoke('set_extension_enabled', { packageId: extension.packageId, enabled })
    await load()
  }
  const groups = ['Detector', 'Renderer', 'Transformer']
  return (
    <div className="relative h-full w-full overflow-y-auto bg-transparent text-gray-900 dark:text-gray-100 custom-scrollbar animate-fade-in">
      <div className="space-y-6 px-6 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold">Utilities</h1>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Installed core contributions and reviewed extensions.
            </p>
          </div>
          <button
            aria-label="Refresh utilities"
            className="rounded-md p-2 text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
        <section className="rounded-xl border border-slate-200/70 bg-slate-100/30 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold">Text semantic search</h2>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {provider?.enabled
              ? `Ollama enabled · ${provider.indexedClips} indexed · ${provider.pendingJobs} pending`
              : 'Disabled. Keyword search remains available.'}
          </p>
          {provider?.diagnostic && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{provider.diagnostic}</p>
          )}
        </section>
        {groups.map(group => (
          <section key={group}>
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Core {group}s
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {utilities
                .filter(item => item.kind === group)
                .map(item => (
                  <div
                    className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-slate-100/20 px-3 py-2 dark:border-white/10 dark:bg-white/5"
                    key={item.id}
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.label}</div>
                      <div className="truncate text-[10px] text-gray-500">
                        {item.id} · {item.version}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))}
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Extensions
          </h2>
          {extensions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-gray-500 dark:border-white/10">
              No extensions installed.
            </p>
          ) : (
            <div className="space-y-2">
              {extensions.map(extension => (
                <div
                  className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-slate-100/20 px-3 py-2 dark:border-white/10 dark:bg-white/5"
                  key={extension.packageId}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Plug className="h-4 w-4 text-violet-500" />
                    <div>
                      <div className="text-sm font-medium">{extension.displayName}</div>
                      <div className="text-[10px] text-gray-500">
                        {extension.version} · {extension.status}
                      </div>
                    </div>
                  </div>
                  <button
                    className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                    onClick={() => void setExtension(extension, !extension.enabled)}
                  >
                    {extension.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <Box className="h-3 w-3" />
          Core utilities are installed application code; extensions run in the WASM sandbox.
        </div>
      </div>
    </div>
  )
}
