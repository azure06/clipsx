import { AlertCircle, CheckCircle2, Clock3, Loader2, PauseCircle, XCircle } from 'lucide-react'
import type { ExtensionJob } from './useClipExtensionJobs'

export function jobStatusLabel(job: Pick<ExtensionJob, 'status' | 'reasonCode'>) {
  switch (job.status) {
    case 'pending':
      return job.reasonCode === 'provider_retry' ? 'Retry scheduled' : 'Queued'
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

export function ExtensionJobActivity({
  jobs,
  error,
  onSelect,
  onRetry,
}: {
  jobs: ExtensionJob[]
  error: string | null
  onSelect: (id: string) => void
  onRetry: () => void
}) {
  const active = jobs.filter(job => !['completed', 'cancelled'].includes(job.status))
  const job = active.find(item => item.status === 'running') ?? active[0]
  if (error)
    return (
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-amber-600 dark:text-amber-400"
        title="Unable to refresh extension status. Retry."
      >
        Status unavailable · Retry
      </button>
    )
  if (!job) return null
  return (
    <div role="status" aria-live="polite" className="shrink-0">
      <button
        type="button"
        onClick={() => onSelect(job.jobId)}
        title={`${job.displayLabel} · ${jobStatusLabel(job)}. Open for details.`}
        className="flex max-w-56 items-center gap-1.5 rounded-md bg-violet-500/10 px-2 py-1 text-xs text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-300"
      >
        <ExtensionJobStatusIcon job={job} />
        <span className="truncate">
          {job.displayLabel} · {jobStatusLabel(job)}
        </span>
        {active.length > 1 && <span>+{active.length - 1}</span>}
      </button>
    </div>
  )
}
