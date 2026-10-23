import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Copy, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Select, Switch } from '../../shared/components/ui'
import { useUIStore } from '../../stores/uiStore'
import type { ExtensionSettingsRequest } from '../../stores/uiStore'
import type { PackageDetail } from '../settings/extensions/types'
import type { AutomationRule } from './ExtensionConfiguration'
import { humanLabel, parameterErrors, type SavedSetup } from './parameters'

type Application = NonNullable<AutomationRule['application']>
type Attempt = {
  eventId: string
  activationId: string
  status: string
  reasonCode: string | null
  setupLabel: string
  capturedAt: number
}
type Rules = { revision: number; rules: AutomationRule[]; attempts?: Attempt[] }
type TestResult = {
  selectedRuleId: string | null
  setupLabel: string | null
  evaluations: Array<{ ruleId: string; probability: number | null; matched: boolean }>
}
const surface =
  'rounded-xl border border-slate-200/70 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[.025]'
const muted = 'text-xs leading-5 text-slate-500 dark:text-slate-400'
const textarea =
  'min-h-24 w-full rounded-lg border border-slate-300 bg-slate-100/70 px-4 py-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
const appKey = (app: Application | null) => (app ? `${app.platform}\u0000${app.id}` : 'all')
const normalized = (rules: AutomationRule[]) => rules.map((rule, order) => ({ ...rule, order }))

