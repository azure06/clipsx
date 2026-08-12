import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Database, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ClipDetail,
  ClipPresentation,
  ClipViewDescriptor,
  ClipViewSet,
  RenderModel,
} from '../../shared/types/v2'
import { RenderModelView } from './RenderModelView'
import { TransformBar } from './TransformBar'

type ArtifactUpdate = { clipId: string; sourceId: string }

export type ViewTabControls = {
  views: ClipViewDescriptor[]
  activeId: string
  onTabChange: (id: string) => void
  onShowInspector: () => void
}

const RawInspector = ({ detail, onClose }: { detail: ClipDetail; onClose: () => void }) => (
  <div className="absolute inset-0 z-20 flex flex-col bg-white/95 backdrop-blur-xl dark:bg-slate-950/95">
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-white/10">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Database className="h-4 w-4" />
        Representations
      </div>
      <button
        aria-label="Close inspector"
        className="rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-white/10"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
    <div className="custom-scrollbar flex-1 overflow-auto p-4 text-xs">
      {detail.representations.map(rep => (
        <article
          className="mb-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
          key={rep.id}
        >
          <div className="font-medium">
            {rep.canonicalMimeType ?? rep.nativeType ?? rep.formatKey}
          </div>
          <div className="mt-1 text-gray-500">
            {rep.storageKind} · {rep.byteLength.toLocaleString()} bytes · priority{' '}
            {rep.capturePriority}
          </div>
          {rep.textValue !== null && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{rep.textValue}</pre>
          )}
          {rep.fileReferences.map(file => (
            <div className="mt-1 break-all" key={file}>
              {file}
            </div>
          ))}
        </article>
      ))}
    </div>
  </div>
)

export const V2ViewPanel = ({
  clipId,
  onPresentation,
  onTabControls,
}: {
  clipId: string
  onPresentation?: (presentation: ClipPresentation | null) => void
  onTabControls?: (info: ViewTabControls | null) => void
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

  const view = useMemo(
    () => viewSet?.views.find(item => item.id === active) ?? null,
    [active, viewSet]
  )

  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    void listen<ArtifactUpdate>('clip-artifacts-updated', event => {
      if (event.payload.clipId !== clipId || event.payload.sourceId !== view?.sourceId) return
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
  }, [clipId, view?.sourceId])

  useEffect(() => {
    let alive = true
    if (!view) return
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
  }, [clipId, renderRevision, view, viewSet])

  const presentation = useMemo<ClipPresentation | null>(
    () => (detail && view && model ? { ...detail.clip, activeView: view, model } : null),
    [detail, model, view]
  )
  useEffect(() => onPresentation?.(presentation), [onPresentation, presentation])

  const handleTabChange = useCallback((id: string) => {
    setModel(null)
    setActive(id)
  }, [])

  const handleShowInspector = useCallback(() => setInspecting(true), [])

  // Lift tab controls to parent so it can render them in its unified header row
  useEffect(() => {
    if (!viewSet || !active) {
      onTabControls?.(null)
      return
    }
    const visible = viewSet.views.filter(item => item.placement !== 'advanced')
    onTabControls?.({
      views: visible,
      activeId: active,
      onTabChange: handleTabChange,
      onShowInspector: handleShowInspector,
    })
  }, [viewSet, active, onTabControls, handleTabChange, handleShowInspector])

  // Clear controls when unmounted
  useEffect(() => () => onTabControls?.(null), [onTabControls])

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
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
        <RenderModelView
          presentation={presentation}
          retryingOcr={retryingOcr}
          onRetryOcr={() => void retryOcr()}
        />
      </div>
      <TransformBar
        clipId={clipId}
        sourceId={presentation.activeView.sourceId}
        basePresentation={presentation}
      />
      {inspecting && <RawInspector detail={detail} onClose={() => setInspecting(false)} />}
    </div>
  )
}
