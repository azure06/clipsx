import { invoke } from '@tauri-apps/api/core'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Check, ChevronDown, ClipboardPaste, Copy, Database, GripVertical, Pin, Play, RotateCcw, Search, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { copyClipboardOutput, pasteClipboardOutput } from '../../shared/clipboardOutput'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { useTheme } from '../../shared/hooks/useTheme'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../../shared/components/ui'
import { parameterProperties } from './contributionParameters'
import { RenderModelView } from './RenderModelView'
import { ExtensionOperationIcon, type PinnedOperation } from './ExtensionOperationIcon'
import type { ExtensionJob } from './useClipExtensionJobs'
import type { ContextAction, Transformer } from './useTransformState'

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

const fieldValue = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''

function ParameterField({ name, schema, value, onChange }: {
  name: string
  schema: Record<string, unknown>
  value: unknown
  onChange: (value: unknown) => void
}) {
  const label = typeof schema['title'] === 'string' ? schema['title'] : name.replaceAll('_', ' ')
  const options = schema['enum']
  return <label className="grid gap-1 text-xs">
    <span className="font-semibold">{label}</span>
    {Array.isArray(options) ? <select value={fieldValue(value)} onChange={event => onChange(event.target.value)} className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 dark:border-white/10">
      <option value="">Choose…</option>
      {options.map(option => <option key={fieldValue(option)} value={fieldValue(option)}>{fieldValue(option)}</option>)}
    </select> : schema['type'] === 'boolean' ? <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} className="h-4 w-4" />
      : schema['type'] === 'number' || schema['type'] === 'integer' ? <input type="number" step={schema['type'] === 'integer' ? 1 : 'any'} min={typeof schema['minimum'] === 'number' ? schema['minimum'] : undefined} max={typeof schema['maximum'] === 'number' ? schema['maximum'] : undefined} value={fieldValue(value)} onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))} className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 dark:border-white/10" />
        : <textarea value={fieldValue(value)} maxLength={typeof schema['maxLength'] === 'number' ? schema['maxLength'] : undefined} onChange={event => onChange(event.target.value)} className="min-h-12 rounded-lg border border-slate-200 bg-transparent px-3 py-2 dark:border-white/10" />}
  </label>
}

