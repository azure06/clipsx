import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Bug, ChevronDown, Copy, Download, FileText, FolderOpen, Send, X } from 'lucide-react'
import {
  Button,
  Switch,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../shared/components/ui'
import { executeClipboardOutput } from '../../shared/clipboardOutput'
import { getPlatform } from '../../shared/keyboard/shortcuts'
import type { AppSettings } from '../../shared/types'
import { SettingRow } from './components/SettingsPrimitives'

type CrashReport = { path: string; sha256: string; text: string }
type Summary = { supportCode: string; sentryConfigured: boolean }
type Preferences = Pick<AppSettings, 'error_reporting_enabled' | 'verbose_logging_enabled'>
type Props = {
  preferences?: Preferences
  onPreferencesChange?: (updates: Partial<Preferences>) => void
}

const iconClass = 'h-3.5 w-3.5'
const checkboxClass =
  'mt-0.5 accent-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500'
const filename = (path: string) => path.split(/[\\/]/).pop() ?? path

/** Local tools and an explicit report review, also usable without loaded storage. */
export function DiagnosticsActions({ preferences, onPreferencesChange }: Props) {
  const { t } = useTranslation()
  const reviewId = useId()
  const prepareRef = useRef<HTMLButtonElement>(null)
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null)
  const operationPending = useRef(false)
  const restoreFocus = useRef(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryState, setSummaryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reportLoaded, setReportLoaded] = useState(false)
  const [discoveryFailed, setDiscoveryFailed] = useState(false)
  const [report, setReport] = useState<CrashReport | null>(null)
  const [review, setReview] = useState(false)
  const [consent, setConsent] = useState(false)
  const [includeLogs, setIncludeLogs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    void invoke<Summary>('get_diagnostics_summary')
      .then(value => {
        if (active) {
          setSummary(value)
          setSummaryState('ready')
        }
      })
      .catch(() => {
        if (active) setSummaryState('error')
      })
    void invoke<CrashReport | null>('get_crash_report', { path: null })
      .then(value => {
        if (active) setReport(value)
      })
      .catch(() => {
        if (active) setDiscoveryFailed(true)
      })
      .finally(() => {
        if (active) setReportLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (review) reviewHeadingRef.current?.focus()
    else if (restoreFocus.current) {
      prepareRef.current?.focus()
      restoreFocus.current = false
    }
  }, [review])

  async function perform(action: () => Promise<void>) {
    if (operationPending.current) return
    operationPending.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await action()
    } catch (value) {
      setError(String(value))
    } finally {
      operationPending.current = false
      setBusy(false)
    }
  }

  function closeReview() {
    restoreFocus.current = true
    setReview(false)
    setConsent(false)
    setIncludeLogs(false)
  }

  async function selectReport() {
    const path = await open({
      multiple: false,
      filters: [{ name: t('diagnostics.crashFile'), extensions: ['ips'] }],
    })
    if (!path) return
    const selected = await invoke<CrashReport>('get_crash_report', { path })
    setConsent(false)
    setReport(selected)
    setDiscoveryFailed(false)
    setReview(true)
  }

  async function exportDiagnostics() {
    const path = await save({
      defaultPath: 'clipsx-diagnostics.zip',
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (!path) return
    await invoke('export_diagnostic_bundle', { path })
    setMessage(t('diagnostics.saved'))
  }

  async function sendReport() {
    setSending(true)
    try {
      const result = await invoke<{ eventId: string; status: string }>('send_diagnostic_report', {
        consent,
        selected: report ? { path: report.path, sha256: report.sha256 } : null,
        includeLogs,
      })
      setConsent(false)
      setMessage(t('diagnostics.submitted', { eventId: result.eventId }))
    } finally {
      setSending(false)
    }
  }

  async function exportCrashReport() {
    if (!report) return
    const destination = await save({
      defaultPath: 'ClipsX.ips',
      filters: [{ name: t('diagnostics.crashFile'), extensions: ['ips'] }],
    })
    if (!destination) return
    await invoke('export_crash_report', {
      selected: { path: report.path, sha256: report.sha256 },
      destination,
    })
    setMessage(t('diagnostics.crashSaved'))
  }

  return (
    <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
      {preferences && onPreferencesChange && (
        <>
          <SettingRow
            label={t('diagnostics.automatic')}
            description={t('diagnostics.automaticDescription')}
          >
            <Switch
              ariaLabel={t('diagnostics.automatic')}
              checked={preferences.error_reporting_enabled}
              onChange={value => onPreferencesChange({ error_reporting_enabled: value })}
            />
          </SettingRow>
          <SettingRow
            label={t('settings.verboseLoggingEnabled')}
            description={t('diagnostics.verboseDescription')}
          >
            <Switch
              ariaLabel={t('settings.verboseLoggingEnabled')}
              checked={preferences.verbose_logging_enabled}
              onChange={value => onPreferencesChange({ verbose_logging_enabled: value })}
            />
          </SettingRow>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {t('settings.supportCode')}
              </p>
              <p className="mt-1 font-mono">
                {summary?.supportCode ?? t('diagnostics.codeUnavailable')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !summary?.supportCode}
              leftIcon={<Copy className={iconClass} />}
              onClick={() =>
                void perform(async () => {
                  setCopied(false)
                  await executeClipboardOutput('copy', {
                    kind: 'literal_text',
                    text: summary?.supportCode ?? '',
                  })
                  setCopied(true)
                })
              }
            >
              {t('diagnostics.copyCode')}
            </Button>
            {copied && (
              <p role="status" className="w-full">
                {t('diagnostics.codeCopied')}
              </p>
            )}
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t('diagnostics.reportProblem')}
          </p>
          <p className="mt-0.5 text-slate-500">{t('diagnostics.reportDescription')}</p>
        </div>
        <Button
          ref={prepareRef}
          size="sm"
          disabled={busy || review || !reportLoaded}
          aria-expanded={review}
          aria-controls={reviewId}
          leftIcon={<Bug className={iconClass} />}
          onClick={() => {
            setConsent(false)
            setReview(true)
          }}
        >
          {t('diagnostics.prepare')}
        </Button>
      </div>
      {report && (
        <p className="flex items-start gap-2" role="status">
          <FileText className={`${iconClass} mt-0.5 shrink-0`} />
          <span className="break-all">
            {t('diagnostics.crashAvailable', { filename: filename(report.path) })}
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t('diagnostics.saveTitle')}
          </p>
          <p className="mt-0.5 text-slate-500">{t('diagnostics.saveDescription')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          leftIcon={<Download className={iconClass} />}
          onClick={() => void perform(exportDiagnostics)}
        >
          {t('diagnostics.save')}
        </Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            rightIcon={<ChevronDown className={iconClass} />}
          >
            {t('diagnostics.moreTools')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={event => {
            if (review) {
              event.preventDefault()
              reviewHeadingRef.current?.focus()
            }
          }}
        >
          <DropdownMenuItem
            className="flex items-center gap-2"
            disabled={busy}
            onSelect={() =>
              void perform(async () => {
                await invoke('open_diagnostics_log_folder')
              })
            }
          >
            <FolderOpen className={iconClass} />
            {t('settings.openLogFolder')}
          </DropdownMenuItem>
          {getPlatform() === 'macos' && (
            <DropdownMenuItem
              className="flex items-center gap-2"
              disabled={busy || !reportLoaded}
              onSelect={() => void perform(selectReport)}
            >
              <FileText className={iconClass} />
              {t('diagnostics.chooseCrash')}
            </DropdownMenuItem>
          )}
          {report && (
            <DropdownMenuItem
              className="flex items-center gap-2"
              disabled={busy}
              onSelect={() => void perform(exportCrashReport)}
            >
              <Download className={iconClass} />
              {t('diagnostics.saveCrash')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {review && (
        <section
          id={reviewId}
          aria-labelledby={`${reviewId}-heading`}
          className="space-y-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.025]"
        >
          <h4
            id={`${reviewId}-heading`}
            ref={reviewHeadingRef}
            tabIndex={-1}
            className="text-sm font-semibold text-slate-900 outline-none dark:text-slate-100"
          >
            {t('diagnostics.reviewTitle')}
          </h4>
          <p>{t('diagnostics.contents')}</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>{t('diagnostics.deviceContents')}</li>
            {report && (
              <li>{t('diagnostics.crashContents', { filename: filename(report.path) })}</li>
            )}
            {includeLogs && <li>{t('diagnostics.logContents')}</li>}
          </ul>
          {report && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-all font-medium">{filename(report.path)}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  leftIcon={<X className={iconClass} />}
                  onClick={() => {
                    setReport(null)
                    setConsent(false)
                  }}
                >
                  {t('diagnostics.removeAttachment')}
                </Button>
              </div>
              <p>{t('diagnostics.pathWarning')}</p>
              <details>
                <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                  {t('diagnostics.preview')}
                </summary>
                <p className="my-2 break-all text-slate-500">{report.path}</p>
                <pre
                  tabIndex={0}
                  aria-label={t('recovery.crashReportPreview')}
                  className="custom-scrollbar max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:bg-slate-950"
                >
                  {report.text}
                </pre>
              </details>
            </div>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={includeLogs}
              disabled={busy}
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
              className={checkboxClass}
              checked={consent}
              disabled={busy}
              onChange={event => setConsent(event.target.checked)}
            />
            {t('diagnostics.consent')}
          </label>
          {summaryState === 'loading' && <p role="status">{t('diagnostics.checking')}</p>}
          {summaryState === 'error' && <p role="alert">{t('diagnostics.summaryFailed')}</p>}
          {summaryState === 'ready' && !summary?.sentryConfigured && (
            <p>{t('diagnostics.unavailable')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !consent || !summary?.sentryConfigured}
              isLoading={sending}
              leftIcon={<Send className={iconClass} />}
              onClick={() => void perform(sendReport)}
            >
              {t('recovery.sendReport')}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={closeReview}>
              {t('common.cancel')}
            </Button>
          </div>
        </section>
      )}
      {discoveryFailed && <p role="alert">{t('diagnostics.discoveryFailed')}</p>}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="whitespace-pre-wrap break-words">
          {message}
        </p>
      )}
    </div>
  )
}
