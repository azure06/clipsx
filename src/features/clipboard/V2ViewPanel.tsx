import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Copy, Database, FolderInput, RotateCw, ScanText, Sparkles, X } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ClipDetail,
  ClipPresentation,
  ClipViewDescriptor,
  ClipViewSet,
  OcrPresentation,
  RenderModel,
} from '../../shared/types/v2'
import { RenderModelView } from './RenderModelView'
import {
  splitExtensionActions,
  useTransformState,
  type TransformControls,
} from './useTransformState'
import { ContributionParametersDialog } from './ContributionParametersDialog'
import { TransformActionsDialog } from './TransformActionsDialog'
import { useTheme } from '../../shared/hooks/useTheme'

const OCR_TAB_ID = '__ocr__'
const TRANSFORM_TAB_ID = '__transform__'

type ExtensionCustomViewSession = { token: string; label: string; entryUrl: string }
type ExtensionCustomViewState = {
  token: string
  label: string
  state: 'ready' | 'failed'
  message: string | null
}

export const ExtensionCustomView = ({
  clipId,
  view,
}: {
  clipId: string
  view: ClipViewDescriptor
}) => {
  const container = React.useRef<HTMLDivElement>(null)
  const { appliedTheme } = useTheme()
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [revision, setRevision] = useState(0)
  const scope = `${clipId}:${view.rendererId}:${view.sourceId}:${view.facetId ?? ''}:${appliedTheme}:${locale}:${revision}`
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null)
  const [readyScope, setReadyScope] = useState<string | null>(null)
  const error = failure?.scope === scope ? failure.message : null
  const isReady = readyScope === scope

  useEffect(() => {
    let disposed = false
    let session: ExtensionCustomViewSession | null = null
    let observer: ResizeObserver | null = null
    let unlistenState: (() => void) | null = null
    let pendingState: ExtensionCustomViewState | null = null
    let frame = 0
    let timeout = 0
    let ready = false
    let overlayOpen = false
    const handleOverlayVisibility = (event: Event) => {
      const open = (event as CustomEvent<{ open: boolean }>).detail?.open ?? false
      overlayOpen = open
      if (!session) return
      const next = bounds()
      if (next)
        void invoke('sync_extension_custom_view', {
          label: session.label,
          ...next,
          visible: !open && ready,
        })
    }
    window.addEventListener('clipsx-host-overlay', handleOverlayVisibility)

    const applyState = (state: ExtensionCustomViewState) => {
      if (!session) {
        pendingState = state
        return
      }
      if (state.token !== session.token || state.label !== session.label) return
      window.clearTimeout(timeout)
      if (state.state === 'failed') {
        observer?.disconnect()
        session = null
        setFailure({
          scope,
          message: state.message ?? 'The extension view failed to load.',
        })
      } else {
        ready = true
        setReadyScope(scope)
        if (overlayOpen && session) {
          const next = bounds()
          if (next)
            void invoke('sync_extension_custom_view', {
              label: session.label,
              ...next,
              visible: false,
            })
        }
      }
    }
    const bounds = () => {
      const rect = container.current?.getBoundingClientRect()
      if (!rect || rect.width < 100 || rect.height < 80) return null
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    void listen<ExtensionCustomViewState>('extension-custom-view-state', event => {
      applyState(event.payload)
    }).then(unlisten => {
      if (disposed) {
        unlisten()
        return
      }
      unlistenState = unlisten
      frame = window.requestAnimationFrame(() => {
        const initial = bounds()
        if (!initial) return
        void invoke<ExtensionCustomViewSession>('open_extension_custom_view', {
          rendererId: view.rendererId,
          clipId,
          sourceId: view.sourceId,
          facetId: view.facetId,
          theme: appliedTheme,
          locale,
          surface: 'detail',
          ...initial,
        })
          .then(opened => {
            if (disposed) {
              void invoke('close_extension_custom_view', {
                label: opened.label,
                token: opened.token,
              })
              return
            }
            session = opened
            if (pendingState) {
              applyState(pendingState)
              pendingState = null
            }
            if (!session) return
            observer = new ResizeObserver(() => {
              const next = bounds()
              if (!next || !session) return
              void invoke('sync_extension_custom_view', { label: session.label, ...next })
            })
            if (container.current) observer.observe(container.current)
            if (!ready) {
              timeout = window.setTimeout(() => {
                if (!session) return
                const expired = session
                session = null
                void invoke('close_extension_custom_view', {
                  label: expired.label,
                  token: expired.token,
                })
                setFailure({ scope, message: 'The extension view did not finish loading.' })
              }, 10_000)
            }
          })
          .catch(reason => {
            if (!disposed) {
              setFailure({
                scope,
                message:
                  reason instanceof Error ? reason.message : 'The extension view could not open.',
              })
            }
          })
      })
    })
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      observer?.disconnect()
      unlistenState?.()
      window.removeEventListener('clipsx-host-overlay', handleOverlayVisibility)
      if (session) {
        void invoke('close_extension_custom_view', {
          label: session.label,
          token: session.token,
        })
      }
    }
  }, [appliedTheme, clipId, locale, revision, scope, view.facetId, view.rendererId, view.sourceId])

  return (
    <div
      ref={container}
      className="relative flex h-full w-full items-center justify-center bg-transparent"
    >
      <span className="sr-only">Custom extension view: {view.label}</span>
      {error ? (
        <div className="mx-auto max-w-sm px-6 text-center">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            This extension view could not be displayed.
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{error}</p>
          <button
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/8 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-500/12 dark:text-violet-300"
            onClick={() => setRevision(value => value + 1)}
            type="button"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      ) : !isReady ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500 dark:border-slate-700 dark:border-t-violet-400" />
          Loading {view.label}…
        </div>
      ) : null}
    </div>
  )
}

