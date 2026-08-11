import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState } from 'react'
import type {
  ClipDetail,
  ClipViewDescriptor,
  ClipViewSet,
  RenderModel,
} from '../../shared/types/v2'

const assetUrl = (id: string) => `clipsx-artifact://localhost/${id}`

const RenderedView = ({ model }: { model: RenderModel }) => {
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
  if (model.kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <img
          className="max-h-full max-w-full object-contain"
          src={assetUrl(model.artifactId)}
          alt="Clipboard image"
        />
      </div>
    )
  }
  if (model.kind === 'table') {
    return (
      <div className="h-full overflow-auto p-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {model.columns.map(column => (
                <th
                  key={column}
                  className="border border-slate-200 p-2 text-left dark:border-slate-700"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="border border-slate-200 p-2 align-top dark:border-slate-700"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (model.kind === 'tree')
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-xs">
        {JSON.stringify(model.value, null, 2)}
      </pre>
    )
  if (model.kind === 'key_value')
    return (
      <dl className="h-full overflow-auto space-y-2 p-4 text-sm">
        {model.entries.map(([key, value]) => (
          <div key={key}>
            <dt className="inline font-semibold">{key}: </dt>
            <dd className="inline">{value}</dd>
          </div>
        ))}
      </dl>
    )
  const text =
    model.kind === 'markdown'
      ? model.markdown
      : model.kind === 'code' || model.kind === 'text'
        ? model.text
        : model.message
  return (
    <pre
      className={`h-full overflow-auto whitespace-pre-wrap p-4 text-sm ${model.kind === 'code' ? 'font-mono text-xs' : ''}`}
    >
      {text}
    </pre>
  )
}

const RawInspector = ({ detail }: { detail: ClipDetail }) => (
  <div className="h-full overflow-auto p-4 text-xs">
    {detail.representations.map(rep => (
      <article
        className="mb-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        key={rep.id}
      >
        <div className="font-medium">{rep.formatKey}</div>
        <div className="mt-1 text-gray-500">
          {rep.storageKind} · {rep.byteLength} bytes{rep.nativeType ? ` · ${rep.nativeType}` : ''}
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
)

export const V2ViewPanel = ({ clipId }: { clipId: string }) => {
  const [detail, setDetail] = useState<ClipDetail | null>(null)
  const [viewSet, setViewSet] = useState<ClipViewSet | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [model, setModel] = useState<RenderModel | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        setActive(nextViews.views[0]?.id ?? 'raw')
      })
      .catch(value => alive && setError(String(value)))
    return () => {
      alive = false
    }
  }, [clipId])

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
      .then(next => alive && setModel(next))
      .catch(value => alive && setError(String(value)))
    return () => {
      alive = false
    }
  }, [clipId, view])

  if (error) return <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
  if (!detail || !viewSet)
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Loading preview…
      </div>
    )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2 dark:border-white/10">
        {viewSet.views.map((item: ClipViewDescriptor) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={`rounded-md px-2 py-1 text-xs ${active === item.id ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10'}`}
          >
            {item.label}
          </button>
        ))}
        <button
          onClick={() => setActive('raw')}
          className={`rounded-md px-2 py-1 text-xs ${active === 'raw' ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10'}`}
        >
          Raw
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {active === 'raw' ? (
          <RawInspector detail={detail} />
        ) : (
          model && <RenderedView model={model} />
        )}
      </div>
    </div>
  )
}
