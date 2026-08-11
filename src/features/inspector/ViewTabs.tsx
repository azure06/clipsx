import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { ClipViewSet, RendererPreferences, RenderModel } from '../../shared/types'
import { RenderModelView } from './RenderModelView'

export const ViewTabs = ({ clipId }: { clipId: string }) => {
  const [viewSet, setViewSet] = useState<ClipViewSet | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [model, setModel] = useState<RenderModel | null>(null)
  useEffect(() => {
    void invoke<ClipViewSet>('get_clip_views', { clipId }).then(value => {
      setViewSet(value)
      setActive(value.views[0]?.id ?? null)
    })
  }, [clipId])
  useEffect(() => {
    const view = viewSet?.views.find(item => item.id === active)
    if (view)
      void invoke<RenderModel>('render_clip_view', {
        clipId,
        rendererId: view.rendererId,
        sourceId: view.sourceId,
        facetId: view.facetId,
      }).then(setModel)
  }, [active, clipId, viewSet])
  if (!viewSet || viewSet.views.length === 0) return null
  const activeView = viewSet.views.find(view => view.id === active)
  const makeDefault = async () => {
    if (!activeView) return
    const preferences = await invoke<RendererPreferences>('get_renderer_preferences')
    if (activeView.facetId) preferences.byFacetId[activeView.facetId] = activeView.rendererId
    else if (activeView.mimeType)
      preferences.byMimeType[activeView.mimeType] = activeView.rendererId
    else return
    await invoke('update_renderer_preferences', { preferences })
  }
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Views</h2>
        {activeView && !activeView.isOriginal && (activeView.facetId || activeView.mimeType) && (
          <button className="tag" onClick={() => void makeDefault()}>
            Use as default
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {viewSet.views.map(view => (
          <button
            key={view.id}
            className={active === view.id ? 'tab tab-active' : 'tab'}
            onClick={() => setActive(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>
      {model && <RenderModelView model={model} />}
    </section>
  )
}
