import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import {
  CheckCircle2,
  Code2,
  Download,
  Filter,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../../shared/components/ui/Button'
import { Switch } from '../../shared/components/ui/Switch'
import { ExtensionsNavigation, type ExtensionsDestination } from './extensions/ExtensionsNavigation'
import { ExtensionsHelpDialog } from './extensions/ExtensionsHelpDialog'
import { PackageDetailView } from './extensions/PackageDetail'
import type { CatalogEntry, CoreUtility, ExtensionCatalog, PackageDetail } from './extensions/types'

type InstalledFilter = 'all' | 'enabled' | 'disabled' | 'updates' | 'attention'
const timeLabel = (value: number | null) =>
  value ? new Date(value).toLocaleString() : 'Not checked yet'

export const Plugins = () => {
  const [destination, setDestination] = useState<ExtensionsDestination>('installed')
  const [catalog, setCatalog] = useState<ExtensionCatalog | null>(null)
  const [utilities, setUtilities] = useState<CoreUtility[]>([])
  const [developerMode, setDeveloperMode] = useState(false)
  const [autoUpdates, setAutoUpdates] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All categories')
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>('all')
  const [sort, setSort] = useState<'updated' | 'name'>('updated')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PackageDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [nextCatalog, core, devMode, globalAutoUpdates] = await Promise.all([
        invoke<ExtensionCatalog>('get_extension_catalog'),
        invoke<CoreUtility[]>('list_core_utilities'),
        invoke<boolean>('get_extension_developer_mode'),
        invoke<boolean>('get_extension_auto_updates_enabled'),
      ])
      setCatalog(nextCatalog)
      setUtilities(core)
      setDeveloperMode(devMode)
      setAutoUpdates(globalAutoUpdates)
    } catch (value) {
      setError(String(value))
    }
  }, [])
  const loadPackageDetail = useCallback(async (packageId: string) => {
    try {
      setDetail(await invoke<PackageDetail>('get_extension_package_detail', { packageId }))
    } catch (value) {
      setError(String(value))
    }
  }, [])
  const selectPackage = useCallback(
    async (packageId: string) => {
      setSelectedId(packageId)
      setDetail(null)
      await loadPackageDetail(packageId)
    },
    [loadPackageDetail]
  )
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    const catalogListener = listen('extension-catalog-updated', () => void load())
    const stateListener = listen('extension-runtime-state-updated', () => void load())
    return () => {
      void catalogListener.then(unlisten => unlisten())
      void stateListener.then(unlisten => unlisten())
    }
  }, [load])
  useEffect(() => {
    void invoke('check_extension_updates', { force: false })
      .then(load)
      .catch(() => undefined)
  }, [load])
  const refresh = async () => {
    setBusy(true)
    try {
      setCatalog(await invoke<ExtensionCatalog>('check_extension_updates', { force: true }))
      await load()
    } catch (value) {
      setError(String(value))
    } finally {
      setBusy(false)
    }
  }
  const categories = useMemo(
    () => [
      'All categories',
      ...Array.from(
        new Set(catalog?.packages.flatMap(item => item.package.categories) ?? [])
      ).sort(),
    ],
    [catalog]
  )
  const visible = useMemo(
    () =>
      (catalog?.packages ?? [])
        .filter(item => {
          const haystack = [
            item.package.displayName,
            item.package.packageId,
            item.package.description,
            item.package.publisher?.displayName,
            ...item.package.tags,
          ]
            .join(' ')
            .toLowerCase()
          return (
            (!query.trim() || haystack.includes(query.trim().toLowerCase())) &&
            (category === 'All categories' || item.package.categories.includes(category))
          )
        })
        .sort((left, right) =>
          sort === 'name'
            ? left.package.displayName.localeCompare(right.package.displayName)
            : String(right.package.updatedAt ?? '').localeCompare(
                String(left.package.updatedAt ?? '')
              )
        ),
    [catalog, category, query, sort]
  )
  const installed = visible
    .filter(item => item.installed)
    .filter(
      item =>
        installedFilter === 'all' ||
        (installedFilter === 'enabled' && item.installed?.enabled) ||
        (installedFilter === 'disabled' && !item.installed?.enabled) ||
        (installedFilter === 'updates' && item.update) ||
        (installedFilter === 'attention' && item.installed?.status !== 'ready')
    )
  const installLocal = async () => {
    const path = await open({
      title: 'Select ClipsX Extension Package',
      filters: [{ name: 'ClipsX Extension', extensions: ['clipsx'] }],
      multiple: false,
    })
    if (!path || typeof path !== 'string') return
    setBusy(true)
    try {
      const preview = await invoke<{ displayName: string; version: string }>(
        'inspect_local_extension',
        { path }
      )
      if (
        !window.confirm(
          `Install local package ${preview.displayName} v${preview.version}?\n\nLocal packages are not reviewed by the official registry.`
        )
      )
        return
      await invoke('install_local_extension', { path })
      await load()
    } catch (value) {
      setError(String(value))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="h-full overflow-y-auto bg-transparent text-slate-900 dark:text-slate-100 custom-scrollbar animate-fade-in">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-5 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-violet-600 dark:text-violet-300">
              <Sparkles className="h-3 w-3" />
              ClipsX package registry
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Extensions</h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Install and manage isolated packages without widening ClipsX’s trust boundary.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Info className="h-3.5 w-3.5" />}
              onClick={() => setHelpOpen(true)}
            >
              How it works
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isLoading={busy}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void refresh()}
            >
              Check for updates
            </Button>
          </div>
        </header>
        <ExtensionsNavigation
          value={destination}
          onChange={next => {
            setDestination(next)
            setSelectedId(null)
            setDetail(null)
          }}
        />
        <ExtensionsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[.07] px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {detail && selectedId ? (
          <PackageDetailView
            packageId={selectedId}
            detail={detail}
            busy={busy}
            onClose={() => {
              setSelectedId(null)
              setDetail(null)
            }}
            onChanged={() => {
              void load()
              void loadPackageDetail(selectedId)
            }}
          />
        ) : (
          <main className="min-h-0 flex-1">
            {destination === 'installed' && (
              <InstalledView
                packages={installed}
                filter={installedFilter}
                onFilter={setInstalledFilter}
                onSelect={id => void selectPackage(id)}
                onDiscover={() => setDestination('discover')}
              />
            )}
            {destination === 'discover' && (
              <DiscoverView
                packages={visible}
                categories={categories}
                category={category}
                query={query}
                sort={sort}
                onCategory={setCategory}
                onQuery={setQuery}
                onSort={setSort}
                onSelect={id => void selectPackage(id)}
              />
            )}
            {destination === 'builtins' && <BuiltInsView utilities={utilities} />}
            {destination === 'developer' && (
              <DeveloperView
                enabled={developerMode}
                busy={busy}
                onToggle={async enabled => {
                  await invoke('set_extension_developer_mode', { enabled })
                  setDeveloperMode(enabled)
                }}
                onInstall={() => void installLocal()}
              />
            )}
          </main>
        )}
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200/70 pt-3 text-[10px] text-slate-500 dark:border-white/[.08]">
          <span>
            Registry: {catalog?.registry.cached ? 'cached catalog' : 'waiting for first check'}
          </span>
          <span>
            Last successful check: {timeLabel(catalog?.registry.lastSuccessfulCheckAt ?? null)}
          </span>
          <label className="ml-auto flex items-center gap-2 font-medium text-slate-600 dark:text-slate-300">
            Safe automatic updates
            <Switch
              checked={autoUpdates}
              onChange={enabled => {
                void invoke('set_extension_auto_updates_enabled', { enabled }).then(() =>
                  setAutoUpdates(enabled)
                )
              }}
              size="sm"
            />
          </label>
        </footer>
      </div>
    </div>
  )
}

