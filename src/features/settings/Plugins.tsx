import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { TextEmbeddingStatus } from '../../shared/types/v2'
import { Button } from '../../shared/components/ui/Button'
import { Switch } from '../../shared/components/ui/Switch'
import { ShortcutRecorder } from './Settings'
import {
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  Download,
  Eye,
  FolderOpen,
  Plug,
  RefreshCw,
  RotateCcw,
  Scan,
  Shuffle,
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
  httpOrigins: string[]
  credentialLabels: string[]
  unavailableContributions: string[]
  checksum: string | null
  externalNavigationOrigins: string[]
  providers: string[]
  settings: Array<{
    id: string
    label: string
    kind: 'boolean' | 'string' | 'number'
    default: unknown
  }>
}
type CredentialStatus = { id: string; label: string; configured: boolean }
type RegistryPackage = {
  packageId: string
  version: string
  displayName: string
  description: string
  contributions: string[]
  apiVersion: string
  sha256: string
  httpOrigins: string[]
  externalNavigationOrigins: string[]
  credentialLabels: string[]
  providers: string[]
}
type RegistryIndex = { schemaVersion: number; packages: RegistryPackage[] }
type ExtensionAction = {
  id: string
  packageId: string
  label: string
  shortcut: string | null
  available: boolean
  unavailableReason: string | null
  execution: 'local' | 'capability_backed'
}

const KIND_META: Record<string, { icon: React.ReactNode; color: string; description: string }> = {
  Detector: {
    icon: <Scan className="h-4 w-4" />,
    color: 'text-blue-500',
    description: 'Analyse clipboard content and tag it — URL, email, color, secret…',
  },
  Renderer: {
    icon: <Eye className="h-4 w-4" />,
    color: 'text-violet-500',
    description: 'Control how tagged content is displayed in the preview panel.',
  },
  Transformer: {
    icon: <Shuffle className="h-4 w-4" />,
    color: 'text-emerald-500',
    description: 'Convert content between formats — JSON↔CSV, Base64, curl→fetch…',
  },
}

const compareSemver = (left: string, right: string) => {
  const parse = (value: string) => {
    const [core = '', prerelease = ''] = value.split('-', 2)
    return { numbers: core.split('.').map(part => Number(part)), prerelease }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease)
}

const CollapsibleSection = ({
  title,
  children,
  defaultOpen = true,
}: {
  title: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button
        className="mb-2 flex w-full items-center gap-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && children}
    </section>
  )
}

const ExtensionConfiguration = ({ extension }: { extension: Extension }) => {
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [credentials, setCredentials] = useState<CredentialStatus[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    void Promise.all([
      invoke<Record<string, unknown>>('get_extension_package_settings', {
        packageId: extension.packageId,
      }),
      invoke<CredentialStatus[]>('get_extension_credential_status', {
        packageId: extension.packageId,
      }),
    ]).then(([values, status]) => {
      setSettings(values)
      setCredentials(status)
    })
  }, [extension.packageId])

  if (extension.settings.length === 0 && credentials.length === 0) return null
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200/70 pt-2 dark:border-white/10">
      {extension.settings.map(setting => {
        const value = settings[setting.id] ?? setting.default
        const inputValue =
          typeof value === 'string' || typeof value === 'number' ? String(value) : ''
        return (
          <label className="flex items-center justify-between gap-3 text-xs" key={setting.id}>
            <span>{setting.label}</span>
            {setting.kind === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={event => {
                  const next = event.target.checked
                  setSettings(current => ({ ...current, [setting.id]: next }))
                  void invoke('set_extension_package_setting', {
                    packageId: extension.packageId,
                    settingId: setting.id,
                    value: next,
                  })
                }}
              />
            ) : (
              <input
                className="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-900"
                type={setting.kind === 'number' ? 'number' : 'text'}
                value={inputValue}
                onChange={event => {
                  const next =
                    setting.kind === 'number' ? Number(event.target.value) : event.target.value
                  if (setting.kind === 'number' && !Number.isFinite(next)) return
                  setSettings(current => ({ ...current, [setting.id]: next }))
                  void invoke('set_extension_package_setting', {
                    packageId: extension.packageId,
                    settingId: setting.id,
                    value: next,
                  })
                }}
              />
            )}
          </label>
        )
      })}
      {credentials.map(credential => (
        <label className="flex items-center justify-between gap-3 text-xs" key={credential.id}>
          <span>
            {credential.label}
            {credential.configured ? ' (configured)' : ''}
          </span>
          <input
            className="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-900"
            type="password"
            autoComplete="off"
            placeholder={credential.configured ? 'Replace secret' : 'Enter secret'}
            value={drafts[credential.id] ?? ''}
            onChange={event =>
              setDrafts(current => ({ ...current, [credential.id]: event.target.value }))
            }
            onBlur={event => {
              const value = event.target.value
              if (!value) return
              void invoke('set_extension_credential', {
                packageId: extension.packageId,
                credentialId: credential.id,
                value,
              }).then(() => {
                setCredentials(current =>
                  current.map(item =>
                    item.id === credential.id ? { ...item, configured: true } : item
                  )
                )
                setDrafts(current => ({ ...current, [credential.id]: '' }))
              })
            }}
          />
        </label>
      ))}
    </div>
  )
}

