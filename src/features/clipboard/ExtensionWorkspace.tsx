import { ResultViewToggle } from './ResultViewToggle'
import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../i18n/index'
import { ExtensionJobStatusIcon, jobStatusLabel } from './ExtensionJobStatus'
import { failureMessage } from '../extensions/failures'
import { FailureNotice } from '../extensions/FailureNotice'
import { invoke } from '@tauri-apps/api/core'
import {
  Check,
  ClipboardPaste,
  Copy,
  Database,
  GripVertical,
  RotateCcw,
  MoreHorizontal,
  ChevronRight,
  Trash2,
  Info,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { copyClipboardOutput, pasteClipboardOutput } from '../../shared/clipboardOutput'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { useTheme } from '../../shared/hooks/useTheme'
import { RenderModelView } from './RenderModelView'
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../shared/components/ui'
import type { ExtensionJob } from './useClipExtensionJobs'

export type SavedTransformSetup = {
  id: string
  packageId: string
  transformerId: string
  label: string
  parameters: Record<string, unknown>
  defaultView: 'result_only' | 'compare'
  revision: number
  available: boolean
}

const viewLabel = (mime: string) => {
  if (mime === 'text/html') return 'HTML'
  if (mime === 'application/json') return 'JSON'
  if (mime.startsWith('image/')) return 'Image'
  return mime.split('/').pop()?.toUpperCase() ?? 'Output'
}

function ResultSplitDivider({
  ratio,
  onChange,
  containerRef,
}: {
  ratio: number
  onChange: (ratio: number) => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  useTranslation()

  const pointer = useRef<number | null>(null)
  const move = (clientX: number) => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 8) return
    const next = ((clientX - bounds.left - 4) / (bounds.width - 8)) * 100
    onChange(Math.min(75, Math.max(25, next)))
  }
  return (
    <div
      role="separator"
      aria-label={i18n.t('desktopUi.resizeOriginalAndResult')}
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={75}
      aria-valuenow={Math.round(ratio)}
      tabIndex={0}
      onPointerDown={event => {
        event.preventDefault()
        pointer.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (pointer.current === event.pointerId) move(event.clientX)
      }}
      onPointerUp={event => {
        if (pointer.current !== event.pointerId) return
        pointer.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        pointer.current = null
      }}
      onLostPointerCapture={() => {
        pointer.current = null
      }}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onChange(Math.min(75, Math.max(25, ratio + (event.key === 'ArrowRight' ? 5 : -5))))
      }}
      className="group hidden w-2 cursor-col-resize touch-none select-none items-center justify-center bg-slate-200/70 text-slate-500 outline-none hover:bg-violet-400/30 focus:bg-violet-400/40 clip-result-divider dark:bg-white/10"
    >
      <GripVertical className="h-4 w-4 opacity-0 group-hover:opacity-100 group-focus:opacity-100" />
    </div>
  )
}

export type ResultDisplayControls = {
  mode: 'preview' | 'compare'
  onChange: (mode: 'preview' | 'compare') => void
}

