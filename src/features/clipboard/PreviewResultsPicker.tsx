import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { Trash2, X } from 'lucide-react'
import { Button, Select } from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'
import type { ExtensionJob } from './useClipExtensionJobs'
import { jobStatusLabel } from './ExtensionJobStatus'

export function PreviewResultsPicker({
  jobs,
  selectedId,
  onSelect,
  onChanged,
}: {
  jobs: ExtensionJob[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation(),
    { toast } = useToast(),
    [busy, setBusy] = useState(false)
  const selected = jobs.find(job => job.jobId === selectedId) ?? jobs[0]
  const terminal = selected && ['completed', 'failed', 'cancelled'].includes(selected.status)
  const remove = async () => {
    if (
      !selected ||
      (terminal &&
        !window.confirm(t('desktopUi.deleteNamedResultConfirm', { label: selected.displayLabel })))
    )
      return
    setBusy(true)
    try {
      await invoke(terminal ? 'delete_extension_result' : 'cancel_extension_job', {
        jobId: selected.jobId,
      })
      if (terminal) onSelect(jobs.find(job => job.jobId !== selected.jobId)?.jobId ?? null)
      onChanged()
    } catch (error) {
      toast({ title: t('common.error'), description: String(error), type: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div className="min-w-0 flex-1">
        <Select
          ariaLabel={t('previewWorkspace.chooseResult')}
          value={selected?.jobId ?? ''}
          disabled={!selected || busy}
          onChange={onSelect}
          options={jobs.map(job => ({
            value: job.jobId,
            label: `${job.displayLabel} · ${jobStatusLabel(job)}${job.createdAt ? ' · ' + new Date(job.createdAt).toLocaleTimeString(i18n.resolvedLanguage, { hour: '2-digit', minute: '2-digit' }) : ''}`,
          }))}
          className="h-8 min-w-0 w-full border-transparent bg-transparent text-xs shadow-none"
        />
      </div>
      {selected && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={t(terminal ? 'desktopUi.deleteNamedResult' : 'desktopUi.cancelNamedResult', {
            label: selected.displayLabel,
          })}
          onClick={() => void remove()}
          className="shrink-0 px-2"
        >
          {terminal ? <Trash2 size={13} /> : <X size={13} />}
        </Button>
      )}
    </div>
  )
}