export function AutomationEditor({
  packageId,
  detail,
  request,
  onChanged,
}: {
  packageId: string
  detail: PackageDetail
  request?: ExtensionSettingsRequest | null
  onChanged: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [automation, setAutomation] = useState<Rules>({ revision: 0, rules: [] })
  const [applications, setApplications] = useState<Application[]>([])
  const [setups, setSetups] = useState<SavedSetup[]>([])
  const [activationId, setActivationId] = useState(
    () =>
      detail.activations.find(item =>
        detail.transformers.some(
          transformer =>
            transformer.id === request?.transformerId && transformer.localId === item.transformerId
        )
      )?.id ??
      detail.activations[0]?.id ??
      ''
  )
  const [applicationId, setApplicationId] = useState('all')
  const [setupRef, setSetupRef] = useState(
    request?.setupRef ? `${request.setupKind}:${request.setupRef}` : ''
  )
  const [conditional, setConditional] = useState(false)
  const [question, setQuestion] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [sample, setSample] = useState('')
  const [result, setResult] = useState<TestResult | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const editor = useRef<HTMLElement>(null)
  const restore = useRef<{ id: string; action: string } | null>(null)
  const refresh = useCallback(async () => {
    const [rules, apps, saved] = await Promise.all([
      invoke<Rules>('get_extension_automation', { packageId }),
      invoke<Application[]>('list_source_applications'),
      invoke<SavedSetup[]>('list_extension_transform_setups'),
    ])
    setAutomation({ ...rules, rules: normalized(rules.rules) })
    setApplications(
      [
        ...apps,
        ...rules.rules.flatMap(rule =>
          rule.application && !apps.some(app => appKey(app) === appKey(rule.application))
            ? [rule.application]
            : []
        ),
      ].filter((app, index, all) => all.findIndex(other => appKey(other) === appKey(app)) === index)
    )
    setSetups(saved.filter(item => item.packageId === packageId))
    setLoaded(true)
  }, [packageId])
  useEffect(() => {
    void refresh().catch(() => setError(t('automationRules.loadFailed')))
  }, [refresh, detail, t])
  useEffect(() => {
    if (restore.current) {
      const { id, action } = restore.current
      const row = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-rule]') ?? []).find(
        node => node.dataset['rule'] === id
      )
      const button = row?.querySelector<HTMLButtonElement>(
        `[data-action="${action}"]:not(:disabled)`
      )
      ;(
        button ??
        row?.querySelector<HTMLButtonElement>('button:not(:disabled)') ??
        addButton.current
      )?.focus()
      restore.current = null
    }
  }, [automation.rules])
  useEffect(() => {
    if (!automation.attempts?.some(attempt => attempt.status === 'pending')) return
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setError(t('automationRules.loadFailed')))
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [automation.attempts, refresh, t])
  useEffect(() => {
    if (editing) {
      editor.current?.scrollIntoView?.({ block: 'nearest' })
      editor.current?.querySelector<HTMLElement>('textarea, [role=combobox]')?.focus()
    }
  }, [editing])
  useEffect(() => {
    setResult(null)
  }, [applicationId, activationId])
  const activation = detail.activations.find(item => item.id === activationId)
  const transformer = detail.transformers.find(item => item.localId === activation?.transformerId)
  const options = [
    ...(transformer?.setups.map(item => ({
      value: `builtin:${item.id}`,
      label: item.displayName,
      available:
        Object.keys(
          parameterErrors(
            transformer.parameterSchema,
            transformer.parameterUi ?? [],
            item.parameters
          )
        ).length === 0,
    })) ?? []),
    ...setups
      .filter(item => item.transformerId === transformer?.id)
      .map(item => ({ value: `saved:${item.id}`, label: item.label, available: item.available })),
  ]
  const selected = options.find(item => item.value === setupRef)
  const application =
    applicationId === 'all' ? null : applications.find(item => appKey(item) === applicationId)
  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch {
      setError(t('automationRules.actionFailed'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const save = async (rules: AutomationRule[]) => {
    const newlyEnabled = rules.filter(
      rule =>
        rule.enabled &&
        (detail.automationConsentRequired ||
          !automation.rules.some(
            old =>
              old.id === rule.id &&
              old.enabled &&
              old.setupKind === rule.setupKind &&
              old.setupRef === rule.setupRef &&
              appKey(old.application) === appKey(rule.application) &&
              (old.conditionQuestion ?? null) === (rule.conditionQuestion ?? null)
          ))
    )
    if (newlyEnabled.length) {
      const permissions = detail.automationPermissions
      const capabilities = [
        ...permissions.providers.map(provider =>
          provider === 'generation.text'
            ? t('modelsWorkspace.extensionGeneration')
            : provider === 'decision.text'
              ? t('modelsWorkspace.decision')
              : provider
        ),
        ...(newlyEnabled.some(rule => rule.conditionQuestion)
          ? [t('modelsWorkspace.decision')]
          : []),
        ...(permissions.sourceApplication ? [t('automationRules.sourceAccess')] : []),
        ...permissions.http.map(item => t('automationRules.readOrigin', { origin: item.origin })),
        ...permissions.externalWrites.map(item =>
          t('automationRules.writeOrigin', { origin: item.origin })
        ),
        ...(permissions.packageState ? [t('automationRules.stateAccess')] : []),
      ].join(', ')
      if (
        !window.confirm(
          t('automationRules.consent', {
            name: detail.package?.displayName ?? packageId,
            applications: newlyEnabled
              .map(rule => rule.application?.displayName ?? t('desktopUi.allCopiedClips'))
              .join(', '),
            capabilities: capabilities || t('automationRules.localProcessing'),
          })
        )
      )
        return false
    }
    await invoke('set_extension_automation', {
      packageId,
      expectedRevision: automation.revision,
      rules: normalized(rules),
    })
    setResult(null)
    await refresh()
    await onChanged()
    window.dispatchEvent(new Event('clipsx-extension-permissions-changed'))
    return true
  }
  const reset = () => {
    setEditing(null)
    setConditional(false)
    setQuestion('')
    setEnabled(true)
  }
  const edit = (rule: AutomationRule) => {
    setEditing(rule.id)
    setActivationId(rule.activationId)
    setApplicationId(appKey(rule.application))
    setSetupRef(`${rule.setupKind}:${rule.setupRef}`)
    setConditional(rule.conditionQuestion != null)
    setQuestion(rule.conditionQuestion ?? '')
    setEnabled(rule.enabled)
  }
  const move = (index: number, delta: number) => {
    const rules = [...automation.rules]
    ;[rules[index], rules[index + delta]] = [rules[index + delta]!, rules[index]!]
    restore.current = { id: rules[index + delta]!.id, action: delta < 0 ? 'up' : 'down' }
    void run(async () => {
      await save(rules)
    })
  }
  const attemptReason = (attempt: Attempt) => {
    const outcomes = [
      'scheduled',
      'no_match',
      'privacy_restricted',
      'decision_unavailable',
      'stale_context',
      'ineligible',
      'prepare_failed',
      'enqueue_failed',
      'guest_skipped',
      'pending',
      'completed',
      'skipped',
      'failed',
    ] as const
    const code =
      outcomes.find(key => key === attempt.reasonCode) ??
      outcomes.find(key => key === attempt.status) ??
      'failed'
    return t(`automationRules.outcome.${code}`)
  }
  if (!detail.activations.length)
    return <p className={muted}>{t('desktopUi.thisExtensionDoesNotDeclareCaptureAutomation')}</p>
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('automationRules.title')}</h3>
        <p className={muted}>{t('automationRules.priorityHelp')}</p>
        <p className={muted}>{t('automationRules.manualHelp')}</p>
      </div>
      {detail.automationConsentRequired && (
        <div role="alert" className={`${surface} space-y-3 bg-violet-500/5`}>
          <p className={muted}>
            {t('desktopUi.permissionIsRequiredForThisPackageReleaseRulesStay')}
          </p>
          {automation.rules.some(rule => rule.enabled) && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await save(automation.rules)
                })
              }
            >
              {t('desktopUi.reviewPermissions')}
            </Button>
          )}
        </div>
      )}
      {!loaded && !error && (
        <p role="status" className={muted}>
          {t('aiConfig.loading')}
        </p>
      )}
      <div ref={list} className="space-y-3">
        {automation.rules.map((rule, index) => (
          <div key={rule.id} data-rule={rule.id} className={`${surface} space-y-3`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {rule.application?.displayName ?? t('desktopUi.allCopiedClips')}
                </p>
                <p className={`mt-1 break-words ${muted}`}>{rule.setupLabel}</p>
              </div>
              <Switch
                label={t('decisionRules.enabled')}
                checked={rule.enabled}
                disabled={busy || !!rule.reasonCode}
                onChange={value =>
                  void run(async () => {
                    await save(
                      automation.rules.map(item =>
                        item.id === rule.id ? { ...item, enabled: value } : item
                      )
                    )
                  })
                }
              />
            </div>
            <p className="break-words text-sm leading-6">
              {rule.conditionQuestion ?? t('automationRules.always')}
            </p>
            {!rule.conditionQuestion &&
              rule.enabled &&
              automation.rules
                .slice(index + 1)
                .some(
                  next =>
                    next.enabled &&
                    next.activationId === rule.activationId &&
                    appKey(next.application) === appKey(rule.application)
                ) && (
                <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                  {t('automationRules.shadows')}
                </p>
              )}
            {rule.reasonCode && <p className={muted}>{t('automationRules.setupUnavailable')}</p>}
            <div className="flex flex-wrap gap-1 border-t border-slate-200/70 pt-3 dark:border-white/10">
              <Button
                data-action="up"
                size="sm"
                variant="ghost"
                aria-label={t('automationRules.moveUp', { number: index + 1 })}
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                data-action="down"
                size="sm"
                variant="ghost"
                aria-label={t('automationRules.moveDown', { number: index + 1 })}
                disabled={busy || index === automation.rules.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                data-action="edit"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => edit(rule)}
                leftIcon={<Pencil aria-hidden="true" className="h-3.5 w-3.5" />}
              >
                {t('modelsWorkspace.edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || automation.rules.length >= 64}
                onClick={() =>
                  void run(async () => {
                    await save([
                      ...automation.rules,
                      { ...rule, id: crypto.randomUUID(), enabled: false },
                    ])
                  })
                }
                leftIcon={<Copy aria-hidden="true" className="h-3.5 w-3.5" />}
              >
                {t('automationRules.duplicate')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('desktopUi.deleteAutomationRule')}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    restore.current = {
                      id: automation.rules[index + 1]?.id ?? automation.rules[index - 1]?.id ?? '',
                      action: 'edit',
                    }
                    if (
                      (await save(automation.rules.filter(item => item.id !== rule.id))) &&
                      editing === rule.id
                    )
                      reset()
                  })
                }
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {loaded && automation.rules.length === 0 && (
        <p
          className={`rounded-xl border border-dashed border-slate-300 p-5 text-center dark:border-slate-700 ${muted}`}
        >
          {t('automationRules.empty')}
        </p>
      )}
      <section
        ref={editor}
        id={`automation-${packageId}-editor`}
        className={`${surface} space-y-5 [&>div]:w-full`}
        aria-label={t(editing ? 'automationRules.editRule' : 'automationRules.addRule')}
      >
        <h3 className="text-sm font-semibold">
          {t(editing ? 'automationRules.editRule' : 'automationRules.addRule')}
        </h3>
        <Select
          label={t('desktopUi.operation')}
          ariaLabel={t('automationRules.operation')}
          value={activationId}
          disabled={busy}
          onChange={value => {
            setActivationId(value)
            setSetupRef('')
          }}
          options={detail.activations.map(item => ({
            value: item.id,
            label:
              detail.transformers.find(transform => transform.localId === item.transformerId)
                ?.label ?? humanLabel(item.transformerId),
          }))}
        />
        <Select
          label={t('desktopUi.copiedContent')}
          value={applicationId}
          disabled={busy}
          onChange={setApplicationId}
          options={[
            { value: 'all', label: t('desktopUi.allCopiedClips') },
            ...applications.map(app => ({ value: appKey(app), label: app.displayName })),
          ]}
        />
        <Select
          label={t('desktopUi.setup')}
          ariaLabel={t('automationRules.setup')}
          value={setupRef}
          disabled={busy}
          onChange={setSetupRef}
          placeholder={t('desktopUi.chooseASetup')}
          options={options.map(option => ({
            value: option.value,
            label: option.label,
            disabled: !option.available,
          }))}
        />
        <div className="space-y-3">
          <Switch
            label={t('automationRules.onlyWhen')}
            checked={conditional}
            disabled={busy}
            onChange={setConditional}
          />
          {conditional && (
            <>
              <label
                htmlFor={`automation-${packageId}-question`}
                className="flex flex-col gap-3 text-sm font-medium"
              >
                <span>{t('decisionRules.question')}</span>
                <textarea
                  id={`automation-${packageId}-question`}
                  className={textarea}
                  value={question}
                  maxLength={2048}
                  disabled={busy}
                  placeholder={t('automationRules.questionPlaceholder')}
                  onChange={event => setQuestion(event.target.value)}
                />
              </label>
              <p className={muted}>{t('automationRules.conditionHelp')}</p>
              <button
                type="button"
                className="rounded text-xs text-violet-700 underline focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-300"
                onClick={() => useUIStore.getState().setActiveView('intelligence')}
              >
                {t('automationRules.configureModels')}
              </button>
            </>
          )}
        </div>
        <Switch
          label={t('decisionRules.enabled')}
          checked={enabled}
          disabled={busy}
          onChange={setEnabled}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            ref={addButton}
            size="sm"
            disabled={
              busy ||
              !loaded ||
              !selected?.available ||
              application === undefined ||
              (conditional && !question.trim()) ||
              (!editing && automation.rules.length >= 64)
            }
            leftIcon={!editing && <Plus aria-hidden="true" className="h-3.5 w-3.5" />}
            onClick={() =>
              void run(async () => {
                if (application === undefined || !selected) return
                const split = setupRef.indexOf(':')
                const rule: AutomationRule = {
                  id: editing ?? crypto.randomUUID(),
                  activationId,
                  application,
                  enabled,
                  conditionQuestion: conditional ? question.trim() : null,
                  setupKind: setupRef.slice(0, split) as 'builtin' | 'saved',
                  setupRef: setupRef.slice(split + 1),
                  setupLabel: selected.label,
                  defaultView: '',
                  reasonCode: null,
                  revision: automation.revision,
                }
                if (
                  await save(
                    editing
                      ? automation.rules.map(item => (item.id === editing ? rule : item))
                      : [...automation.rules, rule]
                  )
                )
                  reset()
              })
            }
          >
            {t(editing ? 'common.save' : 'desktopUi.addRule')}
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </section>
      <section className={`${surface} space-y-4`} aria-labelledby={`automation-${packageId}-test`}>
        <h3
          id={`automation-${packageId}-test`}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <FlaskConical aria-hidden="true" className="h-4 w-4 text-violet-500" />
          {t('automationRules.testTitle')}
        </h3>
        <p className={muted}>
          {t('automationRules.testHelp', {
            application: application?.displayName ?? t('desktopUi.allCopiedClips'),
          })}
        </p>
        <label
          className="flex flex-col gap-3 text-sm font-medium"
          htmlFor={`automation-${packageId}-sample`}
        >
          <span>{t('decisionRules.sample')}</span>
          <textarea
            id={`automation-${packageId}-sample`}
            className={textarea}
            value={sample}
            disabled={busy}
            onChange={event => {
              setSample(event.target.value)
              setResult(null)
            }}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={
            busy ||
            !sample.trim() ||
            !automation.rules.some(rule => rule.enabled && rule.activationId === activationId) ||
            application === undefined
          }
          onClick={() =>
            void run(async () => {
              setResult(null)
              setResult(
                await invoke<TestResult>('test_extension_automation', {
                  packageId,
                  activationId,
                  rules: automation.rules,
                  application,
                  text: sample,
                })
              )
            })
          }
        >
          {t('automationRules.testButton')}
        </Button>
        {result && (
          <div role="status" className="space-y-2 rounded-xl bg-violet-500/5 p-4">
            <p className="text-sm font-semibold">
              {result.selectedRuleId
                ? t('automationRules.testMatch', { setup: result.setupLabel })
                : t('automationRules.testNoMatch')}
            </p>
            {result.evaluations.map((evaluation, index) => (
              <p key={evaluation.ruleId} className={muted}>
                {t('automationRules.testEvaluation', {
                  number: index + 1,
                  outcome: t(evaluation.matched ? 'decisionRules.match' : 'decisionRules.noMatch'),
                  probability:
                    evaluation.probability === null
                      ? t('automationRules.always')
                      : new Intl.NumberFormat(i18n.resolvedLanguage, {
                          style: 'percent',
                          maximumFractionDigits: 1,
                        }).format(evaluation.probability),
                })}
              </p>
            ))}
            <p className={muted}>{t('decisionRules.probabilityHelp')}</p>
          </div>
        )}
      </section>
      {!!automation.attempts?.length && (
        <section className={`${surface} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('automationRules.activity')}</h3>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(refresh)}>
              {t('automationRules.refresh')}
            </Button>
          </div>
          {automation.attempts.map(attempt => (
            <div
              key={`${attempt.eventId}:${attempt.activationId}`}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-3 dark:border-white/10"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-medium">
                  {attempt.setupLabel || t('automationRules.title')}
                </p>
                <p className={muted}>{attemptReason(attempt)}</p>
              </div>
              {attempt.status === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await invoke('retry_extension_automation', {
                        packageId,
                        eventId: attempt.eventId,
                        activationId: attempt.activationId,
                      })
                      await refresh()
                    })
                  }
                >
                  {t('desktopUi.retry')}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-xs text-red-600 dark:text-red-400">
          <p>{error}</p>
          {!loaded && (
            <Button size="sm" variant="outline" onClick={() => void run(refresh)}>
              {t('desktopUi.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
