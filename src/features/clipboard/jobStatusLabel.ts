import i18n from '../../i18n/index'
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
