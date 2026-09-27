import { AlertCircle, CheckCircle2, Clock3, Loader2, PauseCircle, XCircle } from 'lucide-react'
import type { ExtensionJob } from './useClipExtensionJobs'

export function jobStatusLabel(job: Pick<ExtensionJob, 'status' | 'reasonCode'>) {
  switch (job.status) {
    case 'pending':
      return job.reasonCode && job.reasonCode !== 'restart_recovery' ? 'Retry scheduled' : 'Queued'
    case 'running':
      return 'Running'
    case 'waiting_provider':
      return 'Waiting for model'
    case 'waiting_write_review':
      return 'Needs delivery review'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
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