export function ExtensionResultTab({
  job,
  presentation,
  canRegenerate,
  onChanged,
  onQueued,
  onRunStarted,
  runPicker,
  onDeleted,
  onDisplayControls,
}: {
  job: ExtensionJob
  presentation: ClipPresentation | null
  canRegenerate: boolean
  onChanged: () => void
  onQueued: (jobId: string, ticket?: number) => void
  onRunStarted?: () => number
  runPicker?: ReactNode
  onDeleted?: () => void
  onDisplayControls?: (controls: ResultDisplayControls | null) => void
}) {
  useTranslation()

  const { appliedTheme } = useTheme()
  const [ordinal, setOrdinal] = useState(0)
  const [raw, setRaw] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { t } = useTranslation()
  const presentations = useMemo(() => {
    const views = job.view?.tabs.length
      ? job.view.tabs.map(tab => ({
          id: tab.id,
          displayName: tab.label,
          layout: tab.layout,
          panels: tab.panels.map(panel =>
            panel.source === 'input'
              ? panel
              : {
                  source: 'output' as const,
                  ordinal:
                    job.outputs.find(output => output.outputId === panel.outputId)?.ordinal ?? 0,
                }
          ),
        }))
      : [
          {
            id: 'result',
            displayName: t('desktopUi.result'),
            layout: 'single' as const,
            panels: [{ source: 'output' as const, ordinal }],
          },
          {
            id: 'compare',
            displayName: t('desktopUi.compare'),
            layout: 'split' as const,
            panels: [{ source: 'input' as const }, { source: 'output' as const, ordinal }],
          },
        ]
    if (job.view?.tabs.length)
      views.push({
        id: 'host-result',
        displayName: t('resultWorkspace.preview'),
        layout: 'single',
        panels: [{ source: 'output', ordinal }],
      })
    if (job.view?.tabs.length)
      views.push({
        id: 'host-compare',
        displayName: t('desktopUi.compare'),
        layout: 'split',
        panels: [{ source: 'input' }, { source: 'output', ordinal }],
      })
    return views
  }, [job.view, job.outputs, ordinal, t])
  const initialView = () =>
    presentations.find(view => view.id === 'host-result')?.id ??
    presentations.find(view => view.id === 'result')?.id ??
    presentations.find(view => view.layout === 'single')?.id ??
    presentations[0]!.id
  const [viewId, setViewId] = useState(initialView)
  const view = presentations.find(item => item.id === viewId) ?? presentations[0]!
  const needsInput = view.panels.some(panel => panel.source === 'input')
  const changeMode = useCallback(
    (mode: 'preview' | 'compare') =>
      setViewId(
        mode === 'compare'
          ? job.view?.tabs.length
            ? 'host-compare'
            : 'compare'
          : job.view?.tabs.length
            ? 'host-result'
            : 'result'
      ),
    [job.view?.tabs.length]
  )
  useEffect(() => {
    onDisplayControls?.({ mode: needsInput ? 'compare' : 'preview', onChange: changeMode })
  }, [needsInput, changeMode, onDisplayControls])
  useEffect(() => () => onDisplayControls?.(null), [onDisplayControls])
  const [ratio, setRatio] = useState(() => {
    const stored = Number(localStorage.getItem('clipsx.transformCompareRatio'))
    return Number.isFinite(stored) && stored >= 25 && stored <= 75 ? stored : 50
  })
  const [output, setOutput] = useState<RenderModel | null>(null)
  const [otherOutputs, setOtherOutputs] = useState<Record<number, RenderModel>>({})
  const [source, setSource] = useState<RenderModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const selectedOutput = job.outputs.find(item => item.ordinal === ordinal) ?? job.outputs[0]
  const selectedOrdinal = selectedOutput?.ordinal
  useEffect(() => {
    localStorage.setItem('clipsx.transformCompareRatio', String(ratio))
  }, [ratio])

  useEffect(() => {
    if (job.status !== 'completed' || selectedOrdinal === undefined) return
    let alive = true
    setOutput(null)
    void invoke<RenderModel>('render_extension_result_output', {
      jobId: job.jobId,
      ordinal: selectedOrdinal,
      raw,
    })
      .then(value => {
        if (alive) setOutput(value)
      })
      .catch(reason => {
        if (alive) setError(failureMessage(reason))
      })
    return () => {
      alive = false
    }
  }, [job.jobId, job.status, selectedOrdinal, raw])
  useEffect(() => {
    if (job.status !== 'completed') return
    const ordinals = [
      ...new Set(
        view.panels
          .filter(
            (panel): panel is { source: 'output'; ordinal: number } => panel.source === 'output'
          )
          .map(panel => panel.ordinal)
      ),
    ].filter(value => value !== selectedOrdinal)
    let alive = true
    void Promise.all(
      ordinals.map(
        async value =>
          [
            value,
            await invoke<RenderModel>('render_extension_result_output', {
              jobId: job.jobId,
              ordinal: value,
              raw,
            }),
          ] as const
      )
    )
      .then(entries => {
        if (alive) setOtherOutputs(Object.fromEntries(entries))
      })
      .catch(reason => {
        if (alive) setError(failureMessage(reason))
      })
    return () => {
      alive = false
    }
  }, [job.jobId, job.status, selectedOrdinal, raw, view.panels])
  useEffect(() => {
    if (job.status !== 'completed' || !needsInput) return
    let alive = true
    void invoke<RenderModel>('render_extension_result_source', { jobId: job.jobId })
      .then(value => {
        if (alive) setSource(value)
      })
      .catch(reason => {
        if (alive) setError(failureMessage(reason))
      })
    return () => {
      alive = false
    }
  }, [job.jobId, job.status, needsInput])

  const sourcePresentation = useMemo(
    () => (source && presentation ? { ...presentation, model: source } : null),
    [presentation, source]
  )
  const presentationFor = (panel: { source: 'input' } | { source: 'output'; ordinal: number }) => {
    if (panel.source === 'input') return sourcePresentation
    const model = panel.ordinal === selectedOrdinal ? output : otherOutputs[panel.ordinal]
    if (!model || !presentation) return null
    const mime = job.outputs.find(item => item.ordinal === panel.ordinal)?.mimeType
    return {
      ...presentation,
      activeView: {
        ...presentation.activeView,
        presentationKind:
          mime === 'application/json' && !raw ? 'json' : presentation.activeView.presentationKind,
      },
      model,
    }
  }
  const operation = async (task: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      onChanged()
    } catch (reason) {
      setError(failureMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const regenerate = async () => {
    if (
      job.completedWrites > 0 &&
      !window.confirm(
        'This run already changed an external destination. Starting again may repeat that change. Continue?'
      )
    )
      return
    const ticket = onRunStarted?.()
    const invocation = await invoke<{ token: string }>('issue_extension_transformer_invocation', {
      transformerId: job.transformerId,
      clipId: job.clipId,
      sourceId: job.sourceId,
    })
    const result = await invoke<{ jobId: string }>('regenerate_extension_result', {
      jobId: job.jobId,
      requestId: crypto.randomUUID(),
      invocationToken: invocation.token,
    })
    if (ticket === undefined) onQueued(result.jobId)
    else onQueued(result.jobId, ticket)
  }

  return (
    <section
      className="clip-result-workspace flex h-full min-h-0 flex-col bg-white/35 dark:bg-transparent"
      aria-label={i18n.t('desktopUi.resultLabel', { label: job.displayLabel })}
    >
      <div className="shrink-0 border-b border-slate-200/70 bg-slate-50/50 px-3 py-2 dark:border-white/5 dark:bg-white/[0.02]">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 max-w-md">
            {runPicker ?? (
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {job.displayLabel}
              </p>
            )}
          </div>
          <span
            role="status"
            title={jobStatusLabel(job)}
            className={`mr-auto flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium ${job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-200/50 text-slate-500 dark:bg-white/5 dark:text-slate-400'}`}
          >
            <ExtensionJobStatusIcon job={job} />
            <span className="hidden sm:inline">{jobStatusLabel(job)}</span>
            <span className="sr-only sm:hidden">{jobStatusLabel(job)}</span>
          </span>
          {['pending', 'running', 'waiting_provider', 'waiting_write_review'].includes(
            job.status
          ) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void operation(() => invoke('cancel_extension_job', { jobId: job.jobId }))
              }
            >
              {t('desktopUi.cancel')}
            </Button>
          )}
          {job.status === 'failed' && job.completedWrites === 0 && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !canRegenerate}
              onClick={() => void operation(regenerate)}
            >
              {t('desktopUi.retry')}
            </Button>
          )}
          {!onDisplayControls && job.status === 'completed' && job.outputs.length > 0 && (
            <ResultViewToggle mode={needsInput ? 'compare' : 'preview'} onChange={changeMode} />
          )}
          {job.status === 'completed' && job.outputs.length > 0 && (
            <>
              {job.resultControls.includes('copy') && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || selectedOrdinal === undefined}
                  aria-label={t('desktopUi.copyResult')}
                  leftIcon={<Copy size={13} />}
                  className="gap-1.5 px-3 text-xs"
                  onClick={() =>
                    void operation(() =>
                      copyClipboardOutput({
                        kind: 'derived_output',
                        jobId: job.jobId,
                        ordinal: selectedOrdinal ?? 0,
                      })
                    )
                  }
                >
                  {t('common.copy')}
                </Button>
              )}
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 px-1.5 text-slate-500 dark:text-slate-400"
                aria-label={t('resultWorkspace.manageRun')}
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {job.status === 'completed' && job.outputs.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {t('resultWorkspace.selectedOutput')}
                  </p>
                  {job.outputs.length > 1 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-xs">
                        {t('desktopUi.resultOutputs')}
                        <ChevronRight aria-hidden="true" size={12} className="ml-auto" />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {job.outputs.map(item => (
                          <DropdownMenuItem
                            key={item.ordinal}
                            aria-current={item.ordinal === selectedOrdinal ? 'true' : undefined}
                            className="gap-2 text-xs"
                            onSelect={() => {
                              setOrdinal(item.ordinal)
                              setRaw(false)
                              if (job.view?.tabs.length)
                                setViewId(needsInput ? 'host-compare' : 'host-result')
                            }}
                          >
                            <span className="w-3">
                              {item.ordinal === selectedOrdinal && <Check size={12} />}
                            </span>
                            {viewLabel(item.mimeType)} · {item.outputId}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {selectedOutput?.hasRenderedView && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-xs">
                        {t('resultWorkspace.display')}
                        <ChevronRight aria-hidden="true" size={12} className="ml-auto" />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {[false, true].map(source => (
                          <DropdownMenuItem
                            key={String(source)}
                            aria-current={raw === source ? 'true' : undefined}
                            className="gap-2 text-xs"
                            onSelect={() => setRaw(source)}
                          >
                            <span className="w-3">{raw === source && <Check size={12} />}</span>
                            {t(source ? 'resultWorkspace.source' : 'resultWorkspace.rendered')}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {!!job.view?.tabs.length && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-xs">
                        {t('previewWorkspace.resultLayout')}
                        <ChevronRight aria-hidden="true" size={12} className="ml-auto" />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {presentations
                          .filter(item => item.id !== 'host-compare')
                          .map(item => (
                            <DropdownMenuItem
                              key={item.id}
                              className="gap-2 text-xs"
                              onSelect={() => setViewId(item.id)}
                            >
                              <span className="w-3">
                                {view.id === item.id && <Check size={12} />}
                              </span>
                              {item.id === 'host-result'
                                ? t('resultWorkspace.preview')
                                : item.displayName}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {job.resultControls.includes('paste') && (
                    <DropdownMenuItem
                      disabled={busy || selectedOrdinal === undefined}
                      className="gap-2 text-xs"
                      onSelect={() =>
                        void operation(() =>
                          pasteClipboardOutput({
                            kind: 'derived_output',
                            jobId: job.jobId,
                            ordinal: selectedOrdinal ?? 0,
                          })
                        )
                      }
                    >
                      <ClipboardPaste size={13} />
                      {t('desktopUi.pasteResult')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t('resultWorkspace.run')}
              </p>
              {job.resultControls.includes('regenerate') && (
                <DropdownMenuItem
                  disabled={busy || !canRegenerate}
                  title={
                    !canRegenerate ? t('desktopUi.installThisTransformerToRegenerate') : undefined
                  }
                  className="gap-2 text-xs"
                  onSelect={() => void operation(regenerate)}
                >
                  <RotateCcw size={13} />
                  {t('resultWorkspace.runAgain')}
                </DropdownMenuItem>
              )}
              {job.status === 'completed' && job.resultControls.includes('save_as_clip') && (
                <DropdownMenuItem
                  disabled={busy}
                  className="gap-2 text-xs"
                  onSelect={() =>
                    void operation(() =>
                      invoke('promote_extension_result', {
                        jobId: job.jobId,
                        requestId: crypto.randomUUID(),
                      })
                    )
                  }
                >
                  <Database size={13} />
                  {t(
                    job.outputs.length > 1 ? 'previewWorkspace.saveRun' : 'desktopUi.saveAsNewClip'
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="gap-2 text-xs"
                onSelect={() => setDetailsOpen(value => !value)}
              >
                <Info size={13} />
                {t('resultWorkspace.runDetails')}
              </DropdownMenuItem>
              {['completed', 'failed', 'cancelled'].includes(job.status) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={busy}
                    className="gap-2 text-xs text-red-600 dark:text-red-400"
                    onSelect={() => {
                      if (
                        window.confirm(
                          t('resultWorkspace.deleteConfirm', { name: job.displayLabel })
                        )
                      )
                        void operation(async () => {
                          await invoke('delete_extension_result', { jobId: job.jobId })
                          onDeleted?.()
                        })
                    }}
                  >
                    <Trash2 size={13} />
                    {t('resultWorkspace.deleteRun')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {detailsOpen && (
          <div className="mt-3 rounded-xl border border-slate-200/70 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold">{t('resultWorkspace.runDetails')}</h3>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('common.close')}
                onClick={() => setDetailsOpen(false)}
              >
                <X size={12} />
              </Button>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[11px]">
              {job.createdAt !== undefined && (
                <>
                  <dt className="text-slate-400">{t('resultWorkspace.created')}</dt>
                  <dd>{new Date(job.createdAt).toLocaleString(i18n.resolvedLanguage)}</dd>
                </>
              )}
              <dt className="text-slate-400">{t('desktopUi.resultOutputs')}</dt>
              <dd>{job.outputs.length}</dd>
              <dt className="text-slate-400">{t('resultWorkspace.extension')}</dt>
              <dd className="break-all text-slate-600 dark:text-slate-300">{job.packageId}</dd>
              <dt className="text-slate-400">{t('resultWorkspace.version')}</dt>
              <dd>{job.transformerVersion}</dd>
              <dt className="text-slate-400">{t('resultWorkspace.operation')}</dt>
              <dd className="break-all">{job.transformerId}</dd>
            </dl>
          </div>
        )}
      </div>
      {job.status === 'completed' && job.outputs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <Check className="mb-3 h-7 w-7 text-emerald-500" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Trans i18nKey="desktopUi.externalChangeCompleted" />
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {i18n.t('desktopUi.confirmedSteps', { count: job.completedWrites })}
          </p>
        </div>
      ) : job.status === 'completed' ? (
        <>
          <div
            ref={splitRef}
            data-testid="extension-result-split"
            data-layout={view.layout}
            className="clip-result-panels flex min-h-0 flex-1 flex-col"
            style={
              view.layout === 'split'
                ? { gridTemplateColumns: `minmax(0, ${ratio}fr) 8px minmax(0, ${100 - ratio}fr)` }
                : undefined
            }
          >
            {view.panels.map((panel, index) => (
              <div key={`${view.id}:${index}`} className="contents">
                {index > 0 && view.layout === 'split' && (
                  <ResultSplitDivider ratio={ratio} onChange={setRatio} containerRef={splitRef} />
                )}
                <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden border-b border-slate-200/60 dark:border-white/10">
                  {view.panels.length > 1 && (
                    <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {panel.source === 'input'
                        ? i18n.t('desktopUi.original')
                        : job.outputs.length > 1
                          ? (job.outputs.find(item => item.ordinal === panel.ordinal)?.outputId ??
                            i18n.t('desktopUi.result'))
                          : i18n.t('desktopUi.result')}
                    </span>
                  )}
                  {presentationFor(panel) && (
                    <RenderModelView
                      appliedTheme={appliedTheme}
                      presentation={presentationFor(panel)!}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
            <ExtensionJobStatusIcon job={job} />
          </span>
          <p className="text-sm font-semibold capitalize text-slate-700 dark:text-slate-200">
            {jobStatusLabel(job)}
          </p>
          {job.status === 'waiting_write_review' ? (
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              <Trans i18nKey="desktopUi.theRemoteChangeMayHaveSucceededBeforeClipsxCould" />
            </p>
          ) : (
            (job.reasonCode || job.status === 'failed' || job.status === 'waiting_provider') && (
              <FailureNotice reason={job.reasonCode} packageId={job.packageId} />
            )
          )}
          {job.completedWrites > 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
              {i18n.t('desktopUi.recordedChanges', { count: job.completedWrites })}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="px-4 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}

export { ExtensionTools } from '../extensions/ExtensionTools'
