import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import { useUIStore } from '../../stores/uiStore'
import {
  localAiDownloads,
  localAiRoles,
  restoreLocalSetupFocus,
  useLocalAiSetup,
  type LocalAiCandidate,
  type LocalAiPlan,
  type LocalAiRole,
  type LocalAiStatus,
} from './localAiSetup'

export function LocalAiSetupDialog() {
  const { t, i18n } = useTranslation()
  const {
    status,
    stage,
    failedStage,
    result,
    check,
    connect,
    setup,
    downloadedBytes,
    model,
    close,
    step,
    plan,
    move,
    select,
    setPrivacy,
  } = useLocalAiSetup()
  const heading = useRef<HTMLHeadingElement>(null)
  const previousStep = useRef(step)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))
    return () => {
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
  }, [])
  useEffect(() => {
    if (previousStep.current !== step || result) heading.current?.focus()
    previousStep.current = step
  }, [result, step])

  const role = localAiRoles[step]
  const working = stage !== null
  const checkingRuntime = stage === 'checking' || stage === 'waiting'
  const running = status?.runtime === 'running'
  const downloads = running && plan ? localAiDownloads(status, plan) : []
  const size = (bytes: number) => formatSize(bytes, i18n.language)
  const activeModel = model ?? t('localAiSetup.selectedModel')
  const progress =
    stage === 'downloading' && downloadedBytes > 0
      ? t('localAiSetup.downloaded', { model, size: size(downloadedBytes) })
      : stage
        ? t(`localAiSetup.stage.${stage}`, { model: activeModel })
        : null
  const openRecall = () => {
    close()
    useUIStore.getState().setActiveView('recall')
  }

  return (
    <Dialog.Root
      open
      onOpenChange={open => {
        if (!open) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl outline-none dark:border-white/10 dark:bg-slate-900"
          onCloseAutoFocus={event => {
            event.preventDefault()
            restoreLocalSetupFocus()
          }}
        >
          <div className="flex shrink-0 items-start gap-3 px-5 pt-5">
            <div className="rounded-xl bg-violet-500/10 p-2 text-violet-600 dark:text-violet-300">
              <Sparkles aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">
                {t('localAiSetup.title')}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t('localAiSetup.description')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="sm" variant="ghost" className="p-1.5" aria-label={t('common.close')}>
                <X aria-hidden="true" className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
            {result ? (
              <>
                <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold">
                  {t('localAiSetup.ready')}
                </h3>
                <Assignments plan={result} />
              </>
            ) : (
              <>
                {running && plan ? (
                  <>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t('localAiSetup.step', { step: step + 1, total: localAiRoles.length + 1 })}
                      </p>
                      <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold">
                        {t(role ? `localAiSetup.roles.${role}.title` : 'localAiSetup.review')}
                      </h3>
                      <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                        {t(
                          role
                            ? `localAiSetup.roles.${role}.description`
                            : 'localAiSetup.reviewHelp'
                        )}
                      </p>
                    </div>
                    {role ? (
                      <ModelOptions
                        role={role}
                        plan={plan}
                        status={status}
                        disabled={working}
                        select={select}
                        setPrivacy={setPrivacy}
                        size={size}
                      />
                    ) : (
                      <>
                        <Assignments plan={plan} />
                        {localAiRoles.some(role => plan[role]) && (
                          <p className="text-xs font-medium">
                            {t(
                              downloads.length
                                ? 'localAiSetup.totalDownload'
                                : 'localAiSetup.noDownloads',
                              {
                                size: size(
                                  downloads.reduce((total, model) => total + model.downloadBytes, 0)
                                ),
                              }
                            )}
                          </p>
                        )}
                      </>
                    )}
                  </>
                ) : status ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t(
                      status.runtime === 'stopped' ? 'localAiSetup.stopped' : 'localAiSetup.missing'
                    )}
                  </p>
                ) : null}

                {progress && (
                  <div className="space-y-1">
                    <p role="status" className="text-sm">
                      {progress}
                    </p>
                    {stage === 'downloading' && (
                      <progress aria-label={progress} className="h-1.5 w-full accent-violet-500" />
                    )}
                  </div>
                )}
                {failedStage && (
                  <p
                    role="alert"
                    className="break-words rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
                  >
                    {t(`localAiSetup.failure.${failedStage}`, {
                      model: activeModel,
                    })}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-200 px-5 py-3 dark:border-white/10">
            {result ? (
              <>
                {result.chat && (
                  <Button
                    size="sm"
                    onClick={openRecall}
                    rightIcon={<ArrowRight aria-hidden="true" className="size-4" />}
                  >
                    {t('localAiSetup.openRecall')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={result.chat ? 'outline' : undefined}
                  onClick={() => close()}
                >
                  {t('localAiSetup.done')}
                </Button>
              </>
            ) : (
              <>
                {running && plan ? (
                  <>
                    {step > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={working}
                        onClick={() => move(-1)}
                      >
                        {t('localAiSetup.back')}
                      </Button>
                    )}
                    {role ? (
                      <Button size="sm" disabled={working} onClick={() => move(1)}>
                        {t(role === 'decision' ? 'localAiSetup.review' : 'localAiSetup.next')}
                      </Button>
                    ) : localAiRoles.some(role => plan[role]) ? (
                      <Button size="sm" disabled={working} onClick={() => void setup()}>
                        {t(downloads.length ? 'localAiSetup.download' : 'localAiSetup.apply')}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => close(true)}>
                        {t('localAiSetup.done')}
                      </Button>
                    )}
                  </>
                ) : status ? (
                  <Button
                    size="sm"
                    disabled={working}
                    onClick={() => void connect(status.runtime === 'stopped' ? 'open' : 'install')}
                  >
                    {t(
                      status.runtime === 'stopped'
                        ? 'localAiSetup.openOllama'
                        : 'localAiSetup.installOllama'
                    )}
                  </Button>
                ) : null}
                {(!running || failedStage === 'checking' || failedStage === 'waiting') && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={working}
                    onClick={() => void check()}
                  >
                    {t('localAiSetup.checkAgain')}
                  </Button>
                )}
                {working && !checkingRuntime && (
                  <Dialog.Close asChild>
                    <Button size="sm" variant="outline">
                      {t('localAiSetup.background')}
                    </Button>
                  </Dialog.Close>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ModelOptions({
  role,
  status,
  plan,
  disabled,
  select,
  setPrivacy,
  size,
}: {
  role: LocalAiRole
  status: LocalAiStatus
  plan: LocalAiPlan
  disabled: boolean
  select: (role: LocalAiRole, id: string | null) => void
  setPrivacy: (enabled: boolean) => void
  size: (bytes: number) => string
}) {
  const { t } = useTranslation()
  const candidates = status.candidates.filter(candidate => candidate.purpose === role)
  const starting = (role === 'chat' && status.startingChat) || candidates[0]?.id
  return (
    <fieldset className="space-y-2 disabled:opacity-60" disabled={disabled}>
      <legend className="sr-only">{t(`localAiSetup.roles.${role}.title`)}</legend>
      {candidates.map(candidate => (
        <ModelOption
          key={candidate.id}
          model={candidate}
          starting={candidate.id === starting}
          installed={status.installedModels.includes(candidate.id)}
          checked={plan[role] === candidate.id}
          onChange={() => select(role, candidate.id)}
          size={size}
        />
      ))}
      <label className={optionClass}>
        <input
          type="radio"
          name="local-ai-model"
          className={radioClass}
          checked={plan[role] === null}
          onChange={() => select(role, null)}
        />
        <span className="min-w-0 text-xs">
          <span className="block font-medium">{t('localAiSetup.skip')}</span>
          <span className="text-slate-600 dark:text-slate-300">{t('localAiSetup.skipHelp')}</span>
        </span>
      </label>
      {role === 'decision' && plan.decision && (
        <label className="flex items-start gap-3 px-3 py-1.5 text-xs">
          <input
            type="checkbox"
            className={radioClass}
            checked={plan.privacy}
            onChange={event => setPrivacy(event.target.checked)}
          />
          <span>
            <span className="block font-medium">{t('localAiSetup.privacy')}</span>
            <span className="text-slate-600 dark:text-slate-300">
              {t('localAiSetup.privacyHelp')}
            </span>
          </span>
        </label>
      )}
    </fieldset>
  )
}

const optionClass =
  'flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 has-checked:border-violet-500/60 has-checked:bg-violet-500/5 dark:border-white/10'
const radioClass =
  'mt-0.5 shrink-0 accent-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'

function ModelOption({
  model,
  installed,
  starting,
  checked,
  onChange,
  size,
}: {
  model: LocalAiCandidate
  installed: boolean
  starting: boolean
  checked: boolean
  onChange: () => void
  size: (bytes: number) => string
}) {
  const { t } = useTranslation()
  return (
    <label className={optionClass}>
      <input
        type="radio"
        name="local-ai-model"
        className={radioClass}
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0 flex-1 text-xs leading-5">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="break-all font-medium">{model.id}</span>
          <span className="text-slate-600 dark:text-slate-300">
            {installed
              ? t('localAiSetup.installed')
              : t('localAiSetup.downloadSize', { size: size(model.downloadBytes) })}
          </span>
        </span>
        {starting && (
          <span className="block font-medium text-violet-700 dark:text-violet-300">
            {t('localAiSetup.startingPoint')}
          </span>
        )}
        <span className="block text-slate-600 dark:text-slate-300">
          {t(`localAiSetup.models.${model.copyKey}`)}
        </span>
      </span>
    </label>
  )
}

function Assignments({ plan }: { plan: LocalAiPlan }) {
  const { t } = useTranslation()
  return (
    <dl className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-white/5">
      {localAiRoles.map(role => (
        <div key={role} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="font-medium">{t(`localAiSetup.roles.${role}.title`)}</dt>
          <dd className="break-all text-slate-600 dark:text-slate-300">
            {plan[role] ?? t('localAiSetup.keepCurrent')}
          </dd>
        </div>
      ))}
      {plan.privacy && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="font-medium">{t('localAiSetup.privacyAssignment')}</dt>
          <dd className="break-all text-slate-600 dark:text-slate-300">{plan.decision}</dd>
        </div>
      )}
    </dl>
  )
}

function formatSize(bytes: number, language: string) {
  const unit = bytes >= 1_000_000_000 ? 'gigabyte' : 'megabyte'
  const amount = bytes / (unit === 'gigabyte' ? 1_000_000_000 : 1_000_000)
  return new Intl.NumberFormat(language, { style: 'unit', unit, maximumFractionDigits: 2 }).format(
    amount
  )
}
