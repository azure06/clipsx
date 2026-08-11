import { invoke } from '@tauri-apps/api/core'
import { Database, FileQuestion, RotateCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ContentPreview, type Content, type ContentType } from '../content'
import type {
  ClipDetail,
  ClipPresentation,
  ClipViewDescriptor,
  ClipViewSet,
  RenderModel,
} from '../../shared/types/v2'
import { TransformMenu } from './TransformMenu'

const assetUrl = (id: string) => `clipsx-asset://localhost/${id}`

const contentType = (view: ClipViewDescriptor, model: RenderModel): ContentType => {
  if (model.kind === 'tree') return 'json'
  if (model.kind === 'table') return 'csv'
  if (model.kind === 'markdown') return 'markdown'
  if (model.kind === 'code') return 'code'
  const kind = view.presentationKind === 'number' ? 'text' : view.presentationKind
  return (
    [
      'url',
      'email',
      'color',
      'code',
      'math',
      'phone',
      'date',
      'timestamp',
      'path',
      'jwt',
      'secret',
      'image',
      'files',
      'office',
      'text',
    ] as string[]
  ).includes(kind)
    ? (kind as ContentType)
    : 'text'
}

const modelText = (model: RenderModel): string => {
  switch (model.kind) {
    case 'text':
    case 'code':
      return model.text
    case 'markdown':
      return model.markdown
    case 'tree':
      return JSON.stringify(model.value, null, 2)
    case 'table':
      return [model.columns, ...model.rows].map(row => row.join('\t')).join('\n')
    case 'semantic':
      return model.text
    case 'rich_text':
      return model.plainText
    case 'office':
      return model.nativeType ?? model.formatKey
    case 'files':
      return model.files.join('\n')
    default:
      return ''
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export const presentationToContent = (presentation: ClipPresentation): Content => {
  const { activeView: view, model } = presentation
  const payload = model.kind === 'semantic' ? model.payload : {}
  const kind = contentType(view, model)
  const files =
    model.kind === 'files'
      ? model.files.map(path => ({
          path,
          name: path.split(/[\\/]/).pop() ?? path,
          size: 0,
          created: 0,
          modified: 0,
        }))
      : undefined
  return {
    type: kind,
    text: modelText(model),
    metadata: {
      ...payload,
      files,
      language:
        model.kind === 'code'
          ? (model.language ?? undefined)
          : typeof payload['language'] === 'string'
            ? payload['language']
            : undefined,
      url: typeof payload['href'] === 'string' ? payload['href'] : undefined,
      domain:
        typeof payload['host'] === 'string'
          ? payload['host']
          : typeof payload['domain'] === 'string'
            ? payload['domain']
            : undefined,
      email: typeof payload['address'] === 'string' ? payload['address'] : undefined,
      hex: typeof payload['hex'] === 'string' ? payload['hex'] : undefined,
      value:
        payload['value'] == null
          ? undefined
          : typeof payload['value'] === 'object'
            ? JSON.stringify(payload['value'])
            : String(payload['value'] as string | number | boolean),
      unit:
        typeof payload['interpretation'] === 'string' &&
        payload['interpretation'].includes('milliseconds')
          ? 'milliseconds'
          : undefined,
      format: typeof payload['interpretation'] === 'string' ? payload['interpretation'] : undefined,
      source_app: presentation.sourceAppName ?? undefined,
    },
    clip: {
      id: presentation.id,
      isFavorite: presentation.isFavorite,
      isPinned: presentation.isPinned,
      imagePath: model.kind === 'image' ? assetUrl(model.artifactId) : null,
      contentHtml: model.kind === 'html' ? model.sanitizedHtml : null,
      ocrStatus: 'not_needed',
      appName: presentation.sourceAppName,
    },
  }
}

const RenderedView = ({ presentation }: { presentation: ClipPresentation }) => {
  const { model } = presentation
  if (model.kind === 'html') {
    return (
      <iframe
        className="h-full min-h-56 w-full bg-white"
        sandbox=""
        srcDoc={model.sanitizedHtml}
        title="HTML preview"
      />
    )
  }
  if (model.kind === 'rich_text') {
    return model.sanitizedHtml ? (
      <iframe
        className="h-full min-h-56 w-full bg-white"
        sandbox=""
        srcDoc={model.sanitizedHtml}
        title="Rich text preview"
      />
    ) : (
      <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-sm">{model.plainText}</pre>
    )
  }
  if (model.kind === 'document') {
    return (
      <object
        className="h-full w-full bg-white"
        data={assetUrl(model.artifactId)}
        type={model.mimeType}
      >
        <p className="p-4 text-sm">Document preview unavailable.</p>
      </object>
    )
  }
  if (model.kind === 'unsupported') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <FileQuestion className="h-9 w-9 text-gray-400" />
        <div className="text-sm font-medium">Unsupported preview</div>
        <div className="max-w-md text-xs text-gray-500">
          {model.mimeType ?? model.nativeType ?? model.formatKey} ·{' '}
          {model.byteLength.toLocaleString()} bytes
        </div>
        <p className="text-xs text-gray-400">
          The original captured representation remains available for copy and paste.
        </p>
      </div>
    )
  }
  return <ContentPreview content={presentationToContent(presentation)} />
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
}: {
  clipId: string
  onPresentation?: (presentation: ClipPresentation | null) => void
}) => {
  const [detail, setDetail] = useState<ClipDetail | null>(null)
  const [viewSet, setViewSet] = useState<ClipViewSet | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [model, setModel] = useState<RenderModel | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

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
  }, [clipId, view, viewSet])

  const presentation = useMemo<ClipPresentation | null>(
    () => (detail && view && model ? { ...detail.clip, activeView: view, model } : null),
    [detail, model, view]
  )
  useEffect(() => onPresentation?.(presentation), [onPresentation, presentation])
  const visibleViews = viewSet?.views.filter(item => item.placement !== 'advanced') ?? []

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
      <div className="flex shrink-0 items-center border-b border-slate-200 px-3 py-2 dark:border-white/10">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {visibleViews.length > 1 &&
            visibleViews.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setModel(null)
                  setActive(item.id)
                }}
                className={`rounded-md px-2 py-1 text-xs ${active === item.id ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10'}`}
              >
                {item.label}
              </button>
            ))}
        </div>
        <TransformMenu clipId={clipId} sourceId={presentation.activeView.sourceId} />
        <button
          aria-label="Open representation inspector"
          title="Representations"
          className="ml-2 rounded-md p-1.5 text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10"
          onClick={() => setInspecting(true)}
        >
          <Database className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
        <RenderedView presentation={presentation} />
      </div>
      {inspecting && <RawInspector detail={detail} onClose={() => setInspecting(false)} />}
    </div>
  )
}
