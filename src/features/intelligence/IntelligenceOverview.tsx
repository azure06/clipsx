import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BrainCircuit,
  ListChecks,
  MessageSquare,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Button } from '../../shared/components/ui'
import type { TextEmbeddingStatus } from '../../shared/types/v2'
import type {
  AiConfigurationState,
  AiSelections,
  PrivacySettings,
} from '../recall/contracts.generated'

type Destination = 'models' | 'rules' | 'indexing' | 'vision' | 'integrations'
type Props = {
  status: TextEmbeddingStatus | null
  loading: boolean
  ocr: {
    settings: { enabled: boolean }
    provider: { available: boolean }
    failedJobs: number
  } | null
  onNavigate: (destination: Destination) => void
}
const surface =
  'rounded-2xl border border-slate-200/70 bg-white/55 dark:border-white/10 dark:bg-white/[.025]'
const muted = 'text-xs leading-5 text-slate-500 dark:text-slate-400'

export function IntelligenceOverview({ status, loading, ocr, onNavigate }: Props) {
  const { t } = useTranslation()
  const [configuration, setConfiguration] = useState<AiConfigurationState | null>(null)
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null)
  const [pending, setPending] = useState(true)
  const [failed, setFailed] = useState(false)
  const refresh = useCallback(async () => {
    setPending(true)
    setFailed(false)
    const results = await Promise.allSettled([
      invoke<AiConfigurationState>('ai_configuration_state'),
      invoke<PrivacySettings>('privacy_settings'),
    ])
    if (results[0].status === 'fulfilled' && results[0].value) setConfiguration(results[0].value)
    if (results[1].status === 'fulfilled' && results[1].value) setPrivacy(results[1].value)
    setFailed(results.some(result => result.status === 'rejected' || !result.value))
    setPending(false)
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const assignment = (key: keyof AiSelections) =>
    configuration?.configuration.presets.find(
      preset => preset.id === configuration.configuration.selections[key]
    )?.name
  const modelLabel = (key: keyof AiSelections) =>
    assignment(key) ??
    t(
      pending
        ? 'aiConfig.loading'
        : failed
          ? 'intelligenceOverview.unavailable'
          : 'intelligenceOverview.unassigned'
    )
  const enabledRules = privacy?.rules.filter(rule => rule.enabled).length
  const attention = Boolean(
    status?.diagnostic || status?.failedJobs || status?.phase === 'degraded'
  )
  const searchState = loading
    ? t('aiConfig.loading')
    : status
      ? status.phase === 'checking'
        ? t('desktopUi.checking')
        : status.phase === 'validating_model'
          ? t('desktopUi.validatingModel')
          : t(`search.sourceState.${status.phase}`)
      : t('intelligenceOverview.unavailable')
  const percent =
    status && status.eligibleClips > 0
      ? Math.min(100, Math.round((status.indexedClips / status.eligibleClips) * 100))
      : 0
  const cards = [
    {
      icon: MessageSquare,
      title: t('modelsWorkspace.recall'),
      description: t('intelligenceOverview.recallHelp'),
      detail: modelLabel('defaultChat'),
      destination: 'models',
    },
    {
      icon: ShieldCheck,
      title: t('decisionRules.privacyModel'),
      description: t('intelligenceOverview.privacyHelp'),
      detail:
        assignment('privacyDecision') ??
        t(
          pending
            ? 'aiConfig.loading'
            : failed
              ? 'intelligenceOverview.unavailable'
              : 'intelligenceOverview.heuristics'
        ),
      destination: 'models',
    },
    {
      icon: BrainCircuit,
      title: t('modelsWorkspace.decision'),
      description: t('intelligenceOverview.decisionsHelp'),
      detail: modelLabel('defaultDecision'),
      destination: 'models',
    },
    {
      icon: ListChecks,
      title: t('decisionRules.title'),
      description: t('intelligenceOverview.rulesHelp'),
      detail:
        enabledRules === undefined
          ? t(pending ? 'aiConfig.loading' : 'intelligenceOverview.unavailable')
          : t('intelligenceOverview.enabledRules', { count: enabledRules }),
      destination: 'rules',
    },
    {
      icon: Sparkles,
      title: t('modelsWorkspace.extensionGeneration'),
      description: t('intelligenceOverview.extensionsHelp'),
      detail: modelLabel('extensionGeneration'),
      destination: 'models',
    },
    {
      icon: ScanSearch,
      title: t('desktopUi.ocrVision'),
      description: t('intelligenceOverview.visionHelp'),
      detail: !ocr
        ? t(loading ? 'aiConfig.loading' : 'intelligenceOverview.unavailable')
        : t(
            !ocr.settings.enabled
              ? 'intelligenceOverview.off'
              : !ocr.provider.available || ocr.failedJobs > 0
                ? 'intelligenceOverview.attention'
                : 'intelligenceOverview.on'
          ),
      destination: 'vision',
    },
  ] as const
  return (
    <div role="tabpanel" aria-label={t('desktopUi.overview')} className="space-y-5">
      <section className={`${surface} overflow-hidden`}>
        <div className="border-b border-slate-200/70 bg-violet-500/5 p-5 sm:p-6 dark:border-white/10">
          <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t('intelligenceOverview.title')}
          </h2>
          <p className={`mt-2 max-w-xl ${muted}`}>{t('intelligenceOverview.description')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => onNavigate('models')}
              rightIcon={<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />}
            >
              {t('intelligenceOverview.manageModels')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onNavigate('integrations')}>
              {t('mcp.integrations')}
            </Button>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ScanSearch aria-hidden="true" className="h-4 w-4 text-violet-500" />
                {t('desktopUi.meaningSearch')}
              </h3>
              <p className={`break-words ${muted}`}>
                {loading ? t('aiConfig.loading') : (status?.model ?? t('desktopUi.notConfigured'))}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${attention ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'}`}
            >
              {searchState}
            </span>
          </div>
          {status && status.model && (
            <>
              <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                <span>{t('intelligenceOverview.indexed', { count: status.indexedClips })}</span>
                <span>{t('intelligenceOverview.pending', { count: status.pendingJobs })}</span>
              </div>
              <div
                role="progressbar"
                aria-label={t('desktopUi.indexing')}
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
              >
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </>
          )}
          {attention && (
            <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
              {t('desktopUi.meaningSearchNeedsAttention')}
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onNavigate('indexing')}
            rightIcon={<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />}
          >
            {t('intelligenceOverview.manageIndex')}
          </Button>
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('intelligenceOverview.capabilities')}</h2>
        <p className={muted}>{t('intelligenceOverview.assignmentHelp')}</p>
      </div>
      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/50 p-3 dark:border-amber-400/20"
        >
          <p className={muted}>{t('intelligenceOverview.loadFailed')}</p>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void refresh()}>
            {t('desktopUi.retry')}
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map(({ icon: Icon, title, description, detail, destination }) => (
          <button
            key={title}
            type="button"
            onClick={() => onNavigate(destination)}
            className={`${surface} group flex min-w-0 items-start gap-3 p-4 text-left transition-colors hover:border-violet-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 sm:p-5`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{title}</span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-violet-500"
                />
              </span>
              <span className={`mt-2 block ${muted}`}>{description}</span>
              <span className="mt-4 block break-words text-xs font-medium text-violet-700 dark:text-violet-300">
                {detail}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className={muted}>{t('intelligenceOverview.providerHelp')}</p>
    </div>
  )
}