const OcrPanel = ({
  ocr,
  retrying,
  onRetry,
}: {
  ocr: OcrPresentation
  retrying: boolean
  onRetry: () => void
}) => (
  <div className="custom-scrollbar h-full min-h-0 overflow-auto overscroll-contain p-4 text-sm">
    {(ocr.state === 'pending' || ocr.state === 'running') && (
      <div className="flex items-center gap-2 text-gray-500">
        <ScanText className="h-4 w-4 animate-pulse text-sky-400" />
        {ocr.state === 'pending' ? 'Text recognition is queued…' : 'Text recognition is running…'}
      </div>
    )}
    {ocr.state === 'failed' && (
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs text-red-500">{ocr.message}</span>
        <button
          className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
          disabled={retrying}
          onClick={onRetry}
        >
          <RotateCw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} />
          Retry
        </button>
      </div>
    )}
    {ocr.state === 'ready' &&
      (ocr.text.trim() ? (
        <pre className="whitespace-pre-wrap leading-relaxed text-gray-800 dark:text-gray-200">
          {ocr.text}
        </pre>
      ) : (
        <span className="text-gray-500">No text found in image.</span>
      ))}
  </div>
)

const TransformAction = ({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button
        aria-label={label}
        className="rounded p-1 text-gray-500 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        className="z-100 rounded bg-white/95 px-2 py-1 text-[10px] text-gray-900 shadow dark:bg-slate-900/95 dark:text-white"
        sideOffset={5}
      >
        {label}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
)

const TransformResultTab = ({
  label,
  presentation,
  outputs,
  busy,
  error,
  applyResult,
  onDismiss,
}: {
  label: string
  presentation: ClipPresentation | null
  outputs: Array<{ canonicalMimeType: string | null; byteLength: number }>
  busy: boolean
  error: string | null
  applyResult: (action: 'copy' | 'save') => Promise<void>
  onDismiss: () => void
}) => (
  <Tooltip.Provider delayDuration={300}>
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/60 px-3 py-1.5 dark:border-white/5">
        <Sparkles className="h-3.5 w-3.5 text-violet-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-500">
          {label}
        </span>
        {outputs.map((output, index) => (
          <span
            className="hidden shrink-0 rounded-md border border-violet-200/70 bg-violet-50 px-1.5 py-0.5 font-mono text-[9px] text-violet-700 sm:inline dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-200"
            key={`${output.canonicalMimeType}:${index}`}
          >
            {output.canonicalMimeType ?? 'binary'} · {formatBytes(output.byteLength)}
          </span>
        ))}
        {presentation && (
          <div className="flex items-center gap-0.5">
            <TransformAction label="Copy" onClick={() => void applyResult('copy')}>
              <Copy className="h-3.5 w-3.5" />
            </TransformAction>
            <TransformAction label="Save as new clip" onClick={() => void applyResult('save')}>
              <FolderInput className="h-3.5 w-3.5" />
            </TransformAction>
          </div>
        )}
        <TransformAction label="Dismiss" onClick={onDismiss}>
          <X className="h-3.5 w-3.5 text-gray-400" />
        </TransformAction>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {busy && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-violet-500" />
            Running transform…
          </div>
        )}
        {error && !busy && (
          <div className="flex h-full items-center justify-center p-4 text-sm text-red-500">
            {error}
          </div>
        )}
        {presentation && !busy && <RenderModelView presentation={presentation} />}
      </div>
    </div>
  </Tooltip.Provider>
)