const InstalledView = ({
  packages,
  filter,
  onFilter,
  onSelect,
  onDiscover,
}: {
  packages: CatalogEntry[]
  filter: InstalledFilter
  onFilter: (value: InstalledFilter) => void
  onSelect: (value: string) => void
  onDiscover: () => void
}) => (
  <section>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">Installed packages</h2>
        <p className="mt-1 text-xs text-slate-500">
          Identity, status, and the next action stay here. Package configuration lives in its detail
          page.
        </p>
      </div>
      <div className="flex rounded-lg border border-slate-200/70 bg-white/45 p-1 dark:border-white/10 dark:bg-slate-950/20">
        {(['all', 'enabled', 'disabled', 'updates', 'attention'] as InstalledFilter[]).map(item => (
          <button
            key={item}
            onClick={() => onFilter(item)}
            className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold capitalize ${filter === item ? 'bg-violet-500/12 text-violet-700 dark:text-violet-300' : 'text-slate-500'}`}
          >
            {item === 'attention' ? 'Needs attention' : item}
          </button>
        ))}
      </div>
    </div>
    {packages.length ? (
      <div className="grid gap-2">
        {packages.map(item => (
          <PackageRow key={item.package.packageId} item={item} onSelect={onSelect} />
        ))}
      </div>
    ) : (
      <EmptyState
        title="No packages here"
        text="Discover reviewed packages, or install a local package from Developer Mode."
        action="Browse Discover"
        onAction={onDiscover}
      />
    )}
  </section>
)
const DiscoverView = ({
  packages,
  categories,
  category,
  query,
  sort,
  onCategory,
  onQuery,
  onSort,
  onSelect,
}: {
  packages: CatalogEntry[]
  categories: string[]
  category: string
  query: string
  sort: 'updated' | 'name'
  onCategory: (value: string) => void
  onQuery: (value: string) => void
  onSort: (value: 'updated' | 'name') => void
  onSelect: (value: string) => void
}) => (
  <section>
    <div className="mb-4">
      <h2 className="text-sm font-semibold">Discover</h2>
      <p className="mt-1 text-xs text-slate-500">
        Reviewed registry releases only. Metadata is verified by the registry, not read from package
        archives.
      </p>
    </div>
    <div className="mb-4 flex flex-wrap gap-2">
      <label className="flex min-w-56 flex-1 items-center gap-2 rounded-xl border border-slate-200/80 bg-white/50 px-3 py-2 dark:border-white/10 dark:bg-slate-950/20">
        <Search className="h-3.5 w-3.5 text-violet-500" />
        <input
          value={query}
          onChange={event => onQuery(event.target.value)}
          placeholder="Search name, publisher, ID, tags…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-slate-400"
        />
      </label>
      <label className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/50 px-3 py-2 text-xs dark:border-white/10 dark:bg-slate-950/20">
        <Filter className="h-3.5 w-3.5 text-slate-400" />
        <select
          value={category}
          onChange={event => onCategory(event.target.value)}
          className="bg-transparent outline-none"
        >
          {categories.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <select
        value={sort}
        onChange={event => onSort(event.target.value as 'updated' | 'name')}
        className="rounded-xl border border-slate-200/80 bg-white/50 px-3 py-2 text-xs outline-none dark:border-white/10 dark:bg-slate-950/20"
      >
        <option value="updated">Updated</option>
        <option value="name">Name</option>
      </select>
    </div>
    {packages.length ? (
      <div className="grid gap-2">
        {packages.map(item => (
          <PackageRow key={item.package.packageId} item={item} onSelect={onSelect} />
        ))}
      </div>
    ) : (
      <EmptyState
        title="Nothing matches this search"
        text="Try a different category or remove a filter."
      />
    )}
  </section>
)
const PackageRow = ({
  item,
  onSelect,
}: {
  item: CatalogEntry
  onSelect: (value: string) => void
}) => (
  <button
    onClick={() => onSelect(item.package.packageId)}
    className="group flex w-full items-center gap-3 rounded-xl border border-slate-200/75 bg-white/40 px-3 py-3 text-left shadow-[0_12px_25px_-24px_rgba(30,41,59,.45)] transition-colors hover:border-violet-400/40 hover:bg-violet-500/[.035] dark:border-white/[.09] dark:bg-white/[.025] dark:hover:bg-violet-400/[.055]"
  >
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-xs font-bold text-violet-700 dark:text-violet-200">
      {item.installed?.iconSvg || item.package.iconAssets?.light.dataUrl ? (
        <>
          <img
            className="h-7 w-7 object-contain dark:hidden"
            src={item.installed?.iconSvg ?? item.package.iconAssets?.light.dataUrl ?? undefined}
            alt=""
          />
          <img
            className="hidden h-7 w-7 object-contain dark:block"
            src={
              item.installed?.iconSvgDark ??
              item.installed?.iconSvg ??
              item.package.iconAssets?.dark.dataUrl ??
              item.package.iconAssets?.light.dataUrl ??
              undefined
            }
            alt=""
          />
        </>
      ) : (
        item.package.displayName.slice(0, 1).toUpperCase()
      )}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{item.package.displayName}</span>
        {item.installed && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${item.installed.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/10 text-slate-500'}`}
          >
            {item.installed.enabled ? 'Enabled' : 'Disabled'}
          </span>
        )}
        {item.update && (
          <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:text-violet-300">
            v{item.update.version} available
          </span>
        )}
        {item.revoked && (
          <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-700 dark:text-red-300">
            Revoked
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">
        {item.package.publisher?.displayName ?? 'Registry package'} ·{' '}
        {item.package.description || item.package.packageId}
      </p>
    </div>
    <span className="hidden text-[10px] text-slate-400 sm:block">
      v{item.installed?.version ?? item.package.version}
    </span>
  </button>
)
const BuiltInsView = ({ utilities }: { utilities: CoreUtility[] }) => (
  <section>
    <h2 className="text-sm font-semibold">Built-ins</h2>
    <p className="mt-1 text-xs text-slate-500">
      These contributions ship with ClipsX. They are informational and do not have package
      permissions.
    </p>
    <div className="mt-4 grid gap-2">
      {utilities.map(item => (
        <div
          key={item.id}
          className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white/35 px-3 py-3 text-xs dark:border-white/[.08] dark:bg-white/[.025]"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{item.label}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {item.kind} · {item.id}
            </div>
          </div>
          <span className="text-[10px] text-slate-400">v{item.version}</span>
        </div>
      ))}
    </div>
  </section>
)
const DeveloperView = ({
  enabled,
  busy,
  onToggle,
  onInstall,
}: {
  enabled: boolean
  busy: boolean
  onToggle: (value: boolean) => Promise<void>
  onInstall: () => void
}) => (
  <section className="w-full">
    <h2 className="text-sm font-semibold">Developer Mode</h2>
    <p className="mt-1 text-xs text-slate-500">
      Use this only for local package development. Unsigned local archives are not registry reviewed
      and never receive automatic updates.
    </p>
    <div className="mt-4 w-full rounded-2xl border border-amber-500/20 bg-amber-500/[.045] p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600">
          <Code2 className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">Allow local packages</div>
          <p className="mt-0.5 text-xs text-slate-500">
            Review the unsigned package and its permissions before each install. Replacement
            invalidates previous grants.
          </p>
        </div>
        <Switch checked={enabled} onChange={value => void onToggle(value)} size="sm" />
      </div>
      {enabled && (
        <div className="mt-4 border-t border-amber-500/15 pt-4">
          <Button
            size="sm"
            isLoading={busy}
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={onInstall}
          >
            Install local .clipsx package
          </Button>
        </div>
      )}
    </div>
  </section>
)
const EmptyState = ({
  title,
  text,
  action,
  onAction,
}: {
  title: string
  text: string
  action?: string
  onAction?: () => void
}) => (
  <div className="rounded-2xl border border-dashed border-slate-300/80 bg-white/25 px-5 py-12 text-center dark:border-white/15 dark:bg-white/[.02]">
    <ShieldAlert className="mx-auto h-5 w-5 text-violet-500" />
    <h3 className="mt-3 text-sm font-semibold">{title}</h3>
    <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">{text}</p>
    {action && (
      <Button className="mt-4" size="sm" onClick={onAction}>
        {action}
      </Button>
    )}
  </div>
)
