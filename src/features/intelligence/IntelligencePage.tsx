import { IntelligenceOverview } from './IntelligenceOverview'
import { DecisionRulesPanel } from './DecisionRulesPanel'
import { AiConfigurationsPanel } from './AiConfigurationsPanel'
import { IntegrationsPanel } from './IntegrationsPanel'
import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../i18n/index'
import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import {
  BrainCircuit,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  LayoutDashboard,
  Languages,
  ListChecks,
  Loader2,
  Plus,
  Plug,
  RefreshCw,
  ScanSearch,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type {
  FailedTextEmbeddingJob,
  SearchSourceDescriptor,
  TextEmbeddingStatus,
} from '../../shared/types/v2'
import { Button, Select, Switch } from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'
import { createCoalescedRefresh } from '../app/coalescedRefresh'

const phaseLabel = (phase: TextEmbeddingStatus['phase'] | undefined) =>
  phase === 'checking'
    ? i18n.t('desktopUi.checking')
    : phase === 'validating_model'
      ? i18n.t('desktopUi.validatingModel')
      : i18n.t(`search.sourceState.${phase ?? 'not_configured'}`)
type SearchSettings = { syntaxMode: 'simple' | 'advanced'; enabledSourceIds: string[] }
type OcrLanguage = { id: string; label: string }
type OcrRuntimeStatus = {
  settings: { enabled: boolean; language: string }
  provider: {
    providerId: string
    providerVersion: string
    available: boolean
    languages: OcrLanguage[]
    recoveryCode: string | null
    recoveryMessage: string | null
  }
  selectedLanguage: string | null
  pendingJobs: number
  runningJobs: number
  failedJobs: number
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const explainOllamaDiagnostic = (diagnostic: string): string => {
  if (/provider (is )?unavailable/.test(diagnostic)) {
    return i18n.t('desktopUi.ollamaWasUnavailableDuringTheLastAttemptYourClips')
  }
  if (diagnostic === 'Ollama returned 400 Bad Request') {
    return i18n.t('desktopUi.ollamaRejectedAPreviousEmbeddingRequestRetryNowIf')
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
  id: 'overview' | 'search' | 'models' | 'indexing' | 'vision' | 'integrations' | 'rules'
  label: string
  description: string
}> = [
  {
    id: 'overview',
    get label() {
      return i18n.t('desktopUi.overview')
    },
    get description() {
      return i18n.t('desktopUi.whatIsActiveAndNeedsAttention')
    },
  },
  {
    id: 'search',
    get label() {
      return i18n.t('desktopUi.search')
    },
    get description() {
      return i18n.t('desktopUi.howClipsxFindsClips')
    },
  },
  {
    id: 'models',
    get label() {
      return i18n.t('desktopUi.models')
    },
    get description() {
      return i18n.t('modelsWorkspace.sectionDescription')
    },
  },
  {
    id: 'rules',
    get label() {
      return i18n.t('decisionRules.title')
    },
    get description() {
      return i18n.t('decisionRules.description')
    },
  },
  {
    id: 'indexing',
    get label() {
      return i18n.t('desktopUi.indexing')
    },
    get description() {
      return i18n.t('desktopUi.buildAndMaintainSearchData')
    },
  },
  {
    id: 'vision',
    get label() {
      return i18n.t('desktopUi.ocrVision')
    },
    get description() {
      return i18n.t('desktopUi.imageUnderstanding')
    },
  },
  {
    id: 'integrations',
    get label() {
      return i18n.t('mcp.integrations')
    },
    get description() {
      return i18n.t('mcp.description')
    },
  },
]

const indexActionLabel: Record<IndexAction, string> = {
  reindex: i18n.t('desktopUi.reindex'),
  index_missing: i18n.t('desktopUi.indexMissing'),
  retry: i18n.t('desktopUi.retry'),
}

export const IntelligencePage = ({
  initialSection = 'overview',
}: { initialSection?: (typeof intelligenceSections)[number]['id'] | 'connections' } = {}) => {
  useTranslation()

  const [status, setStatus] = useState<TextEmbeddingStatus | null>(null)
  const [failedJobs, setFailedJobs] = useState<FailedTextEmbeddingJob[]>([])
  const [showAffectedClips, setShowAffectedClips] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [activeIndexAction, setActiveIndexAction] = useState<ActiveIndexAction | null>(null)
  const [clearingIndex, setClearingIndex] = useState(false)
  const [searchSources, setSearchSources] = useState<SearchSourceDescriptor[]>([])
  const [searchSettings, setSearchSettings] = useState<SearchSettings | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [thresholdDraft, setThresholdDraft] = useState('70')
  const [thresholdSaving, setThresholdSaving] = useState(false)
  const [ocrStatus, setOcrStatus] = useState<OcrRuntimeStatus | null>(null)
  const [ocrSaving, setOcrSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<(typeof intelligenceSections)[number]['id']>(
    initialSection === 'connections' ? 'models' : initialSection
  )
  const overviewNavigation = useRef<HTMLElement>(null)
  const { toast } = useToast()
  const lastFailureToastRef = useRef<string | null>(null)
  const statusRequestRef = useRef(0)

  const isConfigured = Boolean(status?.model && status.phase !== 'not_configured')

  useEffect(() => {
    setThresholdDraft(String(status?.minimumSimilarityPercent ?? 70))
  }, [status?.minimumSimilarityPercent])

  const loadStatus = useCallback(async (): Promise<TextEmbeddingStatus | null> => {
    const request = ++statusRequestRef.current
    try {
      const [s, sources, settings, jobs, ocr] = await Promise.all([
        invoke<TextEmbeddingStatus>('get_text_embedding_status'),
        invoke<SearchSourceDescriptor[]>('list_search_sources'),
        invoke<SearchSettings>('get_search_settings'),
        invoke<FailedTextEmbeddingJob[]>('list_failed_text_embedding_jobs'),
        invoke<OcrRuntimeStatus>('get_ocr_runtime_status'),
      ])
      if (request !== statusRequestRef.current) return s
      setStatus(s)
      setSearchSources(sources)
      setSearchSettings(settings)
      setFailedJobs(Array.isArray(jobs) ? jobs : [])
      if (ocr) setOcrStatus(ocr)
      if (s.phase === 'ready') lastFailureToastRef.current = null
      return s
    } catch (e) {
      if (request !== statusRequestRef.current) return null
      toast({
        title: i18n.t('desktopUi.couldNotRefreshIntelligenceStatus'),
        description: toErrorMessage(e),
        type: 'error',
      })
      return null
    } finally {
      if (request === statusRequestRef.current) setLoadingStatus(false)
    }
  }, [toast])

  useEffect(() => {
    const refresh = createCoalescedRefresh(async () => {
      await loadStatus()
    })
    const requestRefresh = () => refresh.request()
    const u1 = listen('embedding-provider-status-changed', requestRefresh)
    const u2 = listen('embedding-space-changed', requestRefresh)
    const u3 = listen('search-source-status-changed', requestRefresh)
    const u4 = listen('search-index-progress', requestRefresh)
    const u5 = listen<string>('embedding-index-failed', event => {
      requestRefresh()
      const message = event.payload
      if (lastFailureToastRef.current !== message) {
        lastFailureToastRef.current = message
        toast({
          title: i18n.t('desktopUi.meaningSearchNeedsAttention'),
          description: explainOllamaDiagnostic(message),
          type: 'error',
        })
      }
    })
    const u6 = listen('ocr-status-changed', requestRefresh)
    const u8 = listen('ai-configuration-changed', requestRefresh)
    const u7 = listen<string>('ocr-worker-failed', event => {
      requestRefresh()
      toast({
        title: i18n.t('desktopUi.textRecognitionNeedsAttention'),
        description: event.payload,
        type: 'error',
      })
    })
    const subscriptions = [u1, u2, u3, u4, u5, u6, u7, u8]
    // Subscribe before reading: a worker can finish during startup registration.
    void Promise.all(subscriptions).then(requestRefresh, requestRefresh)
    window.addEventListener('focus', requestRefresh)
    return () => {
      refresh.dispose()
      statusRequestRef.current += 1
      window.removeEventListener('focus', requestRefresh)
      for (const subscription of subscriptions) {
        void subscription.then(dispose => dispose()).catch(() => undefined)
      }
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
        title: i18n.t('desktopUi.actionIssues', { label }),
        description: status.diagnostic
          ? explainOllamaDiagnostic(status.diagnostic)
          : i18n.t('desktopUi.failedJobCount', { count: status.failedJobs }),
        type: 'warning',
      })
    } else {
      toast({ title: i18n.t('desktopUi.actionComplete', { label }), type: 'success' })
    }
    setActiveIndexAction(null)
  }, [status, activeIndexAction, toast])

  const saveOcrSettings = async (enabled: boolean, language: string) => {
    if (!ocrStatus || ocrSaving) return
    const previous = ocrStatus
    setOcrSaving(true)
    setOcrStatus({ ...ocrStatus, settings: { enabled, language } })
    try {
      const next = await invoke<OcrRuntimeStatus>('update_ocr_settings', {
        settings: { enabled, language },
      })
      setOcrStatus(next)
      toast({
        title: enabled
          ? i18n.t('desktopUi.textRecognitionUpdated')
          : i18n.t('desktopUi.textRecognitionDisabled'),
        description:
          enabled && language !== previous.settings.language
            ? i18n.t('desktopUi.existingImagesAreQueuedForRecognitionWithTheNew')
            : undefined,
        type: 'success',
      })
    } catch (error) {
      setOcrStatus(previous)
      toast({
        title: i18n.t('desktopUi.couldNotUpdateTextRecognition'),
        description: toErrorMessage(error),
        type: 'error',
      })
    } finally {
      setOcrSaving(false)
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
        title: i18n.t('desktopUi.actionFailed', { label: indexActionLabel[action] }),
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
    if (!window.confirm(i18n.t('desktopUi.resetTheMeaningSearchIndexAndRebuildItFrom'))) return
    setClearingIndex(true)
    try {
      await invoke('clear_text_embedding_space', { spaceId: status?.activeSpaceId ?? '' })
      await loadStatus()
      toast({
        title: i18n.t('desktopUi.indexReset'),
        description: i18n.t('desktopUi.rebuildingFromYourClips'),
        type: 'success',
      })
    } catch (e) {
      toast({
        title: i18n.t('desktopUi.clearIndexFailed'),
        description: toErrorMessage(e),
        type: 'error',
      })
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
        title: i18n.t('desktopUi.couldNotUpdateSearchSettings'),
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

  const updateMeaningThreshold = async (minimumSimilarityPercent: number | null) => {
    setThresholdSaving(true)
    try {
      const next = await invoke<TextEmbeddingStatus>('update_text_embedding_threshold', {
        minimumSimilarityPercent,
      })
      setStatus(next)
      toast({
        title:
          minimumSimilarityPercent === null
            ? i18n.t('desktopUi.meaningThresholdDisabled')
            : i18n.t('desktopUi.thresholdSet', { percent: minimumSimilarityPercent }),
        type: 'success',
      })
    } catch (e) {
      toast({
        title: i18n.t('desktopUi.couldNotUpdateMeaningThreshold'),
        description: toErrorMessage(e),
        type: 'error',
      })
    } finally {
      setThresholdSaving(false)
    }
  }

  const parsedThreshold = Number(thresholdDraft)
  const thresholdDraftIsValid =
    Number.isInteger(parsedThreshold) && parsedThreshold >= 1 && parsedThreshold <= 100

  // Progress bar math
  const indexing = status?.phase === 'indexing'
  const total = status?.eligibleClips ?? 0
  const progressPct = total > 0 ? Math.round((status!.indexedClips / total) * 100) : 100
  const ocrLanguageOptions = [
    {
      value: 'auto',
      label: i18n.t('desktopUi.automatic'),
    },
    ...(ocrStatus?.provider.languages ?? []).map(language => ({
      value: language.id,
      label: language.label,
    })),
  ]
  if (
    ocrStatus &&
    ocrStatus.settings.language !== 'auto' &&
    !ocrLanguageOptions.some(option => option.value === ocrStatus.settings.language)
  ) {
    ocrLanguageOptions.push({
      value: ocrStatus.settings.language,
      label: i18n.t('desktopUi.languageNotInstalled', { language: ocrStatus.settings.language }),
    })
  }

  return (
    <div className="relative flex h-full flex-col overflow-auto p-4 sm:p-8">
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
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              <Trans i18nKey="desktopUi.intelligence" />
            </h1>
            <p className="text-xs text-gray-500">
              <Trans i18nKey="intelligenceOverview.pageDescription" />
            </p>
          </div>
        </div>

        <nav
          ref={overviewNavigation}
          aria-label={i18n.t('desktopUi.intelligenceAreas')}
          role="tablist"
          className="relative flex w-full max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-300/70 bg-slate-100/80 p-1 shadow-[0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-slate-800/60 dark:shadow-[0_6px_18px_rgba(0,0,0,0.16)]"
        >
          {intelligenceSections.map(section => (
            <button
              key={section.id}
              data-intelligence-section={section.id}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              onClick={() => setActiveSection(section.id)}
              className={`group flex min-w-fit flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${activeSection === section.id ? 'border-violet-400/25 bg-linear-to-r from-violet-500/15 to-fuchsia-500/10 text-violet-700 dark:text-violet-200' : 'border-transparent text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/6 dark:hover:text-slate-100'}`}
              title={section.description}
            >
              {section.id === 'overview' && (
                <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {section.id === 'search' && (
                <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {section.id === 'models' && <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.id === 'indexing' && <Database className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.id === 'integrations' && <Plug className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.id === 'vision' && <ScanSearch className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.id === 'rules' && <ListChecks className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {section.label}
            </button>
          ))}
        </nav>

        {activeSection === 'models' && <AiConfigurationsPanel />}
        {activeSection === 'rules' && <DecisionRulesPanel />}
        {activeSection === 'integrations' && <IntegrationsPanel />}
        {activeSection === 'overview' && (
          <IntelligenceOverview
            status={status}
            loading={loadingStatus}
            ocr={ocrStatus}
            onNavigate={destination => {
              setActiveSection(destination)
              overviewNavigation.current
                ?.querySelector<HTMLButtonElement>(`[data-intelligence-section="${destination}"]`)
                ?.focus()
            }}
          />
        )}

        {/* Semantic Search */}
        {activeSection === 'indexing' && (
          <div
            role="tabpanel"
            className="space-y-4 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 dark:border-white/10 dark:bg-slate-100/5"
          >
            {/* Section header */}
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                <Trans i18nKey="desktopUi.semanticSearch" />
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
                  {phaseLabel(status.phase)}
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
                        ? i18n.t('desktopUi.indexingProgress', {
                            done: status.indexedClips.toLocaleString(i18n.resolvedLanguage),
                            total: total.toLocaleString(i18n.resolvedLanguage),
                          })
                        : i18n.t('desktopUi.indexedCount', { count: status.indexedClips })}
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
                      {status.pendingJobs.toLocaleString()}{' '}
                      <Trans i18nKey="desktopUi.clipsPending" />
                    </p>
                  )}
                </div>

                {(status.diagnostic || status.failedJobs > 0) && (
                  <div className="rounded-xl border border-amber-300/45 bg-linear-to-r from-amber-50/90 via-amber-50/60 to-transparent p-3 text-xs text-amber-800 shadow-[0_10px_22px_-20px_rgba(146,64,14,0.65)] dark:border-amber-400/20 dark:from-amber-500/10 dark:via-amber-500/[0.055] dark:text-amber-200">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          <Trans i18nKey="desktopUi.meaningSearchNeedsAttention" />
                        </p>
                        <p className="mt-0.5 leading-5 text-amber-700/90 dark:text-amber-200/80">
                          {status.diagnostic
                            ? explainOllamaDiagnostic(status.diagnostic)
                            : i18n.t('desktopUi.needsIndexingCount', { count: status.failedJobs })}
                        </p>
                        {status.failedJobs > 0 && (
                          <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-200/70">
                            {i18n.t('desktopUi.retryIndexingCount', { count: status.failedJobs })}
                          </p>
                        )}
                      </div>
                      <button
                        className="flex shrink-0 items-center gap-1 font-semibold underline decoration-amber-500/40 underline-offset-2 hover:text-amber-950 disabled:opacity-50 dark:hover:text-white"
                        disabled={activeIndexAction !== null}
                        onClick={() => void handleRetry()}
                      >
                        {activeIndexAction?.kind === 'retry' && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        <Trans i18nKey="desktopUi.retryNow" />
                      </button>
                    </div>
                    {failedJobs.length > 0 && (
                      <div className="mt-2.5 border-t border-amber-300/35 pt-2.5 dark:border-amber-400/15">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 hover:text-amber-950 dark:text-amber-100 dark:hover:text-white"
                          aria-expanded={showAffectedClips}
                          onClick={() => setShowAffectedClips(value => !value)}
                        >
                          {showAffectedClips ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          <Trans i18nKey="desktopUi.showAffectedClips" />
                          {failedJobs.length}
                          {status.failedJobs > failedJobs.length ? '+' : ''})
                        </button>
                        {showAffectedClips && (
                          <div className="mt-2 space-y-1.5">
                            {failedJobs.map(job => (
                              <div
                                key={job.clip.id}
                                className="rounded-lg border border-amber-300/30 bg-white/45 px-2.5 py-2 dark:border-amber-400/10 dark:bg-black/10"
                              >
                                <p className="truncate text-[11px] font-medium text-slate-800 dark:text-slate-100">
                                  {job.clip.historyPreview.title}
                                </p>
                                <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                                  {job.clip.historyPreview.subtitle ??
                                    job.clip.sourceAppName ??
                                    i18n.t('desktopUi.clipboardItem')}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {status.diagnostic && (
                      <details className="mt-2 text-[10px] text-amber-800/75 dark:text-amber-100/65">
                        <summary className="cursor-pointer select-none hover:text-amber-950 dark:hover:text-white">
                          <Trans i18nKey="desktopUi.technicalDetails" />
                        </summary>
                        <p className="mt-1 break-words font-mono leading-4">{status.diagnostic}</p>
                      </details>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <div className="mr-auto grid min-w-full grid-cols-2 gap-2 pb-2 sm:min-w-0 sm:grid-cols-3">
                    <div>
                      <p className="text-[10px] text-gray-500">
                        <Trans i18nKey="desktopUi.dimensions" />
                      </p>
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-100">
                        {status.dimensions?.toLocaleString() ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500">
                        <Trans i18nKey="desktopUi.diskUsed" />
                      </p>
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-100">
                        {formatBytes(status.indexBytes)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500">
                        <Trans i18nKey="desktopUi.rebuildSpace" />
                      </p>
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-100">
                        ~{formatBytes(status.estimatedRebuildBytes)}{' '}
                        <Trans i18nKey="desktopUi.additional" />
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    isLoading={activeIndexAction?.kind === 'reindex'}
                    disabled={activeIndexAction !== null || clearingIndex}
                    onClick={() => void handleReindex()}
                  >
                    <Trans i18nKey="desktopUi.reindexAll" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                    isLoading={activeIndexAction?.kind === 'index_missing'}
                    disabled={activeIndexAction !== null || clearingIndex}
                    onClick={() => void handleIndexMissing()}
                  >
                    <Trans i18nKey="desktopUi.indexMissing" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    isLoading={clearingIndex}
                    disabled={clearingIndex || activeIndexAction !== null}
                    onClick={() => void handleClearIndex()}
                  >
                    <Trans i18nKey="desktopUi.resetIndex" />
                  </Button>
                </div>
                <p className="text-[10px] leading-4 text-gray-500">
                  <Trans i18nKey="desktopUi.keywordSearchAlwaysStaysOnIfMeaningSearchIs" />
                </p>
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
                  <Trans i18nKey="desktopUi.searchConfiguration" />
                </span>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  <Trans i18nKey="desktopUi.sources" />
                </div>
                <p className="text-xs text-gray-500">
                  <Trans i18nKey="desktopUi.chooseWhichIndependentSearchesContributeCandidatesIndexingContinuesWhen" />
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
                          {source.mandatory
                            ? i18n.t('desktopUi.alwaysOn')
                            : i18n.t(`search.sourceState.${source.state}`)}
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

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      <Trans i18nKey="desktopUi.minimumMeaningSimilarity" />
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      <Trans i18nKey="desktopUi.hideMeaningOnlyResultsBelowThisModelSDisplayed" />
                    </p>
                  </div>
                  <Switch
                    size="sm"
                    className="mt-0.5 shrink-0"
                    ariaLabel="Filter weak meaning matches"
                    checked={status?.minimumSimilarityPercent != null}
                    disabled={!isConfigured || thresholdSaving}
                    onChange={checked =>
                      void updateMeaningThreshold(checked ? parsedThreshold || 70 : null)
                    }
                  />
                </div>
                {status?.minimumSimilarityPercent != null && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="space-y-1 text-[10px] font-medium text-gray-500">
                      <Trans i18nKey="desktopUi.similarityPercentage" />
                      <div className="flex items-center rounded-lg border border-slate-300/70 bg-white/70 px-2 dark:border-white/10 dark:bg-black/10">
                        <input
                          aria-label={i18n.t('desktopUi.minimumMeaningSimilarityPercentage')}
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={thresholdDraft}
                          onChange={event => setThresholdDraft(event.target.value)}
                          className="w-16 bg-transparent py-1.5 text-right text-xs text-slate-800 outline-none dark:text-slate-100"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      isLoading={thresholdSaving}
                      disabled={
                        thresholdSaving ||
                        !thresholdDraftIsValid ||
                        parsedThreshold === status.minimumSimilarityPercent
                      }
                      onClick={() => void updateMeaningThreshold(parsedThreshold)}
                    >
                      <Trans i18nKey="desktopUi.apply" />
                    </Button>
                    <p className="basis-full text-[10px] leading-4 text-gray-500">
                      <Trans i18nKey="desktopUi.raiseThisToRemoveWeakMatchesLowerItIf" />
                    </p>
                  </div>
                )}
              </div>

              <div className="h-px bg-slate-200/60 dark:bg-white/10" />

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    <Trans i18nKey="desktopUi.advancedKeywordQueries" />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    <Trans i18nKey="desktopUi.allowRawFts5SyntaxSuchAs" /> <code>car OR truck</code>{' '}
                    <Trans i18nKey="desktopUi.and" /> <code>title*</code>
                    <Trans i18nKey="desktopUi.thisOnlyChangesKeywordSearch" />
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
          <div role="tabpanel" id="intelligence-vision" className="scroll-mt-16 space-y-4">
            <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-100/30 dark:border-white/10 dark:bg-slate-100/5">
              <div className="flex items-start justify-between gap-5 p-5">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-300/40 bg-sky-500/10 dark:border-sky-400/20">
                    <ScanSearch className="h-4 w-4 text-sky-500" strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <Trans i18nKey="desktopUi.textRecognition" />
                    </h2>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-slate-400">
                      <Trans i18nKey="desktopUi.readTextFromCopiedImagesLocallyRecognitionIsDerived" />
                    </p>
                  </div>
                </div>
                <Switch
                  size="sm"
                  checked={ocrStatus?.settings.enabled ?? false}
                  disabled={!ocrStatus || ocrSaving}
                  onChange={enabled =>
                    ocrStatus && void saveOcrSettings(enabled, ocrStatus.settings.language)
                  }
                />
              </div>

              <div className="border-y border-slate-200/60 bg-white/35 px-5 py-3 dark:border-white/8 dark:bg-black/10">
                <div
                  className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2"
                  aria-label={i18n.t('desktopUi.textRecognitionPath')}
                >
                  {[
                    {
                      label: i18n.t('desktopUi.engine'),
                      value: ocrStatus?.provider.providerVersion ?? i18n.t('desktopUi.checking'),
                    },
                    {
                      label: i18n.t('desktopUi.language'),
                      value: ocrStatus?.selectedLanguage ?? i18n.t('desktopUi.unavailable'),
                    },
                    {
                      label: i18n.t('desktopUi.queue'),
                      value: ocrStatus
                        ? i18n.t('desktopUi.waitingCount', {
                            count: ocrStatus.pendingJobs + ocrStatus.runningJobs,
                          })
                        : i18n.t('desktopUi.checking'),
                    },
                  ].map((item, index) => (
                    <div key={item.label} className="contents">
                      {index > 0 && (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                      )}
                      <div className="min-w-0">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          {item.label}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                          {item.value}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div className="flex items-center justify-between gap-5">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Languages
                      className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                      strokeWidth={1.6}
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        <Trans i18nKey="desktopUi.recognitionLanguage" />
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                        <Trans i18nKey="desktopUi.automaticFollowsYourClipsxLanguageThenFallsBackTo" />
                      </p>
                    </div>
                  </div>
                  <Select
                    className="w-44 shrink-0 text-xs"
                    value={ocrStatus?.settings.language ?? 'auto'}
                    disabled={!ocrStatus?.settings.enabled || ocrSaving}
                    onChange={language =>
                      ocrStatus && void saveOcrSettings(ocrStatus.settings.enabled, language)
                    }
                    options={ocrLanguageOptions}
                  />
                </div>

                {ocrStatus?.provider.recoveryMessage && (
                  <div className="flex gap-2.5 rounded-xl border border-amber-300/45 bg-amber-50/65 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-400/15 dark:bg-amber-400/8 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p className="leading-5">{ocrStatus.provider.recoveryMessage}</p>
                  </div>
                )}

                {ocrStatus && ocrStatus.failedJobs > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    {i18n.t('desktopUi.failedImageCount', { count: ocrStatus.failedJobs })}
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200/60 bg-slate-100/20 p-5 opacity-60 dark:border-white/10 dark:bg-slate-100/4">
              <div className="flex items-center gap-2">
                <ScanSearch className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  <Trans i18nKey="desktopUi.visualImageSearch" />
                </span>
                <span className="ml-auto rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/10">
                  <Trans i18nKey="desktopUi.comingSoon" />
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                <Trans i18nKey="desktopUi.semanticSearchOverScreenshotsAndImagesFindABeach" />
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
