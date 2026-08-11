import { invoke } from '@tauri-apps/api/core'
import { Copy, Save, Send, WandSparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RenderModel } from '../../shared/types/v2'

type Transformer = { id: string; label: string; version: string }
type TransformPreview = { resultId: string; model: RenderModel }

export const TransformMenu = ({ clipId, sourceId }: { clipId: string; sourceId: string }) => {
  const [items, setItems] = useState<Transformer[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void invoke<Transformer[]>('list_transformer_contributions', { clipId })
      .then(setItems)
      .catch(() => setItems([]))
  }, [clipId])
  if (items.length === 0) return null

  const run = async (item: Transformer) => {
    setBusy(true)
    setError(null)
    try {
      setPreview(
        await invoke<TransformPreview>('create_transform_preview', {
          clipId,
          transformerId: item.id,
          sourceId,
          parameters: {},
        })
      )
    } catch (value) {
      setError(String(value))
    } finally {
      setBusy(false)
    }
  }
  const applyResult = (command: string) =>
    preview &&
    invoke(
      command,
      command === 'save_transform_result'
        ? { resultId: preview.resultId }
        : { policy: { kind: 'transformed', resultId: preview.resultId } }
    )

  return (
    <div className="relative">
      <button
        aria-label="Open transformations"
        title="Transform"
        className="rounded-md p-1.5 text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10"
        onClick={() => setOpen(value => !value)}
      >
        <WandSparkles className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold uppercase text-gray-500">Transform</span>
            <button aria-label="Close transformations" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-44 overflow-auto">
            {items.map(item => (
              <button
                className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-white/10"
                disabled={busy}
                key={item.id}
                onClick={() => void run(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {error && <p className="mt-1 text-[10px] text-red-500">{error}</p>}
          {preview && (
            <div className="mt-2 flex justify-end gap-1 border-t border-slate-200 pt-2 dark:border-white/10">
              <button
                title="Copy result"
                className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-white/10"
                onClick={() => void applyResult('copy_clip_output')}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                title="Paste result"
                className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-white/10"
                onClick={() => void applyResult('paste_clip_output')}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                title="Save as new clip"
                className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-white/10"
                onClick={() => void applyResult('save_transform_result')}
              >
                <Save className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
