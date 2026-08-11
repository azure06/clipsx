import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import type { ClipDetail, RenderModel } from '../../shared/types/v2'

type Transformer = { id: string; label: string; version: string }
type TransformPreview = { resultId: string; model: RenderModel }

export const TransformControls = ({ clipId }: { clipId: string }) => {
  const [detail, setDetail] = useState<ClipDetail | null>(null)
  const [items, setItems] = useState<Transformer[]>([])
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPreview(null); setError(null)
    void Promise.all([invoke<ClipDetail>('get_clip_detail', { clipId }), invoke<Transformer[]>('list_transformer_contributions', { clipId })])
      .then(([nextDetail, nextItems]) => { setDetail(nextDetail); setItems(nextItems) })
      .catch(value => setError(String(value)))
  }, [clipId])

  const previewTransform = async (transformer: Transformer) => {
    const source = detail?.representations.find(rep => rep.storageKind !== 'file_list')
    if (!source) return
    setBusy(true); setError(null)
    try { setPreview(await invoke<TransformPreview>('create_transform_preview', { clipId, transformerId: transformer.id, sourceId: source.id, parameters: {} })) }
    catch (value) { setError(String(value)) }
    finally { setBusy(false) }
  }
  if (items.length === 0) return null
  return <div className="absolute bottom-3 right-3 z-10 max-w-80 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
    <div className="flex flex-wrap gap-1">{items.map(item => <button className="rounded px-2 py-1 text-[10px] text-gray-600 hover:bg-slate-100 dark:text-gray-300 dark:hover:bg-white/10" disabled={busy} key={item.id} onClick={() => void previewTransform(item)}>{item.label}</button>)}</div>
    {error && <p className="mt-2 text-[10px] text-red-600">{error}</p>}
    {preview && <div className="mt-2 border-t border-slate-200 pt-2 dark:border-white/10"><pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(preview.model, null, 2)}</pre><div className="mt-2 flex gap-1"><button className="rounded bg-blue-500 px-2 py-1 text-[10px] text-white" onClick={() => void invoke('copy_clip_output', { policy: { kind: 'transformed', resultId: preview.resultId } })}>Copy</button><button className="rounded bg-blue-500 px-2 py-1 text-[10px] text-white" onClick={() => void invoke('paste_clip_output', { policy: { kind: 'transformed', resultId: preview.resultId } })}>Paste</button><button className="rounded border border-slate-300 px-2 py-1 text-[10px] dark:border-slate-600" onClick={() => void invoke('save_transform_result', { resultId: preview.resultId })}>Save</button></div></div>}
  </div>
}
