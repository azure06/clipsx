import i18n from '../../i18n/index'
import { AlertCircle, CheckCircle2, Clock3, Loader2, PauseCircle, XCircle } from 'lucide-react'
import type { ExtensionJob } from './useClipExtensionJobs'

export function jobStatusLabel(job: Pick<ExtensionJob, 'status' | 'reasonCode'>) {
  switch (job.status) {
    case 'pending':
      return job.reasonCode && job.reasonCode !== 'restart_recovery'
        ? i18n.t('desktopUi.retryScheduled')
        : i18n.t('desktopUi.queued')
    case 'running':
      return i18n.t('desktopUi.running')
    case 'waiting_provider':
      return i18n.t('desktopUi.waitingForModel')
    case 'waiting_write_review':
      return i18n.t('desktopUi.needsDeliveryReview')
    case 'completed':
      return i18n.t('desktopUi.completed')
    case 'failed':
      return i18n.t('desktopUi.failed')
    case 'cancelled':
      return i18n.t('desktopUi.cancelled')
  }
}

export function ExtensionJobStatusIcon({
  job,
}: {
  job: Pick<ExtensionJob, 'status' | 'reasonCode'>
}) {
  const Icon =
    job.status === 'running'
      ? Loader2
      : job.status === 'pending'
        ? Clock3
        : job.status === 'completed'
          ? CheckCircle2
          : job.status === 'failed'
            ? AlertCircle
            : job.status === 'cancelled'
              ? XCircle
              : PauseCircle
  return (
    <Icon
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 ${job.status === 'running' ? 'animate-spin motion-reduce:animate-none' : ''} ${job.status === 'failed' || job.status === 'waiting_write_review' ? 'text-amber-600 dark:text-amber-400' : ''}`}
    />
  )
}
