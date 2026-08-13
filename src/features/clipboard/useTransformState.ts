import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import type { RenderModel } from '../../shared/types/v2'
import type { ClipPresentation } from '../../shared/types/v2'

export type Transformer = { id: string; label: string; version: string }
export type TransformPreview = { resultId: string; model: RenderModel }

export type TransformControls = {
  items: Transformer[]
  run: (id: string) => Promise<void>
}

export const useTransformState = ({
  clipId,
  sourceId,
  basePresentation,
  onControls,
}: {
  clipId: string
  sourceId: string
  basePresentation: ClipPresentation | null
  onControls?: (controls: TransformControls | null) => void
}) => {
  const [items, setItems] = useState<Transformer[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [activeTransformer, setActiveTransformer] = useState<Transformer | null>(null)
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const presentationKind = basePresentation?.activeView.presentationKind

  useEffect(() => {
    if (!presentationKind || !sourceId) return
    setPreview(null)
    setError(null)
    setActiveTransformer(null)
    void invoke<Transformer[]>('list_transformer_contributions', {
      clipId,
      sourceId,
      presentationKind,
    })
      .then(setItems)
      .catch(() => setItems([]))
  }, [presentationKind, clipId, sourceId])

  const run = useCallback(
    async (id: string) => {
      const item = items.find(t => t.id === id)
      if (!item) return
      setBusy(item.id)
      setActiveTransformer(item)
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
    },
    [clipId, items, sourceId]
  )

  useEffect(() => {
    onControls?.(items.length > 0 ? { items, run } : null)
  }, [items, onControls, run])

  const applyResult = async (command: string) => {
    if (!preview) return
    await invoke(
      command,
      command === 'save_transform_result'
        ? { resultId: preview.resultId }
        : { policy: { kind: 'transformed', resultId: preview.resultId } }
    )
    setPreview(null)
  }

  return {
    busy,
    activeTransformer,
    preview,
    error,
    applyResult,
    dismissPreview: () => {
      setPreview(null)
      setActiveTransformer(null)
    },
    dismissError: () => {
      setError(null)
      setActiveTransformer(null)
    },
  }
}
