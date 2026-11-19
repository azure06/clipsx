import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import { jobStatusLabel } from '../clipboard/ExtensionJobStatus'
import { automationOutcomeKey, type AutomationAttempt } from './automationAttempts'
import { describeFailure } from './failures'

export function AutomationAttemptList({
  attempts,
  busy,
  onRetry,
}: {
  attempts: AutomationAttempt[]
  busy: boolean
  onRetry: (attempt: AutomationAttempt) => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <ul className="divide-y divide-slate-200/70 dark:divide-white/10">
      {attempts.map(attempt => {
        const job = attempt.jobStatus
          ? { status: attempt.jobStatus, reasonCode: attempt.jobReasonCode }
          : null
        const failed = attempt.status === 'failed' || job?.status === 'failed'
        return (
          <li
            key={`${attempt.packageId}:${attempt.eventId}:${attempt.activationId}`}
            className="flex flex-wrap items-start justify-between gap-2 py-2"
          >
            <div className="min-w-0 flex-1 break-words">
              <p className="text-xs font-medium">
                {attempt.setupLabel || t('automationRules.title')}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {new Date(attempt.capturedAt).toLocaleString(i18n.resolvedLanguage, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
              <p
                className={`text-xs ${failed ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}
              >
                {job
                  ? jobStatusLabel(job)
                  : t(automationOutcomeKey(attempt.reasonCode, attempt.status))}
              </p>
              {job?.status === 'failed' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {describeFailure(job.reasonCode).message}
                </p>
              )}
            </div>
            {attempt.status === 'failed' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetry(attempt)}>
                {t('desktopUi.retry')}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
