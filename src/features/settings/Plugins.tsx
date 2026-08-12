import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { TextEmbeddingStatus } from '../../shared/types/v2'
import { Button } from '../../shared/components/ui/Button'
import { Switch } from '../../shared/components/ui/Switch'
import {
  Box,
  CheckCircle2,
  Code2,
  Database,
  Download,
  FolderOpen,
  Plug,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react'

type CoreUtility = { id: string; kind: string; label: string; version: string }
type Extension = {
  packageId: string
  version: string
  enabled: boolean
  status: 'ready' | 'quarantined' | 'incompatible'
  displayName: string
  description: string
  source: 'registry' | 'developer'
}
type RegistryPackage = {
  packageId: string
  version: string
  displayName: string
  description: string
  contributions: string[]
}
type RegistryIndex = { schemaVersion: number; packages: RegistryPackage[] }

export const Plugins = () => {
  const [utilities, setUtilities] = useState<CoreUtility[]>([])
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [provider, setProvider] = useState<TextEmbeddingStatus | null>(null)
  const [registry, setRegistry] = useState<RegistryPackage[]>([])
  const [devMode, setDevMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [core, installed, status, available, isDev] = await Promise.all([
        invoke<CoreUtility[]>('list_core_utilities'),
        invoke<Extension[]>('list_extensions'),
        invoke<TextEmbeddingStatus>('get_text_embedding_status'),
        invoke<RegistryIndex>('get_extension_registry').catch(() => ({
          schemaVersion: 1,
          packages: [],
        })),
        invoke<boolean>('get_extension_developer_mode').catch(() => false),
      ])
      setUtilities(core)
      setExtensions(installed)
      setProvider(status)
      setRegistry(available.packages)
      setDevMode(isDev)
    } catch (value) {
      setError(String(value))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const u1 = listen('extension-catalog-updated', () => void load())
    const u2 = listen('extension-runtime-state-updated', () => void load())
    return () => {
      void u1.then(f => f())
      void u2.then(f => f())
    }
  }, [load])

  const handleDevModeToggle = async (enabled: boolean) => {
    try {
      await invoke('set_extension_developer_mode', { enabled })
      setDevMode(enabled)
    } catch (value) {
      setError(String(value))
    }
  }

  const handleInstallLocal = async () => {
    const path = await open({
      title: 'Select WASM Package',
      filters: [{ name: 'WASM Package', extensions: ['wasm'] }],
      multiple: false,
    })
    if (!path || typeof path !== 'string') return
    setInstalling(true)
    setError(null)
    try {
      await invoke('install_local_extension', { path })
    } catch (value) {
      setError(String(value))
    } finally {
      setInstalling(false)
    }
  }

  const setExtension = async (extension: Extension, enabled: boolean) => {
    setBusyId(extension.packageId)
    try {
      await invoke('set_extension_enabled', { packageId: extension.packageId, enabled })
    } catch (value) {
      setError(String(value))
    } finally {
      setBusyId(null)
    }
  }

  const extensionAction = async (
    packageId: string,
    command: string,
    args: Record<string, unknown> = {}
  ) => {
    setBusyId(packageId)
    setError(null)
    try {
      await invoke(command, { packageId, ...args })
    } catch (value) {
      setError(String(value))
    } finally {
      setBusyId(null)
    }
  }

  const groups = ['Detector', 'Renderer', 'Transformer']
  const availableInRegistry = registry.filter(
    item => !extensions.some(ext => ext.packageId === item.packageId)
  )

  return (
    <div className="relative h-full w-full overflow-y-auto bg-transparent text-gray-900 dark:text-gray-100 custom-scrollbar animate-fade-in">
      <div className="space-y-6 px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold">Extensions</h1>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Core contributions and WASM sandbox extensions.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            isLoading={busy}
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        {/* Developer mode */}
        <section className="rounded-xl border border-slate-200/70 bg-slate-100/30 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-amber-500" />
              <div>
                <div className="text-sm font-semibold">Developer mode</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  Install local .wasm packages without registry verification.
                </div>
              </div>
            </div>
            <Switch checked={devMode} onChange={handleDevModeToggle} size="sm" />
          </div>
          {devMode && (
            <div className="mt-3 border-t border-slate-200/60 pt-3 dark:border-white/10">
              <Button
                variant="outline"
                size="sm"
                isLoading={installing}
                leftIcon={<FolderOpen className="h-3.5 w-3.5" />}
                onClick={handleInstallLocal}
              >
                Install local package…
              </Button>
            </div>
          )}
        </section>

        {/* Semantic search status */}
        <section className="rounded-xl border border-slate-200/70 bg-slate-100/30 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold">Semantic search</h2>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {provider?.enabled
              ? `Ollama active · ${provider.indexedClips.toLocaleString()} indexed · ${provider.pendingJobs} pending`
              : 'Disabled — configure in the Intelligence page.'}
          </p>
          {provider?.diagnostic && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {provider.diagnostic}
            </p>
          )}
        </section>

        {/* Core utilities */}
        {groups.map(group => {
          const items = utilities.filter(item => item.kind === group)
          if (items.length === 0) return null
          return (
            <section key={group}>
              <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                Core {group}s
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map(item => (
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
          )
        })}

        {/* Installed extensions */}
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
                  className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-slate-100/20 px-3 py-2.5 dark:border-white/10 dark:bg-white/5"
                  key={extension.packageId}
                >
                  <Plug className="h-4 w-4 shrink-0 text-violet-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{extension.displayName}</span>
                      {extension.source === 'developer' && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          local
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {extension.version} · {extension.status}
                      {extension.description ? ` · ${extension.description}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {extension.status === 'quarantined' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === extension.packageId}
                        leftIcon={<RotateCcw className="h-3.5 w-3.5 text-amber-500" />}
                        onClick={() =>
                          void extensionAction(extension.packageId, 'recover_extension')
                        }
                      />
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        busyId === extension.packageId ||
                        (extension.status !== 'ready' && extension.status !== 'quarantined')
                      }
                      onClick={() => void setExtension(extension, !extension.enabled)}
                    >
                      {extension.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === extension.packageId}
                      leftIcon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
                      onClick={() =>
                        void extensionAction(extension.packageId, 'uninstall_extension')
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Registry (available to install) */}
        {availableInRegistry.length > 0 && (
          <section>
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Reviewed registry
            </h2>
            <div className="space-y-2">
              {availableInRegistry.map(item => (
                <div
                  className="flex items-center justify-between rounded-lg border border-slate-200/70 px-3 py-2 dark:border-white/10"
                  key={`${item.packageId}-${item.version}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{item.displayName}</div>
                    <div className="truncate text-[10px] text-gray-500">
                      {item.description || item.contributions.join(', ')}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === item.packageId}
                    leftIcon={<Download className="h-3.5 w-3.5 text-blue-500" />}
                    onClick={() =>
                      void extensionAction(item.packageId, 'install_registry_extension', {
                        version: item.version,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <Box className="h-3 w-3" />
          Core utilities are installed application code; extensions run in the WASM sandbox.
        </div>
      </div>
    </div>
  )
}