type ArtifactUpdate = { clipId: string; sourceId: string }

export type ViewTabControls = {
  views: ClipViewDescriptor[]
  activeId: string
  onTabChange: (id: string) => void
  onShowInspector: () => void
  preferenceScopes: Array<'facet' | 'capability' | 'mime'>
  onPreferActive: (scope: 'facet' | 'capability' | 'mime') => Promise<void>
}

type RendererPreferences = {
  byMimeType: Record<string, string>
  byFacetId: Record<string, string>
  byCapabilityId: Record<string, string>
}

const STORAGE_KIND_STYLE: Record<string, string> = {
  text: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/25',
  binary_asset: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/25',
  file_list: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/25',
}

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

const RawInspector = ({ detail, onClose }: { detail: ClipDetail; onClose: () => void }) => (
  <div className="absolute inset-0 z-20 flex flex-col bg-white/95 backdrop-blur-xl dark:bg-slate-950/95">
    <div className="flex items-center justify-between border-b border-slate-200/60 px-4 py-2.5 dark:border-white/10">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-gray-500" />
        <span className="text-xs font-semibold">Representations</span>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums dark:bg-white/10">
          {detail.representations.length}
        </span>
      </div>
      <button
        aria-label="Close inspector"
        className="rounded-md p-1.5 text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
    <div className="custom-scrollbar flex-1 overflow-auto p-3 space-y-2">
      {detail.representations.map((rep, index) => {
        const title = rep.canonicalMimeType ?? rep.nativeType ?? rep.formatKey
        const kindStyle =
          STORAGE_KIND_STYLE[rep.storageKind] ?? 'bg-slate-100 text-gray-500 dark:bg-white/10'
        return (
          <article
            className="rounded-xl border border-slate-200/70 bg-white/60 dark:border-white/8 dark:bg-white/4"
            key={rep.id}
          >
            {/* Card header */}
            <div className="flex items-start gap-3 px-3 pt-3 pb-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 break-all">
                    {title}
                  </span>
                  {rep.nativeType && rep.nativeType !== title && (
                    <span className="rounded border border-slate-200/80 bg-slate-100/80 px-1.5 py-0.5 text-[10px] text-gray-500 dark:border-white/10 dark:bg-white/5">
                      {rep.nativeType}
                    </span>
                  )}
                </div>
                <code className="text-[10px] text-gray-400">{rep.formatKey}</code>
              </div>
              <span className="shrink-0 mt-0.5 text-[10px] font-medium tabular-nums text-gray-500">
                #{index + 1}
              </span>
            </div>

            {/* Meta chips */}
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${kindStyle}`}>
                {rep.storageKind.replace('_', ' ')}
              </span>
              <span className="rounded-full bg-slate-100/80 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/8 dark:text-gray-400">
                {formatBytes(rep.byteLength)}
              </span>
              <span className="rounded-full bg-slate-100/80 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/8 dark:text-gray-500">
                priority {rep.capturePriority}
              </span>
              <span className="rounded-full bg-slate-100/80 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/8 dark:text-gray-500">
                {rep.formatFamily}
              </span>
              {rep.sha256 && (
                <code className="rounded-full bg-slate-100/80 px-2 py-0.5 text-[10px] text-gray-400 dark:bg-white/8">
                  {rep.sha256.slice(0, 8)}…
                </code>
              )}
            </div>

            {/* Text preview */}
            {rep.textValue !== null && rep.textValue.trim() && (
              <div className="border-t border-slate-100 dark:border-white/6 px-3 py-2">
                <pre className="custom-scrollbar max-h-32 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {rep.textValue}
                </pre>
              </div>
            )}

            {/* File references */}
            {rep.fileReferences.length > 0 && (
              <div className="border-t border-slate-100 dark:border-white/6 px-3 py-2 space-y-1">
                {rep.fileReferences.map(file => (
                  <div className="break-all text-[10px] font-mono text-gray-500" key={file}>
                    {file}
                  </div>
                ))}
              </div>
            )}
          </article>
        )
      })}
      {detail.formatObservations.length > 0 && (
        <section className="space-y-2 pt-2" aria-label="Clipboard format observations">
          <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Advertised native formats
          </div>
          {detail.formatObservations.map(observation => (
            <article
              className="rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2.5 dark:border-white/8 dark:bg-white/4"
              key={`${observation.ordinal}:${observation.nativeIdentifier}`}
            >
              <div className="flex items-start justify-between gap-2">
                <code className="break-all text-[10px] text-gray-700 dark:text-gray-300">
                  {observation.nativeIdentifier}
                </code>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-white/8 dark:text-gray-300">
                  {observation.decision.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-gray-400">
                {observation.capabilityId && <span>{observation.capabilityId}</span>}
                {observation.byteLength !== null && (
                  <span>{formatBytes(observation.byteLength)}</span>
                )}
                <span>{observation.reason.replaceAll('_', ' ')}</span>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  </div>
)

export const V2ViewPanel = ({
  clipId,
  onPresentation,
  onTabControls,
  onTransformControls,
}: {
  clipId: string
  onPresentation?: (presentation: ClipPresentation | null) => void
  onTabControls?: (info: ViewTabControls | null) => void
  onTransformControls?: (controls: TransformControls | null) => void
}) => {
  const [detail, setDetail] = useState<ClipDetail | null>(null)
  const [viewSet, setViewSet] = useState<ClipViewSet | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [model, setModel] = useState<RenderModel | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [renderRevision, setRenderRevision] = useState(0)
  const [retryingOcr, setRetryingOcr] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      invoke<ClipDetail>('get_clip_detail', { clipId }),
      invoke<ClipViewSet>('get_clip_views', { clipId }),
    ])
      .then(([nextDetail, nextViews]) => {
        if (!alive) return
        setDetail(nextDetail)
        setViewSet(nextViews)
        setActive(nextViews.primaryViewId)
      })
      .catch(value => alive && setError(String(value)))
    return () => {
      alive = false
    }
  }, [clipId, retry])

  const [lastRealView, setLastRealView] = useState<ClipViewDescriptor | null>(null)
  const isSyntheticTab = active === OCR_TAB_ID || active === TRANSFORM_TAB_ID
  const view = useMemo(
    () => (isSyntheticTab ? null : (viewSet?.views.find(item => item.id === active) ?? null)),
    [active, isSyntheticTab, viewSet]
  )
  useEffect(() => {
    if (view) setLastRealView(view)
  }, [view])

  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    void listen<ArtifactUpdate>('clip-artifacts-updated', event => {
      const sourceId = view?.sourceId ?? lastRealView?.sourceId
      if (event.payload.clipId !== clipId || event.payload.sourceId !== sourceId) return
      setModel(null)
      setRenderRevision(value => value + 1)
    }).then(unlisten => {
      if (disposed) unlisten()
      else stop = unlisten
    })
    return () => {
      disposed = true
      stop?.()
    }
  }, [clipId, view?.sourceId, lastRealView?.sourceId])

  useEffect(() => {
    let alive = true
    if (!view || isSyntheticTab) return
    void invoke<RenderModel>('render_clip_view', {
      clipId,
      rendererId: view.rendererId,
      sourceId: view.sourceId,
      facetId: view.facetId,
    })
      .then(next => {
        if (alive) {
          setModel(next)
          setError(null)
        }
      })
      .catch(value => {
        if (!alive) return
        const fallback = viewSet?.views.find(
          candidate =>
            candidate.id !== view.id &&
            candidate.rendererId.startsWith('builtin.') &&
            candidate.placement !== 'advanced'
        )
        if (!view.rendererId.startsWith('builtin.') && fallback) {
          setActive(fallback.id)
          return
        }
        setError(String(value))
      })
    return () => {
      alive = false
    }
  }, [clipId, isSyntheticTab, renderRevision, view, viewSet])

  const effectiveView = view ?? (isSyntheticTab ? lastRealView : null)
  const presentation = useMemo<ClipPresentation | null>(
    () =>
      detail && effectiveView && model
        ? { ...detail.clip, activeView: effectiveView, model }
        : null,
    [detail, effectiveView, model]
  )
  useEffect(() => onPresentation?.(presentation), [onPresentation, presentation])

  const handleTabChange = useCallback(
    (id: string) => {
      if (id !== active && id !== OCR_TAB_ID && id !== TRANSFORM_TAB_ID) setModel(null)
      setActive(id)
    },
    [active]
  )

  const handleShowInspector = useCallback(() => setInspecting(true), [])

  const handlePreferActive = useCallback(
    async (scope: 'facet' | 'capability' | 'mime') => {
      if (!view) return
      const preferences = await invoke<RendererPreferences>('get_renderer_preferences')
      if (scope === 'facet' && view.facetId) {
        preferences.byFacetId[view.facetId] = view.rendererId
      } else if (scope === 'capability') {
        preferences.byCapabilityId[view.capabilityId] = view.rendererId
      } else if (scope === 'mime' && view.mimeType) {
        preferences.byMimeType[view.mimeType] = view.rendererId
      } else {
        return
      }
      await invoke('update_renderer_preferences', { preferences })
    },
    [view]
  )

  const retryOcr = async () => {
    if (!presentation || presentation.model.kind !== 'image') return
    setRetryingOcr(true)
    try {
      await invoke('retry_clip_ocr', {
        clipId,
        sourceId: presentation.activeView.sourceId,
      })
    } catch (value) {
      setError(String(value))
    } finally {
      setRetryingOcr(false)
    }
  }

  const transformState = useTransformState({
    clipId,
    sourceId: view?.sourceId ?? lastRealView?.sourceId ?? '',
    basePresentation: presentation,
    onControls: onTransformControls,
  })

  // Lift tab controls to parent so it can render them in its unified header row
  useEffect(() => {
    if (!viewSet || !active) {
      onTabControls?.(null)
      return
    }
    const visible = viewSet.views.filter(item => item.placement !== 'advanced')
    const ocrTab: ClipViewDescriptor | null =
      model?.kind === 'image' && model.ocr.state !== 'disabled' && model.ocr.state !== 'unsupported'
        ? {
            id: OCR_TAB_ID,
            rendererId: '',
            label: 'Text',
            sourceId: '',
            mimeType: null,
            capabilityId: 'builtin.ocr',
            facetId: null,
            iconSvg: null,
            iconSvgDark: null,
            iconScale: 1,
            isOriginal: false,
            presentationKind: 'text',
            purpose: 'semantic',
            matchSpecificity: 0,
            placement: 'alternate',
          }
        : null
    const transformTab: ClipViewDescriptor | null = transformState.activeTransformer
      ? {
          id: TRANSFORM_TAB_ID,
          rendererId: '',
          label: transformState.activeTransformer.label,
          sourceId: '',
          mimeType: null,
          capabilityId: 'builtin.transform',
          facetId: null,
          iconSvg: null,
          iconSvgDark: null,
          iconScale: 1,
          isOriginal: false,
          presentationKind: 'text',
          purpose: 'structured',
          matchSpecificity: 0,
          placement: 'alternate',
        }
      : null
    const views = [...visible, ...(ocrTab ? [ocrTab] : []), ...(transformTab ? [transformTab] : [])]
    onTabControls?.({
      views,
      activeId: active,
      onTabChange: handleTabChange,
      onShowInspector: handleShowInspector,
      preferenceScopes: view
        ? [
            ...(view.facetId ? (['facet'] as const) : []),
            'capability' as const,
            ...(view.mimeType ? (['mime'] as const) : []),
          ]
        : [],
      onPreferActive: handlePreferActive,
    })
  }, [
    viewSet,
    active,
    model,
    transformState.activeTransformer,
    onTabControls,
    handleTabChange,
    handleShowInspector,
    handlePreferActive,
    view,
  ])

  // Clear controls when unmounted
  useEffect(() => () => onTabControls?.(null), [onTabControls])

  // Auto-switch to transform tab as soon as a transform is initiated
  useEffect(() => {
    if (transformState.activeTransformer) setActive(TRANSFORM_TAB_ID)
  }, [transformState.activeTransformer])

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-sm text-red-600 dark:text-red-400">
        <span>{error}</span>
        <button
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          onClick={() => {
            setError(null)
            setDetail(null)
            setViewSet(null)
            setModel(null)
            setRetry(value => value + 1)
          }}
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    )
  if (!detail || !viewSet || !presentation)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
        Loading preview...
      </div>
    )

  const isOcrTab = active === OCR_TAB_ID
  const isTransformTab = active === TRANSFORM_TAB_ID
  const transformPresentation: ClipPresentation | null =
    transformState.preview && presentation
      ? { ...presentation, model: transformState.preview.model }
      : null

  const handleDismissTransform = () => {
    transformState.dismissPreview()
    transformState.dismissError()
    // Return to the previous real tab
    const fallback = viewSet?.views.find(v => v.id !== OCR_TAB_ID) ?? null
    if (fallback) setActive(fallback.id)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        {isTransformTab ? (
          <TransformResultTab
            label={transformState.activeTransformer?.label ?? 'Transform'}
            presentation={transformPresentation}
            outputs={transformState.preview?.outputs ?? []}
            busy={!!transformState.busy}
            error={transformState.error}
            applyResult={transformState.applyResult}
            onDismiss={handleDismissTransform}
          />
        ) : isOcrTab && presentation?.model.kind === 'image' ? (
          <OcrPanel
            ocr={presentation.model.ocr}
            retrying={retryingOcr}
            onRetry={() => void retryOcr()}
          />
        ) : view?.presentationKind === 'extension_ui' ? (
          <ExtensionCustomView clipId={clipId} view={view} />
        ) : (
          <RenderModelView presentation={presentation} />
        )}
      </div>
      {inspecting && <RawInspector detail={detail} onClose={() => setInspecting(false)} />}
      {transformState.pickerOpen && (
        <TransformActionsDialog
          items={transformState.items}
          actions={splitExtensionActions(transformState.actions).menuActions}
          run={id => void transformState.run(id)}
          runAction={id => void transformState.runAction(id)}
          pinAction={(id, pinned) => void transformState.pinAction(id, pinned)}
          onClose={transformState.closePicker}
        />
      )}
      {transformState.parameterRequest && (
        <ContributionParametersDialog
          request={transformState.parameterRequest}
          onCancel={transformState.cancelParameterRequest}
          onSubmit={transformState.submitParameters}
        />
      )}
    </div>
  )
}
