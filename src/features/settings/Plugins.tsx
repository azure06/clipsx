import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  Brain,
  Image,
  ScanText,
  Download,
  Trash2,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { useSettingsStore } from '../../stores'
import { Switch, Button } from '../../shared/components/ui'
import type {
  AiCapabilityStatus,
  AiCapabilityKind,
  AiCapabilityProgressEvent,
  AiIndexProgressEvent,
} from '../../shared/types'

interface IndexingOverview {
  totalEligibleClips: number
  indexedClips: number
  missingCount: number
  staleCount: number
  failedCount: number
  pendingCount: number
  activeStackVersion: string
  lastErrorSummary: string | null
}

type CapabilityProgress = Record<
  string,
  { label: string; downloaded: number; total: number; phase: string }
>

export const Plugins = () => {
  const { settings, loadSettings } = useSettingsStore()
  const [capabilities, setCapabilities] = useState<AiCapabilityStatus[]>([])
  const [overview, setOverview] = useState<IndexingOverview | null>(null)
  const [progress, setProgress] = useState<CapabilityProgress>({})
  const [indexProgress, setIndexProgress] = useState<AiIndexProgressEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKind, setBusyKind] = useState<AiCapabilityKind | null>(null)

  useEffect(() => {
    void fetchCapabilities()
    void fetchIndexingOverview()

    const unlistenProgress = listen<AiCapabilityProgressEvent>('ai-capability-progress', event => {
      const p = event.payload
      setProgress(prev => ({
        ...prev,
        [p.capability]: {
          label: p.label,
          downloaded: p.downloaded,
          total: p.total,
          phase: p.phase,
        },
      }))
    })

    const unlistenIndex = listen<AiIndexProgressEvent>('ai-stack-index-progress', event => {
      setIndexProgress(event.payload)
    })

    const unlistenCaps = listen('ai-capabilities-changed', () => {
      void fetchCapabilities()
      void fetchIndexingOverview()
    })

    return () => {
      void unlistenProgress.then(f => f())
      void unlistenIndex.then(f => f())
      void unlistenCaps.then(f => f())
    }
  }, [])

  const fetchCapabilities = async () => {
    try {
      const caps = await invoke<AiCapabilityStatus[]>('get_ai_capabilities')
      setCapabilities(caps)
    } catch (err) {
      console.error('Failed to fetch AI capabilities:', err)
    }
  }

  const fetchIndexingOverview = async () => {
    try {
      const next = await invoke<IndexingOverview>('get_indexing_overview')
      setOverview(next)
    } catch (err) {
      console.error('Failed to fetch indexing overview:', err)
    }
  }

  const handleInstall = async (kind: AiCapabilityKind) => {
    try {
      setError(null)
      setBusyKind(kind)
      await invoke('install_ai_capability', { kind })
      await loadSettings()
      await fetchCapabilities()
      await fetchIndexingOverview()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusyKind(null)
      setProgress(prev => {
        const next = { ...prev }
        delete next[kind]
        return next
      })
    }
  }

  const handleDelete = async (kind: AiCapabilityKind) => {
    try {
      setError(null)
      setBusyKind(kind)
      await invoke('delete_ai_capability', { kind })
      await loadSettings()
      await fetchCapabilities()
      await fetchIndexingOverview()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusyKind(null)
    }
  }

  const handleToggleTextSearch = async (enabled: boolean) => {
    try {
      setError(null)
      await invoke('set_text_search_enabled', { enabled })
      await loadSettings()
      await fetchCapabilities()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleToggleImageSearch = async (enabled: boolean) => {
    try {
      setError(null)
      await invoke('set_image_search_enabled', { enabled })
      await loadSettings()
      await fetchCapabilities()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleIndexMissing = async () => {
    try {
      setError(null)
      const next = await invoke<IndexingOverview>('index_missing_search_content')
      setOverview(next)
    } catch (err) {
      setError(String(err))
    } finally {
      await fetchIndexingOverview()
    }
  }

  const handleReindexAll = async () => {
    try {
      setError(null)
      setIndexProgress({ done: 0, total: overview?.totalEligibleClips ?? 0 })
      const next = await invoke<IndexingOverview>('reindex_all_search_content')
      setOverview(next)
    } catch (err) {
      setError(String(err))
    } finally {
      setIndexProgress(null)
      await fetchIndexingOverview()
    }
  }

  const textSearchCap = capabilities.find(c => c.kind === 'text_search') ?? null
  const imageSearchCap = capabilities.find(c => c.kind === 'image_search') ?? null
  const isAiUsable =
    textSearchCap?.installState === 'ready' && settings?.text_search_enabled === true
  const hasMissingOrStale =
    (overview?.missingCount ?? 0) + (overview?.staleCount ?? 0) + (overview?.failedCount ?? 0) > 0

  const eligible = overview?.totalEligibleClips ?? 0
  const indexed = overview?.indexedClips ?? 0
  const indexedPct = eligible > 0 ? Math.round((indexed / eligible) * 100) : 0

  return (
    <div className="relative h-full w-full overflow-y-auto bg-transparent text-gray-900 dark:text-gray-100 custom-scrollbar animate-fade-in">
      <div className="px-6 py-6 space-y-6">
        {/* ── Header ── */}
        <div>
          <h1 className="text-lg font-bold tracking-tight">AI Capabilities</h1>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Install only what you need. Models run entirely on-device.
          </p>
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Each model uses about 1.5 GB of RAM while loaded. Text Search and Image Search can be
            enabled independently, so you can choose which models stay in memory.
          </p>
        </div>

        {/* ── Global error ── */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Model cards grid ── */}
        <section className="space-y-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Models
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {textSearchCap && (
              <CapabilityCard
                cap={textSearchCap}
                icon={<Brain className="h-5 w-5" />}
                capProgress={progress['text_search'] ?? null}
                isBusy={busyKind === 'text_search'}
                onInstall={() => void handleInstall('text_search')}
                onDelete={() => void handleDelete('text_search')}
                description="Semantic search using BGE-M3. Understands meaning, not just keywords. This model uses about 1.5 GB RAM while loaded."
                accent="indigo"
                extra={
                  textSearchCap.installState === 'ready' ? (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Enable search
                      </span>
                      <Switch
                        checked={settings?.text_search_enabled ?? false}
                        disabled={busyKind !== null}
                        onChange={value => void handleToggleTextSearch(value)}
                      />
                    </div>
                  ) : null
                }
              />
            )}

            {imageSearchCap && (
              <CapabilityCard
                cap={imageSearchCap}
                icon={<Image className="h-5 w-5" />}
                capProgress={progress['image_search'] ?? null}
                isBusy={busyKind === 'image_search'}
                onInstall={() => void handleInstall('image_search')}
                onDelete={() => void handleDelete('image_search')}
                description="Visual search with SigLIP2 ViT-B/16. Find images by describing them. This model uses about 1.5 GB RAM while loaded."
                accent="violet"
                extra={
                  imageSearchCap.installState === 'ready' ? (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Keep in memory
                      </span>
                      <Switch
                        checked={settings?.image_search_enabled ?? true}
                        disabled={busyKind !== null}
                        onChange={value => void handleToggleImageSearch(value)}
                      />
                    </div>
                  ) : null
                }
              />
            )}
          </div>

          {/* Native OCR — slim row */}
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-100/30 dark:bg-slate-900/30 px-4 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ScanText className="h-3.5 w-3.5" />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Text Recognition (OCR)
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Always active
              </span>
            </div>
            <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500 hidden sm:block">
              Apple Vision · Windows OCR · Tesseract
            </span>
          </div>
        </section>

        {/* ── Search index ── */}
        <section className="space-y-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Search Index
          </h2>

          {/* Coverage card */}
          <div className="rounded-xl border border-white/10 bg-slate-100/40 dark:bg-slate-900/40 px-4 py-3 space-y-2.5">
            {/* Top row: numbers */}
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tabular-nums leading-none">{indexed}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  / {eligible} indexed
                </span>
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${indexedPct === 100 ? 'text-emerald-500' : indexedPct > 50 ? 'text-blue-500' : 'text-amber-500'}`}
              >
                {indexedPct}%
              </span>
            </div>

            {/* Coverage bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200/60 dark:bg-gray-700/40">
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ease-out ${
                  indexedPct === 100
                    ? 'bg-emerald-500'
                    : indexedPct > 50
                      ? 'bg-blue-500'
                      : 'bg-amber-500'
                }`}
                style={{ width: `${indexedPct}%` }}
              />
            </div>

            {/* Mini stats row */}
            <div className="flex items-center gap-4 pt-0.5">
              <MiniStat
                label="Missing"
                value={overview?.missingCount ?? 0}
                warn={(overview?.missingCount ?? 0) > 0}
              />
              <MiniStat
                label="Stale"
                value={overview?.staleCount ?? 0}
                warn={(overview?.staleCount ?? 0) > 0}
              />
              <MiniStat
                label="Failed"
                value={overview?.failedCount ?? 0}
                warn={(overview?.failedCount ?? 0) > 0}
              />
              <MiniStat label="Pending" value={overview?.pendingCount ?? 0} />
            </div>
          </div>

          {/* Index progress */}
          {indexProgress && (
            <div className="rounded-lg border border-blue-200/60 bg-blue-50/60 px-3 py-2 dark:border-blue-500/20 dark:bg-blue-900/10">
              <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Indexing…
                </span>
                <span className="tabular-nums">
                  {indexProgress.done} / {indexProgress.total}
                  {indexProgress.total > 0 &&
                    ` · ${Math.round((indexProgress.done / indexProgress.total) * 100)}%`}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
                <div
                  className="h-1 rounded-full bg-blue-500 transition-all duration-300 ease-out"
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

          {/* Last error */}
          {overview?.lastErrorSummary && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {overview.lastErrorSummary}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void handleIndexMissing()}
              disabled={!isAiUsable || !hasMissingOrStale}
            >
              Index Missing / Stale
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Sparkles className="h-3.5 w-3.5" />}
              onClick={() => void handleReindexAll()}
              disabled={!isAiUsable}
            >
              Reindex All
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}

// ── Capability card ───────────────────────────────────────────────────────────

type Accent = 'indigo' | 'violet'

const accentStyles: Record<Accent, { icon: string; glow: string; bar: string }> = {
  indigo: {
    icon: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    glow: 'from-indigo-500/5 to-transparent',
    bar: 'bg-indigo-500',
  },
  violet: {
    icon: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    glow: 'from-violet-500/5 to-transparent',
    bar: 'bg-violet-500',
  },
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return ''
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 / 1024
  if (mb >= 0.5) return `${mb.toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

interface CapabilityCardProps {
  cap: AiCapabilityStatus
  icon: React.ReactNode
  capProgress: { label: string; downloaded: number; total: number; phase: string } | null
  isBusy: boolean
  onInstall: () => void
  onDelete: () => void
  description: string
  accent: Accent
  extra?: React.ReactNode
}

function CapabilityCard({
  cap,
  icon,
  capProgress,
  isBusy,
  onInstall,
  onDelete,
  description,
  accent,
  extra,
}: CapabilityCardProps) {
  const styles = accentStyles[accent]
  const isDownloading =
    cap.installState === 'downloading' || (isBusy && cap.installState !== 'ready')
  const pct =
    isDownloading && capProgress && capProgress.total > 0
      ? Math.min(100, Math.round((capProgress.downloaded / capProgress.total) * 100))
      : 0
  const isReady = cap.installState === 'ready'
  const isError = cap.installState === 'error'

  return (
    <div
      className={`relative flex flex-col rounded-xl border bg-slate-100/40 dark:bg-slate-900/40 overflow-hidden transition-all duration-200 ${
        isReady
          ? 'border-emerald-500/30 dark:border-emerald-500/20'
          : isError
            ? 'border-red-400/40 dark:border-red-500/30'
            : 'border-white/10'
      }`}
    >
      {/* Accent gradient wash */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b ${styles.glow} opacity-60`}
      />

      <div className="relative flex flex-col gap-3 p-4 flex-1">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${styles.icon}`}>
            {icon}
          </div>
          {isReady && !isBusy && (
            <button
              onClick={onDelete}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
              title="Remove from disk"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Name + status */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {cap.displayName}
            </span>
            <StatusBadge state={cap.installState} />
          </div>
          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
            {cap.deliveryMode === 'cache_managed' ? 'Cache-managed' : 'Self-managed'}
            {cap.sizeBytes > 0 ? ` · ${formatBytes(cap.sizeBytes)}` : ''}
          </p>
        </div>

        {/* Description */}
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400 flex-1">
          {description}
        </p>

        {/* Error */}
        {isError && cap.lastError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {cap.lastError}
          </div>
        )}

        {/* Extra slot */}
        {extra && <div>{extra}</div>}

        {/* Install / retry */}
        {!isReady && (
          <Button
            variant="outline"
            size="sm"
            isLoading={isDownloading}
            leftIcon={
              isError ? <RefreshCw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />
            }
            onClick={onInstall}
            disabled={isDownloading}
          >
            {isDownloading ? 'Downloading…' : isError ? 'Retry' : 'Download'}
          </Button>
        )}

        {/* Download progress */}
        {isDownloading && capProgress && (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-blue-600 dark:text-blue-400">
              <span className="max-w-[65%] truncate font-medium">{capProgress.label}</span>
              <span className="tabular-nums">
                {capProgress.total > 0
                  ? `${formatBytes(capProgress.downloaded)} / ${formatBytes(capProgress.total)}`
                  : `${pct}%`}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
              <div
                className={`h-1 rounded-full transition-all duration-300 ease-out ${styles.bar}`}
                style={{ width: capProgress.total > 0 ? `${pct}%` : '100%' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: AiCapabilityStatus['installState'] }) {
  if (state === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Installed
      </span>
    )
  }
  if (state === 'downloading') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Downloading
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
        <AlertCircle className="h-3 w-3" />
        Error
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-700/40 dark:text-gray-400">
      <ChevronRight className="h-3 w-3" />
      Not installed
    </span>
  )
}

// ── Mini stat ─────────────────────────────────────────────────────────────────

function MiniStat({
  label,
  value,
  warn = false,
}: {
  label: string
  value: number
  warn?: boolean
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span
        className={`text-sm font-bold tabular-nums ${warn && value > 0 ? 'text-amber-500 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}`}
      >
        {value}
      </span>
      <span className="text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
    </div>
  )
}
