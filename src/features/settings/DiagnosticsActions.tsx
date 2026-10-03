import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Button } from '../../shared/components/ui'

type CrashReport = { path: string; sha256: string; text: string }
type Summary = {
  sentryConfigured: boolean
  sentryInitialized: boolean
  errorReportingEnabled: boolean
}

export function DiagnosticsActions({ notifyOnly = false }: { notifyOnly?: boolean }) {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [report, setReport] = useState<CrashReport | null>(null)
  const [review, setReview] = useState(false)
  const [consent, setConsent] = useState(false)
  const [includeLogs, setIncludeLogs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void invoke<Summary>('get_diagnostics_summary')
      .then(setSummary)
      .catch(() => undefined)
    void invoke<CrashReport | null>('get_crash_report', { path: null })
      .then(value => {
        if (
          !notifyOnly ||
          !value ||
          localStorage.getItem('clipsx.dismissedCrashReport') !== value.sha256
        )
          setReport(value)
      })
      .catch(() => undefined)
  }, [notifyOnly])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function selectReport() {
    const path = await open({
      multiple: false,
      filters: [{ name: 'macOS crash report', extensions: ['ips'] }],
    })
    if (!path) return
    setConsent(false)
    setReport(await invoke<CrashReport>('get_crash_report', { path }))
    setReview(true)
  }

  async function exportDiagnostics() {
    const path = await save({
      defaultPath: 'clipsx-diagnostics.zip',
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (!path) return
    await invoke('export_diagnostic_bundle', { path })
    setMessage(t('settings.diagnosticsExportSuccess'))
  }

  async function sendReport() {
    const result = await invoke<{ eventId: string; status: string }>('send_diagnostic_report', {
      consent,
      selected: report ? { path: report.path, sha256: report.sha256 } : null,
      includeLogs,
    })
    setConsent(false)
    setMessage(t('recovery.reportAccepted', { eventId: result.eventId }))
  }

  async function exportCrashReport() {
    if (!report) return
    const destination = await save({
      defaultPath: 'ClipsX.ips',
      filters: [{ name: 'macOS crash report', extensions: ['ips'] }],
    })
    if (destination)
      await invoke('export_crash_report', {
        selected: { path: report.path, sha256: report.sha256 },
        destination,
      })
  }

  if (notifyOnly && !report) return null
  return (
    <div
      className={
        notifyOnly
          ? 'fixed bottom-4 right-4 z-50 max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] space-y-3 overflow-auto rounded-xl border border-slate-300 bg-white p-4 text-xs shadow-lg dark:border-white/10 dark:bg-slate-900'
          : 'space-y-3 text-xs'
      }
    >
      {notifyOnly && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (report) localStorage.setItem('clipsx.dismissedCrashReport', report.sha256)
            setReport(null)
          }}
        >
          {t('common.close')}
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await invoke('open_diagnostics_log_folder')
            })
          }
        >
          {t('settings.openLogFolder')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void perform(exportDiagnostics)}
        >
          {t('settings.exportDiagnostics')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void perform(selectReport)}
        >
          {t('recovery.selectCrashReport')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setReview(value => !value)}
        >
          {t('recovery.reviewReport')}
        </Button>
        {report && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void perform(exportCrashReport)}
          >
            {t('recovery.exportCrashReport')}
          </Button>
        )}
      </div>
      {report && (
        <p className="break-all text-amber-600 dark:text-amber-400">
          {t('recovery.crashReportFound')}: {report.path}
        </p>
      )}
      {review && (
        <div className="space-y-3 rounded-lg border border-slate-300/60 p-3 dark:border-white/10">
          <p>{t('recovery.reportContents')}</p>
          <p>
            {summary?.sentryConfigured
              ? t('recovery.sentryConfigured')
              : t('recovery.sentryUnavailable')}
            .{' '}
            {summary?.errorReportingEnabled
              ? t('recovery.automaticReportingOn')
              : t('recovery.automaticReportingOff')}
          </p>
          {report && (
            <pre
              tabIndex={0}
              aria-label={t('recovery.crashReportPreview')}
              className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 dark:bg-slate-950"
            >
              {report.text}
            </pre>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={includeLogs}
              onChange={event => {
                setIncludeLogs(event.target.checked)
                setConsent(false)
              }}
            />
            {t('recovery.includeLocalLogs')}
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={event => setConsent(event.target.checked)}
            />
            {t('recovery.reportConsent')}
          </label>
          <Button
            size="sm"
            disabled={busy || !consent || !summary?.sentryConfigured}
            isLoading={busy}
            onClick={() => void perform(sendReport)}
          >
            {t('recovery.sendReport')}
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="whitespace-pre-wrap break-words">
          {message}
        </p>
      )}
    </div>
  )
}
