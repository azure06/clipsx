import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../i18n/index'
import { ExtensionJobStatusIcon, jobStatusLabel } from './ExtensionJobStatus'
import { describeFailure, failureMessage } from '../extensions/failures'
import { FailureNotice } from '../extensions/FailureNotice'
import { invoke } from '@tauri-apps/api/core'
import { Check, ClipboardPaste, Copy, Database, GripVertical, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { copyClipboardOutput, pasteClipboardOutput } from '../../shared/clipboardOutput'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { useTheme } from '../../shared/hooks/useTheme'
import { RenderModelView } from './RenderModelView'
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
      className="group hidden w-2 cursor-col-resize touch-none select-none items-center justify-center bg-slate-200/70 text-slate-500 outline-none hover:bg-violet-400/30 focus:bg-violet-400/40 md:flex dark:bg-white/10"
    >
      <GripVertical className="h-4 w-4 opacity-0 group-hover:opacity-100 group-focus:opacity-100" />
    </div>
  )
}

export function ExtensionResultTab({
  job,
  presentation,
  canRegenerate,
  onChanged,
  onQueued,
}: {
  job: ExtensionJob
  presentation: ClipPresentation | null
  canRegenerate: boolean
  onChanged: () => void
  onQueued: (jobId: string) => void
}) {
  useTranslation()

  const { appliedTheme } = useTheme()
  const [ordinal, setOrdinal] = useState(0)
  const [raw, setRaw] = useState(false)
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
        displayName: t('desktopUi.outputPreview'),
        layout: 'single',
        panels: [{ source: 'output', ordinal }],
      })
    return views
  }, [job.view, job.outputs, ordinal, t])
  const initialView = () =>
    presentations.find(
      view =>
        view.id === job.defaultView ||
        (job.defaultView === 'result_only' && view.layout === 'single') ||
        (job.defaultView === 'compare' && view.panels.some(panel => panel.source === 'input'))
    )?.id ?? presentations[0]!.id
  const [viewId, setViewId] = useState(initialView)
  const view = presentations.find(item => item.id === viewId) ?? presentations[0]!
  const needsInput = view.panels.some(panel => panel.source === 'input')
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
    onQueued(result.jobId)
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-white/35 dark:bg-transparent"
      aria-label={i18n.t('desktopUi.resultLabel', { label: job.displayLabel })}
    >
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200/70 bg-white/55 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/[.025]">
        {job.status !== 'completed' && (
          <span
            role="status"
            title={job.reasonCode ? describeFailure(job.reasonCode).message : undefined}
            className="mr-auto flex shrink-0 items-center gap-1.5 px-1 text-[11px] font-medium text-slate-500"
          >
            <ExtensionJobStatusIcon job={job} />
            {jobStatusLabel(job)}
          </span>
        )}
        {job.status === 'completed' && (
          <>
            {job.outputs.length > 0 && (
              <div
                role="tablist"
                aria-label={i18n.t('desktopUi.resultOutputs')}
                className="flex shrink-0 items-center gap-0.5"
              >
                {job.outputs.map(item => (
                  <button
                    role="tab"
                    aria-selected={selectedOutput?.ordinal === item.ordinal && !raw}
                    type="button"
                    key={item.ordinal}
                    onClick={() => {
                      setOrdinal(item.ordinal)
                      setRaw(false)
                    }}
                    className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${selectedOutput?.ordinal === item.ordinal && !raw ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-500/10'}`}
                  >
                    {viewLabel(item.mimeType)}
                    {job.outputs.length > 1 ? ` ${item.ordinal + 1}` : ''}
                  </button>
                ))}
                {selectedOutput?.hasRenderedView && (
                  <button
                    role="tab"
                    aria-selected={raw}
                    type="button"
                    onClick={() => setRaw(true)}
                    className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${raw ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-500/10'}`}
                  >
                    <Trans i18nKey="desktopUi.raw" />
                  </button>
                )}
              </div>
            )}
            {presentations.length > 1 && (
              <div className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-slate-200 pl-2 dark:border-white/10">
                {presentations.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setViewId(item.id)}
                    aria-pressed={view.id === item.id}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${view.id === item.id ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-500/10'}`}
                  >
                    {item.displayName}
                  </button>
                ))}
              </div>
            )}
            <div className="min-w-2 flex-1" />
            {job.resultControls.includes('copy') && (
              <button
                type="button"
                title={i18n.t('desktopUi.copyResult')}
                aria-label={i18n.t('desktopUi.copyResult')}
                disabled={busy}
                onClick={() =>
                  void operation(() => copyClipboardOutput({ kind: 'derived', jobId: job.jobId }))
                }
                className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"
              >
                <Copy className="h-4 w-4" />
              </button>
            )}
            {job.resultControls.includes('paste') && (
              <button
                type="button"
                title={i18n.t('desktopUi.pasteResult')}
                aria-label={i18n.t('desktopUi.pasteResult')}
                disabled={busy}
                onClick={() =>
                  void operation(() => pasteClipboardOutput({ kind: 'derived', jobId: job.jobId }))
                }
                className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"
              >
                <ClipboardPaste className="h-4 w-4" />
              </button>
            )}
            {job.resultControls.includes('save_as_clip') && (
              <button
                type="button"
                title={i18n.t('desktopUi.saveAsNewClip')}
                aria-label={i18n.t('desktopUi.saveAsNewClip')}
                disabled={busy}
                onClick={() =>
                  void operation(() =>
                    invoke('promote_extension_result', {
                      jobId: job.jobId,
                      requestId: crypto.randomUUID(),
                    })
                  )
                }
                className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"
              >
                <Database className="h-4 w-4" />
              </button>
            )}
            {job.resultControls.includes('regenerate') && (
              <button
                type="button"
                title={
                  canRegenerate
                    ? i18n.t('desktopUi.regenerateResult')
                    : i18n.t('desktopUi.installThisTransformerToRegenerate')
                }
                aria-label={i18n.t('desktopUi.regenerateResult')}
                disabled={busy || !canRegenerate}
                onClick={() => void operation(regenerate)}
                className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </>
        )}
        {job.status === 'failed' && job.completedWrites === 0 && (
          <button
            type="button"
            disabled={busy || !canRegenerate}
            onClick={() => void operation(regenerate)}
          >
            <Trans i18nKey="desktopUi.retry" />
          </button>
        )}
        {['pending', 'running', 'waiting_provider'].includes(job.status) && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void operation(() => invoke('cancel_extension_job', { jobId: job.jobId }))
            }
          >
            <Trans i18nKey="desktopUi.cancel" />
          </button>
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
            className={`flex min-h-0 flex-1 flex-col ${view.layout === 'split' ? 'md:grid' : ''}`}
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