function ResultSplitDivider({ ratio, onChange, containerRef }: {
  ratio: number
  onChange: (ratio: number) => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const pointer = useRef<number | null>(null)
  const move = (clientX: number) => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 8) return
    const next = ((clientX - bounds.left - 4) / (bounds.width - 8)) * 100
    onChange(Math.min(75, Math.max(25, next)))
  }
  return <div
    role="separator"
    aria-label="Resize original and result"
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
    onPointerMove={event => { if (pointer.current === event.pointerId) move(event.clientX) }}
    onPointerUp={event => {
      if (pointer.current !== event.pointerId) return
      pointer.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { pointer.current = null }}
    onLostPointerCapture={() => { pointer.current = null }}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      onChange(Math.min(75, Math.max(25, ratio + (event.key === 'ArrowRight' ? 5 : -5))))
    }}
    className="group hidden w-2 cursor-col-resize touch-none select-none items-center justify-center bg-slate-200/70 text-slate-500 outline-none hover:bg-violet-400/30 focus:bg-violet-400/40 md:flex dark:bg-white/10"
  ><GripVertical className="h-4 w-4 opacity-0 group-hover:opacity-100 group-focus:opacity-100" /></div>
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
  const { appliedTheme } = useTheme()
  const [ordinal, setOrdinal] = useState(0)
  const [raw, setRaw] = useState(false)
  const presentations = job.resultPresentations?.length ? job.resultPresentations : [
    { id: 'result', displayName: 'Result', layout: 'single' as const, modules: ['output' as const] },
    { id: 'compare', displayName: 'Compare', layout: 'split' as const, modules: ['input' as const, 'output' as const] },
  ]
  const initialView = () => presentations.find(view => view.id === job.defaultView || (job.defaultView === 'result_only' && view.layout === 'single') || (job.defaultView === 'compare' && view.modules.includes('input')))?.id ?? presentations[0]!.id
  const [viewId, setViewId] = useState(initialView)
  const view = presentations.find(item => item.id === viewId) ?? presentations[0]!
  const needsInput = view.modules.includes('input')
  const [ratio, setRatio] = useState(() => {
    const stored = Number(localStorage.getItem('clipsx.transformCompareRatio'))
    return Number.isFinite(stored) && stored >= 25 && stored <= 75 ? stored : 50
  })
  const [output, setOutput] = useState<RenderModel | null>(null)
  const [source, setSource] = useState<RenderModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const selectedOutput = job.outputs.find(item => item.ordinal === ordinal) ?? job.outputs[0]
  const selectedOrdinal = selectedOutput?.ordinal
  useEffect(() => { localStorage.setItem('clipsx.transformCompareRatio', String(ratio)) }, [ratio])

  useEffect(() => {
    if (job.status !== 'completed' || selectedOrdinal === undefined) return
    let alive = true
    setOutput(null)
    void invoke<RenderModel>('render_extension_result_output', {
      jobId: job.jobId,
      ordinal: selectedOrdinal,
      raw,
    }).then(value => {
      if (alive) setOutput(value)
    }).catch(reason => {
      if (alive) setError(String(reason))
    })
    return () => { alive = false }
  }, [job.jobId, job.status, selectedOrdinal, raw])
  useEffect(() => {
    if (job.status !== 'completed' || !needsInput) return
    let alive = true
    void invoke<RenderModel>('render_extension_result_source', { jobId: job.jobId })
      .then(value => { if (alive) setSource(value) })
      .catch(reason => { if (alive) setError(String(reason)) })
    return () => { alive = false }
  }, [job.jobId, job.status, needsInput])

  const outputPresentation = useMemo(() => output && presentation ? {
    ...presentation,
    activeView: {
      ...presentation.activeView,
      presentationKind: selectedOutput?.mimeType === 'application/json' && !raw ? 'json' : presentation.activeView.presentationKind,
    },
    model: output,
  } : null, [output, presentation, raw, selectedOutput?.mimeType])
  const sourcePresentation = useMemo(() => source && presentation ? { ...presentation, model: source } : null, [presentation, source])
  const operation = async (task: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try { await task(); onChanged() } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const regenerate = async () => {
    const invocation = await invoke<{ token: string }>('issue_extension_transformer_invocation', {
      transformerId: job.transformerId, clipId: job.clipId, sourceId: job.sourceId,
    })
    const result = await invoke<{ jobId: string }>('regenerate_extension_result', {
      jobId: job.jobId, requestId: crypto.randomUUID(), invocationToken: invocation.token,
    })
    onQueued(result.jobId)
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white/35 dark:bg-transparent" aria-label={`${job.displayLabel} result`}>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200/70 bg-white/55 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/[.025]">
        {job.status !== 'completed' && <span className="mr-auto shrink-0 px-1 text-[11px] font-medium capitalize text-slate-500">{job.status.replaceAll('_', ' ')}{job.reasonCode ? ` · ${job.reasonCode.replaceAll('_', ' ')}` : ''}</span>}
        {job.status === 'completed' && <>
          {job.outputs.length > 0 && <div role="tablist" aria-label="Result outputs" className="flex shrink-0 items-center gap-0.5">
            {job.outputs.map(item => <button role="tab" aria-selected={selectedOutput?.ordinal === item.ordinal && !raw} type="button" key={item.ordinal} onClick={() => { setOrdinal(item.ordinal); setRaw(false) }} className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${selectedOutput?.ordinal === item.ordinal && !raw ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-500/10'}`}>{viewLabel(item.mimeType)}{job.outputs.length > 1 ? ` ${item.ordinal + 1}` : ''}</button>)}
            {selectedOutput?.hasRenderedView && <button role="tab" aria-selected={raw} type="button" onClick={() => setRaw(true)} className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${raw ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-500/10'}`}>Raw</button>}
          </div>}
          {presentations.length > 1 && <div className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-slate-200 pl-2 dark:border-white/10">{presentations.map(item => <button key={item.id} type="button" onClick={() => setViewId(item.id)} aria-pressed={view.id === item.id} className={`rounded-md px-2 py-1 text-[11px] font-medium ${view.id === item.id ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-500/10'}`}>{item.displayName}</button>)}</div>}
          <div className="min-w-2 flex-1" />
          {job.resultControls.includes('copy') && <button type="button" title="Copy result" aria-label="Copy result" disabled={busy} onClick={() => void operation(() => copyClipboardOutput({ kind: 'derived', jobId: job.jobId }))} className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"><Copy className="h-4 w-4" /></button>}
          {job.resultControls.includes('paste') && <button type="button" title="Paste result" aria-label="Paste result" disabled={busy} onClick={() => void operation(() => pasteClipboardOutput({ kind: 'derived', jobId: job.jobId }))} className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"><ClipboardPaste className="h-4 w-4" /></button>}
          {job.resultControls.includes('save_as_clip') && <button type="button" title="Save as new clip" aria-label="Save as new clip" disabled={busy} onClick={() => void operation(() => invoke('promote_extension_result', { jobId: job.jobId, requestId: crypto.randomUUID() }))} className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"><Database className="h-4 w-4" /></button>}
          {job.resultControls.includes('regenerate') && <button type="button" title={canRegenerate ? 'Regenerate result' : 'Install this transformer to regenerate'} aria-label="Regenerate result" disabled={busy || !canRegenerate} onClick={() => void operation(regenerate)} className="rounded-lg p-2 text-slate-500 hover:bg-violet-500/10 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"><RotateCcw className="h-4 w-4" /></button>}
        </>}
        {job.status === 'failed' && <button type="button" disabled={busy || !canRegenerate} onClick={() => void operation(regenerate)}>Retry</button>}
        {['pending', 'running', 'waiting_provider'].includes(job.status) && <button type="button" disabled={busy} onClick={() => void operation(() => invoke('cancel_extension_job', { jobId: job.jobId }))}>Cancel</button>}
      </div>
      {job.status === 'completed' ? <>
        <div ref={splitRef} data-testid="extension-result-split" className={`flex min-h-0 flex-1 flex-col ${view.layout === 'split' ? 'md:grid' : ''}`} style={view.layout === 'split' ? { gridTemplateColumns: `minmax(0, ${ratio}fr) 8px minmax(0, ${100 - ratio}fr)` } : undefined}>
          {view.modules.map((module, index) => <div key={`${view.id}:${index}`} className="contents">
            {index > 0 && view.layout === 'split' && <ResultSplitDivider ratio={ratio} onChange={setRatio} containerRef={splitRef} />}
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden border-b border-slate-200/60 dark:border-white/10">
              {view.modules.length > 1 && <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white">{module === 'input' ? 'Original' : 'Result'}</span>}
              {(module === 'input' ? sourcePresentation : outputPresentation) && <RenderModelView appliedTheme={appliedTheme} presentation={(module === 'input' ? sourcePresentation : outputPresentation)!} />}
            </div>
          </div>)}
        </div>
      </> : <div className="flex flex-1 flex-col items-center justify-center p-6 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300"><ChevronDown className={`h-5 w-5 ${['pending', 'running', 'waiting_provider'].includes(job.status) ? 'animate-pulse' : ''}`} /></span><p className="text-sm font-semibold capitalize text-slate-700 dark:text-slate-200">{job.status.replaceAll('_', ' ')}</p>{job.reasonCode && <p className="mt-1 max-w-xs text-xs text-slate-500">{job.reasonCode.replaceAll('_', ' ')}</p>}</div>}
      {error && <p role="alert" className="px-4 py-2 text-xs text-red-600">{error}</p>}
    </section>
  )
}

type ToolSelection = { transformer: Transformer; fixed: Record<string, unknown>; label: string; setup?: SavedTransformSetup }

type ToolOperation = PinnedOperation & {
  subtitle: string
  available: boolean
  reason: string | null
  selection?: ToolSelection
  actionId?: string
}

export function ExtensionTools({
  clipId, sourceId, transformers, actions, runAction, onClose, onQueued,
  pinnedIds, onTogglePin, initialOperationId,
}: {
  clipId: string
  sourceId: string
  transformers: Transformer[]
  actions: ContextAction[]
  runAction: (id: string) => void
  onClose: () => void
  onQueued: (jobId: string) => void
  pinnedIds?: string[]
  onTogglePin?: (operation: PinnedOperation) => void
  initialOperationId?: string | null
}) {
  const setActiveView = useUIStore(state => state.setActiveView)
  const [setups, setSetups] = useState<SavedTransformSetup[]>([])
  const [selection, setSelection] = useState<ToolSelection | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [setupName, setSetupName] = useState('')
  const [defaultView, setDefaultView] = useState<'result_only' | 'compare'>('result_only')
  const [busy, setBusy] = useState(false)
  const [grantedPackages, setGrantedPackages] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const handledInitialOperation = useRef<string | null>(null)
  const refreshSetups = useCallback(() => void invoke<SavedTransformSetup[]>('list_extension_transform_setups').then(setSetups).catch(reason => setError(String(reason))), [])
  useEffect(refreshSetups, [refreshSetups])
  const choose = (next: ToolSelection) => {
    setSelection(next)
    setValues(next.setup?.parameters ?? next.fixed)
    setSetupName(next.setup?.label ?? '')
    setDefaultView(next.setup?.defaultView ?? next.transformer.setups.find(setup => setup.displayName === next.label)?.defaultView ?? next.transformer.defaultView ?? 'result_only')
    setError(null)
  }
  const run = async () => {
    if (!selection) return
    setBusy(true)
    setError(null)
    try {
      const transformer = selection.transformer
      if (transformer.consentRequired && !grantedPackages.has(transformer.packageId ?? transformer.id)) {
        const approved = window.confirm(`${transformer.label} will use its declared provider or network capability with this clip. Allow this package release?`)
        if (!approved) return
        await invoke('grant_extension_transformer_permissions', { transformerId: transformer.id })
        setGrantedPackages(current => new Set(current).add(transformer.packageId ?? transformer.id))
        window.dispatchEvent(new Event('clipsx-extension-permissions-changed'))
      }
      const invocation = transformer.execution === 'capability_backed'
        ? await invoke<{ token: string }>('issue_extension_transformer_invocation', { transformerId: transformer.id, clipId, sourceId })
        : null
      const result = await invoke<{ jobId: string }>('enqueue_extension_transform', { request: {
        clipId, sourceId, transformerId: transformer.id, parameters: values,
        setupId: selection.setup?.id ?? null, defaultView, requestId: crypto.randomUUID(),
        invocationToken: invocation?.token ?? null,
      } })
      onQueued(result.jobId)
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (!selection) return
    setBusy(true)
    setError(null)
    try {
      const saved = await invoke<SavedTransformSetup>('save_extension_transform_setup', {
        id: selection.setup?.id ?? null,
        expectedRevision: selection.setup?.revision ?? null,
        transformerId: selection.transformer.id,
        label: setupName,
        parameters: values,
        defaultView,
      })
      choose({ ...selection, setup: saved, label: saved.label })
      refreshSetups()
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const fields = useMemo(() => selection ? parameterProperties(selection.transformer.parameterSchema ?? {}) : {}, [selection])
  const operations = useMemo<ToolOperation[]>(() => [
    ...transformers.flatMap(transformer => [
      ...transformer.setups.map(setup => ({
        id: `setup:${transformer.id}:${setup.id}`, label: setup.displayName, kind: 'transformer' as const,
        packageId: transformer.packageId,
        subtitle: transformer.label, icon: transformer.icon ?? null, iconSvg: transformer.iconSvg ?? null, iconSvgDark: transformer.iconSvgDark ?? null, iconScale: transformer.iconScale ?? 1,
        available: transformer.providerAvailable, reason: transformer.providerAvailable ? null : 'Configure Local Text Generation',
        selection: { transformer, fixed: setup.parameters, label: setup.displayName },
      })),
      ...setups.filter(saved => saved.transformerId === transformer.id).map(saved => ({
        id: `saved:${saved.id}`, label: saved.label, kind: 'transformer' as const,
        packageId: transformer.packageId,
        subtitle: `${transformer.label} · Saved setup`, icon: transformer.icon ?? null, iconSvg: transformer.iconSvg ?? null, iconSvgDark: transformer.iconSvgDark ?? null, iconScale: transformer.iconScale ?? 1,
        available: saved.available && transformer.providerAvailable,
        reason: !saved.available ? 'This setup is incompatible with the installed version' : transformer.providerAvailable ? null : 'Configure Local Text Generation',
        selection: { transformer, fixed: {}, label: saved.label, setup: saved },
      })),
      { id: `custom:${transformer.id}`, label: `Custom ${transformer.label}`, kind: 'transformer' as const,
        packageId: transformer.packageId,
        subtitle: transformer.label, icon: transformer.icon ?? null, iconSvg: transformer.iconSvg ?? null, iconSvgDark: transformer.iconSvgDark ?? null, iconScale: transformer.iconScale ?? 1,
        available: transformer.providerAvailable, reason: transformer.providerAvailable ? null : 'Configure Local Text Generation',
        selection: { transformer, fixed: {}, label: transformer.label } },
    ]),
    ...actions.map(action => ({
      id: `action:${action.id}`, label: action.label, kind: 'action' as const,
      packageId: action.packageId,
      subtitle: action.packageId.split('.').at(-1)?.replaceAll('-', ' ') ?? 'Extension action',
      icon: action.icon, iconSvg: action.iconSvg, iconSvgDark: action.iconSvgDark, iconScale: action.iconScale,
      available: action.available, reason: action.unavailableReason, actionId: action.id,
    })),
  ], [actions, setups, transformers])
  const shown = operations.filter(operation => `${operation.label} ${operation.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => {
    if (!initialOperationId || handledInitialOperation.current === initialOperationId || selection) return
    const operation = operations.find(item => item.id === initialOperationId)
    if (operation?.selection) {
      handledInitialOperation.current = initialOperationId
      choose(operation.selection)
    }
  }, [initialOperationId, operations, selection])
  const selectOperation = (operation: ToolOperation) => {
    if (!operation.available) return
    if (operation.selection) choose(operation.selection)
    else if (operation.actionId) runAction(operation.actionId)
  }
  return <section className="flex h-full min-h-0 flex-col" aria-label="Clip tools">
    <header className="flex shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/65 px-3 py-2.5 dark:border-white/10 dark:bg-white/[.035]">
      {selection && <button type="button" aria-label="Back to tools" onClick={() => setSelection(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><ArrowLeft className="h-4 w-4" /></button>}
      {!selection && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 ring-1 ring-inset ring-violet-500/15 dark:text-violet-300"><Sparkles className="h-5 w-5" /></span>}
      <div className="min-w-0 flex-1">
        <Dialog.Title className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">{selection?.label ?? 'Tools for this clip'}</Dialog.Title>
        <Dialog.Description id="clip-tools-description" className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{selection ? `Configure ${selection.transformer.label} before running it` : 'Choose an action or create a result from this clip'}</Dialog.Description>
      </div>
      <Dialog.Close aria-label="Close tools" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-500/10 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:hover:text-slate-200"><X className="h-4 w-4" /></Dialog.Close>
    </header>
    {!selection ? <>
      <div className="border-b border-slate-200/70 px-3 py-2 dark:border-white/10">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 text-slate-400 shadow-sm focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/10 dark:border-white/10 dark:bg-white/5"><Search className="h-4 w-4" /><input autoFocus aria-label="Search tools" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an action or transformation" className="h-8 w-full bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100" /></label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {shown.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-center"><Search className="mb-3 h-5 w-5 text-slate-400" /><p className="text-sm font-medium text-slate-700 dark:text-slate-200">No tools match</p><p className="mt-1 text-xs text-slate-500">Try another name or select a different clip.</p></div> : <div className="space-y-4">{(['transformer', 'action'] as const).map(kind => {
          const group = shown.filter(operation => operation.kind === kind)
          if (!group.length) return null
          return <section key={kind} aria-label={kind === 'transformer' ? 'Transformations' : 'Actions'}><div className="mb-1.5 flex items-center justify-between"><h3 className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">{kind === 'transformer' ? 'Create a result' : 'Actions'}</h3><span className="text-[10px] tabular-nums text-slate-400">{group.length}</span></div><div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-1.5">{group.map(operation => <div key={operation.id} className="group relative min-w-0 rounded-xl border border-slate-200/80 bg-white/75 shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50/40 dark:border-white/10 dark:bg-white/[.035] dark:hover:border-violet-400/40 dark:hover:bg-violet-400/[.06]"><button type="button" disabled={!operation.available || busy} title={operation.reason ?? operation.label} onClick={() => selectOperation(operation)} className="flex min-h-16 w-full items-center gap-2.5 rounded-xl p-2.5 pr-8 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-55"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/10 to-violet-500/15 text-violet-600 dark:text-violet-300"><ExtensionOperationIcon operation={operation} /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{operation.label}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{operation.reason ?? operation.subtitle}</span></span></button>{onTogglePin && <button type="button" aria-label={`${pinnedIds?.includes(operation.id) ? 'Unpin' : 'Pin'} ${operation.label}`} aria-pressed={pinnedIds?.includes(operation.id) ?? false} onClick={() => onTogglePin(operation)} className={`absolute right-2 top-2 rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${pinnedIds?.includes(operation.id) ? 'text-amber-500' : 'text-slate-400 hover:bg-slate-500/10 hover:text-violet-600'}`}><Pin className={`h-3.5 w-3.5 ${pinnedIds?.includes(operation.id) ? 'fill-current' : ''}`} /></button>}</div>)}</div></section>
        })}</div>}
      </div>
    </> : <>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {selection.transformer.providerAvailable === false && <div role="alert" className="mb-4 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">A local generation model is needed. <button type="button" className="font-semibold underline" onClick={() => { setActiveView('intelligence'); onClose() }}>Configure Local Text Generation</button></div>}
        {selection.transformer.consentRequired && !grantedPackages.has(selection.transformer.packageId ?? selection.transformer.id) && <p className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200">This package release needs your permission before receiving the selected content.</p>}
        <div className="grid max-w-xl gap-4">{Object.entries(fields).filter(([key]) => !(key in selection.fixed)).map(([key, field]) => <ParameterField key={key} name={key} schema={field} value={values[key]} onChange={value => setValues(current => ({ ...current, [key]: value }))} />)}</div>
        <div className="mt-4 max-w-xl"><label htmlFor="saved-setup-name" className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">Save these choices for later</label><div className="flex gap-2"><input id="saved-setup-name" aria-label="Saved setup name" placeholder="Setup name" value={setupName} maxLength={80} onChange={event => setSetupName(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white/75 px-3 py-2 text-xs outline-none focus:border-violet-400 dark:border-white/10 dark:bg-white/5" /><Button variant="outline" size="sm" disabled={busy || !setupName.trim()} onClick={() => void save()}>Save setup</Button>{selection.setup && <button type="button" aria-label="Delete saved setup" onClick={() => void invoke('delete_extension_transform_setup', { id: selection.setup?.id }).then(() => { setSelection(null); refreshSetups() })} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-red-600 dark:border-white/10"><Trash2 className="h-4 w-4" /></button>}</div></div>
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-slate-200/70 bg-white/55 px-3 py-2 dark:border-white/10 dark:bg-white/[.025]"><span className="flex items-center gap-1.5 text-[11px] text-slate-500"><Check className="h-3.5 w-3.5 text-emerald-500" />Original clip stays unchanged</span><Button size="sm" disabled={busy || selection.transformer.providerAvailable === false} isLoading={busy} leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => void run()}>Run</Button></footer>
    </>}
    {error && <p role="alert" className="border-t border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
  </section>
}
