import { useEffect, useId, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { BrainCircuit, FlaskConical, ListChecks, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Button, Input, Select, Switch } from '../../shared/components/ui'
import type {
  AiConfiguration,
  DecisionRule,
  PrivacySettings,
  RuleAction,
} from '../recall/contracts.generated'

const surface =
  'rounded-2xl border border-slate-200/70 bg-white/55 p-4 sm:p-5 dark:border-white/10 dark:bg-white/[.025]'
const muted = 'text-xs leading-5 text-slate-500 dark:text-slate-400'
const textarea =
  'min-h-24 w-full rounded-lg border border-slate-300 bg-slate-100/70 px-4 py-3 text-sm font-normal text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'

export function DecisionRulesPanel() {
  const { t, i18n } = useTranslation()
  const id = useId()
  const [draft, setDraft] = useState<PrivacySettings | null>(null)
  const [saved, setSaved] = useState('')
  const [models, setModels] = useState<AiConfiguration | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [testRuleId, setTestRuleId] = useState('')
  const [sample, setSample] = useState('')
  const [probability, setProbability] = useState<number | null>(null)
  const focusNew = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const load = async () => {
    const [settings, configuration] = await Promise.all([
      invoke<PrivacySettings>('privacy_settings'),
      invoke<AiConfiguration>('ai_configuration_export'),
    ])
    setDraft(settings)
    setSaved(JSON.stringify(settings))
    setModels(configuration)
  }
  useEffect(() => {
    void load().catch(() => setError(t('decisionRules.loadFailed')))
  }, [t])
  useEffect(() => {
    if (focusNew.current) {
      Array.from(list.current?.querySelectorAll<HTMLInputElement>('[data-rule-name]') ?? [])
        .at(-1)
        ?.focus()
      focusNew.current = false
    }
  }, [draft?.rules.length])
  const perform = async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      await work()
    } catch {
      setError(t('decisionRules.operationFailed'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const change = (next: PrivacySettings) => {
    setDraft(next)
    setFeedback(null)
    setProbability(null)
  }
  const update = (ruleId: string, fields: Partial<DecisionRule>) => {
    if (draft)
      change({
        ...draft,
        rules: draft.rules.map(rule => (rule.id === ruleId ? { ...rule, ...fields } : rule)),
      })
  }
  if (!draft)
    return (
      <div aria-live="polite" className="space-y-3 p-4">
        <p>{error ?? t('aiConfig.loading')}</p>
        {error && (
          <Button variant="outline" onClick={() => void perform(load)}>
            {t('desktopUi.retry')}
          </Button>
        )}
      </div>
    )
  const valid = draft.rules.every(
    rule => rule.name.trim() && rule.question.trim() && (rule.action !== 'tag' || rule.tag?.trim())
  )
  const actions: Array<{ value: RuleAction; label: string }> = [
    { value: 'mark_private', label: t('decisionRules.markPrivate') },
    { value: 'mark_secret', label: t('decisionRules.markSecret') },
    { value: 'skip', label: t('decisionRules.skip') },
    { value: 'tag', label: t('decisionRules.tag') },
    { value: 'favorite', label: t('decisionRules.favorite') },
    { value: 'pin', label: t('decisionRules.pin') },
  ]
  const modelName = (key: 'privacyDecision' | 'defaultDecision') =>
    models?.presets.find(p => p.id === models.selections[key])?.name ?? t('aiConfig.none')
  const testRule = draft.rules.find(rule => rule.id === testRuleId)
  const matched = probability !== null && probability >= 0.5
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(value)
  return (
    <div role="tabpanel" className="space-y-4">
      <section className={surface} aria-labelledby={`${id}-title`}>
        <div className="mb-2 flex items-center gap-2">
          <ListChecks aria-hidden="true" className="h-4 w-4 text-violet-500" />
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            {t('decisionRules.title')}
          </h3>
        </div>
        <p className={muted}>{t('decisionRules.description')}</p>
        <div className="my-5 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['privacyDecision', ShieldCheck, t('decisionRules.privacyModel')],
              ['defaultDecision', BrainCircuit, t('modelsWorkspace.decision')],
            ] as const
          ).map(([key, Icon, label]) => (
            <div
              key={key}
              className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[.025]"
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
              <div className="min-w-0 space-y-1">
                <p className={muted}>{label}</p>
                <p className="break-words text-sm font-medium">{modelName(key)}</p>
              </div>
            </div>
          ))}
        </div>
        <p className={muted}>{t('decisionRules.providerSummary')}</p>
        <div className="my-5 border-y border-slate-200/70 py-4 dark:border-white/10">
          <Switch
            label={t('decisionRules.skipSecrets')}
            checked={draft.skipSecrets}
            disabled={busy}
            onChange={skipSecrets => change({ ...draft, skipSecrets })}
          />
          <p className={`mt-2 ${muted}`}>{t('decisionRules.skipHelp')}</p>
        </div>
        <details className={muted}>
          <summary className="w-fit cursor-pointer rounded font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 dark:text-slate-200">
            {t('decisionRules.howChecksWork')}
          </summary>
          <div className="mt-3 space-y-2">
            <p>{t('decisionRules.providerNotice')}</p>
            <p>{t('decisionRules.failureHelp')}</p>
          </div>
        </details>
      </section>
      <section className={surface} aria-labelledby={`${id}-rules`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 id={`${id}-rules`} className="text-sm font-semibold">
              {t('decisionRules.customRules')}
            </h3>
            <p className={muted}>{t('decisionRules.rulesHelp')}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || draft.rules.length >= 32}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              focusNew.current = true
              change({
                ...draft,
                rules: [
                  ...draft.rules,
                  {
                    id: crypto.randomUUID(),
                    name: '',
                    question: '',
                    action: 'mark_private',
                    tag: null,
                    enabled: false,
                  },
                ],
              })
            }}
          >
            {t('decisionRules.addRule')}
          </Button>
        </div>
        {!draft.rules.length && (
          <p
            className={`rounded-xl border border-dashed border-slate-300 p-5 text-center dark:border-slate-700 ${muted}`}
          >
            {t('decisionRules.empty')}
          </p>
        )}
        <div ref={list} className="space-y-4">
          {draft.rules.map((rule, index) => (
            <div
              key={rule.id}
              role="group"
              aria-label={rule.name || t('decisionRules.unnamed')}
              className="space-y-5 rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[.015]"
            >
              <div className="flex items-end gap-2">
                <Input
                  data-rule-name
                  label={t('decisionRules.name')}
                  className="min-w-0 flex-1"
                  value={rule.name}
                  maxLength={128}
                  disabled={busy}
                  onChange={name => update(rule.id, { name })}
                />
                <Button
                  variant="ghost"
                  aria-label={t('decisionRules.deleteRule', {
                    name: rule.name || String(index + 1),
                  })}
                  disabled={busy}
                  onClick={() => {
                    change({ ...draft, rules: draft.rules.filter(r => r.id !== rule.id) })
                    if (testRuleId === rule.id) setTestRuleId('')
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <label
                className="flex flex-col gap-3 text-sm font-medium"
                htmlFor={`${id}-${rule.id}`}
              >
                <span>{t('decisionRules.question')}</span>
                <textarea
                  id={`${id}-${rule.id}`}
                  className={textarea}
                  maxLength={2048}
                  value={rule.question}
                  disabled={busy}
                  placeholder={t('decisionRules.questionPlaceholder')}
                  aria-describedby={`${id}-${rule.id}-help`}
                  onChange={event => update(rule.id, { question: event.target.value })}
                />
              </label>
              <p id={`${id}-${rule.id}-help`} className={muted}>
                {t('decisionRules.questionHelp')}
              </p>
              <div
                className={`grid items-end gap-4 [&>div]:w-full [&>div]:min-w-0 ${rule.action === 'tag' ? 'sm:grid-cols-2' : ''}`}
              >
                <Select
                  label={t('decisionRules.action')}
                  value={rule.action}
                  options={actions}
                  disabled={busy}
                  onChange={value =>
                    update(rule.id, { action: value, tag: value === 'tag' ? '' : null })
                  }
                />
                {rule.action === 'tag' && (
                  <Input
                    label={t('decisionRules.tagName')}
                    value={rule.tag ?? ''}
                    maxLength={80}
                    disabled={busy}
                    onChange={tag => update(rule.id, { tag })}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3 dark:border-white/10">
                <p className={muted}>
                  {t(
                    ['tag', 'favorite', 'pin'].includes(rule.action)
                      ? 'decisionRules.generalRouting'
                      : 'decisionRules.privacyRouting'
                  )}
                </p>
                <Switch
                  label={t('decisionRules.enabled')}
                  checked={rule.enabled}
                  disabled={busy}
                  onChange={enabled => update(rule.id, { enabled })}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            disabled={busy || !valid || saved === JSON.stringify(draft)}
            isLoading={busy}
            onClick={() =>
              void perform(async () => {
                await invoke('privacy_save_settings', { settings: draft })
                setSaved(JSON.stringify(draft))
                setFeedback(t('decisionRules.saved'))
              })
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </section>
      {draft.rules.length > 0 && (
        <section className={surface} aria-labelledby={`${id}-test`}>
          <h3 id={`${id}-test`} className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <FlaskConical aria-hidden="true" className="h-4 w-4 text-violet-500" />
            {t('decisionRules.testTitle')}
          </h3>
          <p className={`mb-5 ${muted}`}>{t('decisionRules.testHelp')}</p>
          <div className="space-y-4 [&>div]:w-full">
            <Select
              label={t('decisionRules.selectRule')}
              placeholder={t('decisionRules.selectRule')}
              value={testRuleId}
              disabled={busy}
              options={draft.rules.map(rule => ({
                value: rule.id,
                label: rule.name || t('decisionRules.unnamed'),
              }))}
              onChange={value => {
                setTestRuleId(value)
                setProbability(null)
              }}
            />
            {testRule && (
              <blockquote className="break-words border-l-2 border-violet-400/60 pl-3 text-sm leading-6">
                {testRule.question}
              </blockquote>
            )}
            <label className="flex flex-col gap-3 text-sm font-medium" htmlFor={`${id}-sample`}>
              <span>{t('decisionRules.sample')}</span>
              <textarea
                id={`${id}-sample`}
                className={textarea}
                value={sample}
                disabled={busy}
                onChange={event => {
                  setSample(event.target.value)
                  setProbability(null)
                }}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !testRuleId || !sample.trim() || !valid}
              onClick={() =>
                void perform(async () => {
                  setProbability(null)
                  setProbability(
                    await invoke<number>('privacy_test_rule', {
                      rule: draft.rules.find(rule => rule.id === testRuleId),
                      text: sample,
                    })
                  )
                })
              }
            >
              {t('decisionRules.testRule')}
            </Button>
            {probability !== null && testRule && (
              <div
                role="status"
                className="space-y-3 rounded-xl border border-violet-300/50 bg-violet-500/5 p-4 dark:border-violet-400/20"
              >
                <p className="text-sm font-semibold">
                  {t(matched ? 'decisionRules.match' : 'decisionRules.noMatch')}
                </p>
                <p className="text-sm">
                  {t(
                    matched ? `decisionRules.effect_${testRule.action}` : 'decisionRules.noEffect',
                    { tag: testRule.tag }
                  )}
                </p>
                <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums">
                  <span>
                    {t('decisionRules.trueProbability', { probability: percent(probability) })}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {t('decisionRules.falseProbability', { probability: percent(1 - probability) })}
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                >
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${probability * 100}%` }}
                  />
                </div>
                <p className={muted}>{t('decisionRules.probabilityHelp')}</p>
              </div>
            )}
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {feedback && (
        <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
          {feedback}
        </p>
      )}
    </div>
  )
}
