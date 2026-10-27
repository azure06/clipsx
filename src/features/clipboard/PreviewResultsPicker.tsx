import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { SearchableSelect } from '../../shared/components/ui/SearchableSelect'
import type { ExtensionJob } from './useClipExtensionJobs'
import { ExtensionJobStatusIcon, jobStatusLabel } from './ExtensionJobStatus'
export function PreviewResultsPicker({
  jobs,
  selectedId,
  onSelect,
}: {
  jobs: ExtensionJob[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const { t, i18n } = useTranslation()
  const selected = jobs.find(job => job.jobId === selectedId) ?? jobs[0]
  return (
    <div data-result-run-picker className="min-w-0 flex-1 [&>div]:max-w-none">
      <SearchableSelect
        compact
        matchTriggerWidth
        label={t('previewWorkspace.chooseResult')}
        value={selected?.jobId ?? ''}
        onChange={onSelect}
        disabled={!selected}
        placeholder={t('resultWorkspace.selectRun')}
        searchLabel={t('resultWorkspace.searchRuns')}
        emptyLabel={t('resultWorkspace.noRuns')}
        leading={<Layers aria-hidden="true" size={14} className="shrink-0 text-violet-500" />}
        options={jobs.map(job => ({
          value: job.jobId,
          label: job.displayLabel,
          group: `${jobStatusLabel(job)}${job.createdAt ? ' · ' + new Date(job.createdAt).toLocaleString(i18n.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}`,
          icon: <ExtensionJobStatusIcon job={job} />,
        }))}
      />
    </div>
  )
}