export const Plugins = () => {
  const [utilities, setUtilities] = useState<CoreUtility[]>([])
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [extensionActions, setExtensionActions] = useState<ExtensionAction[]>([])
  const [provider, setProvider] = useState<TextEmbeddingStatus | null>(null)
  const [registry, setRegistry] = useState<RegistryPackage[]>([])
  const [devMode, setDevMode] = useState(false)
  const [activeKind, setActiveKind] = useState<string>('Detector')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [core, installed, actions, status, available, isDev] = await Promise.all([
        invoke<CoreUtility[]>('list_core_utilities'),
        invoke<Extension[]>('list_extensions'),
        invoke<ExtensionAction[]>('list_extension_actions'),
        invoke<TextEmbeddingStatus>('get_text_embedding_status'),
        invoke<RegistryIndex>('get_extension_registry').catch(() => ({
          schemaVersion: 1,
          packages: [],
        })),
        invoke<boolean>('get_extension_developer_mode').catch(() => false),
      ])
      setUtilities(core)
      setExtensions(installed)
      setExtensionActions(actions)
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
      title: 'Select ClipsX Extension Package',
      filters: [{ name: 'ClipsX Extension', extensions: ['clipsx'] }],
      multiple: false,
    })
    if (!path || typeof path !== 'string') return
    setInstalling(true)
    setError(null)
    try {
      const preview = await invoke<Extension>('inspect_local_extension', { path })
      const disclosures = [
        `${preview.displayName} v${preview.version}`,
        preview.httpOrigins.length > 0
          ? `Future HTTP origins: ${preview.httpOrigins.join(', ')}`
          : 'No network origins declared.',
        preview.credentialLabels.length > 0
          ? `Credential slots: ${preview.credentialLabels.join(', ')}`
          : 'No credential slots declared.',
        preview.unavailableContributions.length > 0
          ? `Unavailable until the capability broker ships: ${preview.unavailableContributions.join(', ')}`
          : '',
        '',
        'Install this extension?',
      ].filter(Boolean)
      if (!window.confirm(disclosures.join('\n'))) return
      await invoke('install_local_extension', { path })
    } catch (value) {
      setError(String(value))
    } finally {
      setInstalling(false)
    }
  }

  const setActionShortcut = async (actionId: string, accelerator: string | null) => {
    setBusyId(actionId)
    setError(null)
    try {
      await invoke('set_extension_action_shortcut', { actionId, accelerator })
      await load()
    } catch (value) {
      setError(String(value))
    } finally {
      setBusyId(null)
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

  const installUpdate = async (installed: Extension, update: RegistryPackage) => {
    const oldPermissions = [
      ...installed.httpOrigins.map(value => `HTTPS ${value}`),
      ...installed.externalNavigationOrigins.map(value => `Navigate ${value}`),
      ...installed.credentialLabels.map(value => `Credential ${value}`),
      ...installed.providers.map(value => `Provider ${value}`),
    ]
    const newPermissions = [
      ...update.httpOrigins.map(value => `HTTPS ${value}`),
      ...update.externalNavigationOrigins.map(value => `Navigate ${value}`),
      ...update.credentialLabels.map(value => `Credential ${value}`),
      ...update.providers.map(value => `Provider ${value}`),
    ]
    const permissionChanged =
      JSON.stringify(oldPermissions.sort()) !== JSON.stringify(newPermissions.sort())
    const approved = window.confirm(
      [
        `Update ${installed.displayName} from v${installed.version} to v${update.version}?`,
        `Release checksum: ${update.sha256}`,
        permissionChanged ? 'Declared permissions changed.' : 'Declared permissions are unchanged.',
        'All remembered external-data grants will be revoked and require fresh consent.',
      ].join('\n\n')
    )
    if (!approved) return
    await extensionAction(update.packageId, 'install_registry_extension', {
      version: update.version,
    })
    await load()
  }

  const groups = ['Detector', 'Renderer', 'Transformer']
  const activeItems = utilities.filter(item => item.kind === activeKind)
  const availableInRegistry = registry.filter(
    item => !extensions.some(ext => ext.packageId === item.packageId)
  )
  const registryUpdates = extensions.flatMap(installed => {
    const update = registry
      .filter(item => item.packageId === installed.packageId)
      .filter(item => compareSemver(item.version, installed.version) > 0)
      .sort((left, right) => compareSemver(right.version, left.version))[0]
    return update ? [{ installed, update }] : []
  })

  return (
    <div className="relative h-full w-full overflow-y-auto bg-transparent text-gray-900 dark:text-gray-100 custom-scrollbar animate-fade-in">
      <div className="space-y-6 px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold">Extensions</h1>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Extend ClipsX with new detectors, renderers, and transformers.
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

        {/* How it works */}
        <div className="rounded-xl border border-slate-200/60 bg-slate-50/40 px-4 py-3 dark:border-white/10 dark:bg-slate-100/5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            How the pipeline works
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] dark:bg-slate-800">
              clipboard
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-gray-300" />
            <span className="flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
              <Scan className="h-3 w-3" /> Detector
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-gray-300" />
            <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] dark:bg-slate-800">
              facets
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-gray-300" />
            <span className="flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
              <Eye className="h-3 w-3" /> Renderer
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-gray-300" />
            <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] dark:bg-slate-800">
              preview
            </span>
          </div>
          <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
            Each time you copy something,{' '}
            <strong className="text-gray-700 dark:text-gray-300">Detectors</strong> scan it and
            attach typed tags called <em>facets</em> (URL, email, color, secret…).{' '}
            <strong className="text-gray-700 dark:text-gray-300">Renderers</strong> turn those
            facets into rich previews.{' '}
            <strong className="text-gray-700 dark:text-gray-300">Transformers</strong> let you
            convert content on-demand — JSON↔CSV, Base64, curl→fetch, and more. Extensions can add
            new contributions of any type.
          </p>
        </div>

        {/* Developer mode */}
        <section className="rounded-xl border border-slate-200/70 bg-slate-100/30 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-amber-500" />
              <div>
                <div className="text-sm font-semibold">Developer mode</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  Install local .clipsx packages without registry verification.
                </div>
              </div>
            </div>
            <Switch
              checked={devMode}
              onChange={enabled => void handleDevModeToggle(enabled)}
              size="sm"
            />
          </div>
          {devMode && (
            <div className="mt-3 border-t border-slate-200/60 pt-3 dark:border-white/10">
              <Button
                variant="outline"
                size="sm"
                isLoading={installing}
                leftIcon={<FolderOpen className="h-3.5 w-3.5" />}
                onClick={() => void handleInstallLocal()}
              >
                Install local package…
              </Button>
            </div>
          )}
        </section>

        {/* Core contributions — tabbed */}
        <section>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Core contributions
          </div>
          {/* Kind tabs */}
          <div className="mb-3 flex gap-1 rounded-lg border border-slate-200/60 bg-slate-100/30 p-1 dark:border-white/10 dark:bg-white/5">
            {groups.map(group => {
              const meta = KIND_META[group]
              const isActive = activeKind === group
              return (
                <button
                  key={group}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-white shadow-sm dark:bg-slate-700'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                  onClick={() => setActiveKind(group)}
                >
                  <span className={isActive ? meta?.color : ''}>{meta?.icon}</span>
                  {group}s
                </button>
              )
            })}
          </div>
          {/* Kind description */}
          {KIND_META[activeKind] && (
            <p className="mb-2 text-[10px] text-gray-500 dark:text-gray-400">
              {KIND_META[activeKind].description}
            </p>
          )}
          {/* Items grid */}
          <div className="grid gap-2 sm:grid-cols-2">
            {activeItems.map(item => (
              <div
                className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-slate-100/20 px-3 py-2 dark:border-white/10 dark:bg-white/5"
                key={item.id}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.label}</div>
                  <div className="truncate text-[10px] text-gray-500">
                    {item.id} · v{item.version}
                  </div>
                </div>
              </div>
            ))}
            {activeItems.length === 0 && (
              <p className="col-span-2 text-xs text-gray-400">No core {activeKind}s.</p>
            )}
          </div>
        </section>

        {/* Installed extensions */}
        <CollapsibleSection title="Installed extensions">
          {extensions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-gray-500 dark:border-white/10">
              No extensions installed.{' '}
              {devMode
                ? 'Use "Install local package…" above to load a .clipsx package.'
                : 'Browse the reviewed registry below, or enable Developer mode to install local packages.'}
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
                      {extension.status === 'quarantined' && (
                        <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                          quarantined
                        </span>
                      )}
                      {extension.status === 'incompatible' && (
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-white/10">
                          incompatible
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      v{extension.version}
                      {extension.description ? ` · ${extension.description}` : ''}
                    </div>
                    {(extension.httpOrigins ?? []).length > 0 && (
                      <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                        Declares future HTTP access: {extension.httpOrigins.join(', ')}
                      </div>
                    )}
                    {(extension.credentialLabels ?? []).length > 0 && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400">
                        Credential slots: {extension.credentialLabels.join(', ')}
                      </div>
                    )}
                    {(extension.unavailableContributions ?? []).length > 0 && (
                      <div className="text-[10px] text-gray-400">
                        Unavailable until the capability broker ships:{' '}
                        {extension.unavailableContributions.join(', ')}
                      </div>
                    )}
                    <ExtensionConfiguration extension={extension} />
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
        </CollapsibleSection>

        {extensionActions.length > 0 && (
          <CollapsibleSection title="Extension action shortcuts">
            <div className="space-y-2">
              {extensionActions.map(action => (
                <div
                  key={action.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200/70 px-3 py-2 dark:border-white/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{action.label}</div>
                    <div className="truncate text-[10px] text-gray-500">
                      {action.packageId}
                      {action.unavailableReason ? ` · ${action.unavailableReason}` : ''}
                    </div>
                  </div>
                  {action.available && (
                    <>
                      <ShortcutRecorder
                        value={action.shortcut ?? ''}
                        onChange={shortcut => void setActionShortcut(action.id, shortcut)}
                      />
                      {action.shortcut && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === action.id}
                          onClick={() => void setActionShortcut(action.id, null)}
                        >
                          Clear
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {registryUpdates.length > 0 && (
          <CollapsibleSection title="Extension updates">
            <div className="space-y-2">
              {registryUpdates.map(({ installed, update }) => (
                <div
                  className="flex items-center justify-between rounded-lg border border-blue-200/70 px-3 py-2 dark:border-blue-400/20"
                  key={`${update.packageId}-${update.version}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{installed.displayName}</div>
                    <div className="text-[10px] text-gray-500">
                      v{installed.version} → v{update.version} · manual update
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === update.packageId}
                    leftIcon={<Download className="h-3.5 w-3.5 text-blue-500" />}
                    onClick={() => void installUpdate(installed, update)}
                  >
                    Review update
                  </Button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Registry */}
        {availableInRegistry.length > 0 && (
          <CollapsibleSection title="Available from registry">
            <div className="space-y-2">
              {availableInRegistry.map(item => (
                <div
                  className="flex items-center justify-between rounded-lg border border-slate-200/70 px-3 py-2 dark:border-white/10"
                  key={`${item.packageId}-${item.version}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{item.displayName}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      {item.contributions.map(c => (
                        <span
                          key={c}
                          className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800"
                        >
                          {c}
                        </span>
                      ))}
                      {item.description && <span className="truncate">{item.description}</span>}
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
          </CollapsibleSection>
        )}

        {/* Semantic search — compact status */}
        <section className="rounded-xl border border-slate-200/70 bg-slate-100/30 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold">Semantic search</h2>
            {provider?.enabled && (
              <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400">
                {provider.indexedClips.toLocaleString()} clips indexed
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
            {provider?.enabled
              ? `Ollama active · ${provider.pendingJobs} pending`
              : 'Disabled — configure in the Intelligence page.'}
          </p>
        </section>

        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <Box className="h-3 w-3 shrink-0" />
          Core contributions are built-in app code. Extensions run isolated in a WASM sandbox with
          no filesystem or network access.
        </div>
      </div>
    </div>
  )
}
