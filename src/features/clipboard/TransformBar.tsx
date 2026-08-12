import { invoke } from '@tauri-apps/api/core'
import { Copy, Save, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RenderModel } from '../../shared/types/v2'
import { RenderModelView } from './RenderModelView'
import type { ClipPresentation } from '../../shared/types/v2'

type Transformer = { id: string; label: string; version: string }
type TransformPreview = { resultId: string; model: RenderModel }

export const TransformBar = ({
  clipId,
  sourceId,
  basePresentation,
}: {
  clipId: string
  sourceId: string
  basePresentation: ClipPresentation
}) => {
  const [items, setItems] = useState<Transformer[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPreview(null)
    setError(null)
    void invoke<Transformer[]>('list_transformer_contributions', { clipId })
      .then(setItems)
      .catch(() => setItems([]))
  }, [clipId])

  if (items.length === 0) return null

  const run = async (item: Transformer) => {
    setBusy(item.id)
    setError(null)
    setPreview(null)
    try {
      const result = await invoke<TransformPreview>('create_transform_preview', {
        clipId,
        transformerId: item.id,
        sourceId,
        parameters: {},
      })
      setPreview(result)
    } catch (value) {
      setError(String(value))
    } finally {
      setBusy(null)
    }
  }

  const applyResult = (command: string) =>
    preview &&
    invoke(
      command,
      command === 'save_transform_result'
        ? { resultId: preview.resultId }
        : { policy: { kind: 'transformed', resultId: preview.resultId } }
    ).then(() => setPreview(null))

  const previewPresentation: ClipPresentation | null = preview
    ? { ...basePresentation, model: preview.model }
    : null

  return (
    <div className="shrink-0 border-t border-slate-200/60 dark:border-white/5">
      {/* Pill strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Transform
        </span>
        {items.map(item => (
          <button
            key={item.id}
            disabled={busy !== null}
            onClick={() => void run(item)}
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              busy === item.id
                ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400'
                : 'border-slate-200 bg-slate-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/10 dark:hover:text-blue-400'
            }`}
          >
            {busy === item.id ? '…' : item.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between px-3 pb-2 text-[11px] text-red-500">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Preview panel */}
      {previewPresentation && (
        <div className="border-t border-slate-200/60 dark:border-white/5">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Preview
            </span>
            <div className="flex items-center gap-0.5">
              <button
                title="Copy"
                className="rounded p-1.5 text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                onClick={() => void applyResult('copy_clip_output')}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                title="Paste"
                className="rounded p-1.5 text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                onClick={() => void applyResult('paste_clip_output')}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                title="Save as new clip"
                className="rounded p-1.5 text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                onClick={() => void applyResult('save_transform_result')}
              >
                <Save className="h-3.5 w-3.5" />
              </button>
              <button
                title="Dismiss preview"
                className="ml-1 rounded p-1.5 text-gray-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                onClick={() => setPreview(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-auto border-t border-slate-100/60 dark:border-white/5">
            <RenderModelView presentation={previewPresentation} />
          </div>
        </div>
      )}
    </div>
  )
}
