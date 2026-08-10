import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type {
  ClipDetail,
  TransformPreferences,
  TransformPreview,
  TransformerDescriptor,
} from '../../shared/types'
import { RenderModelView } from '../inspector/RenderModelView'

const date = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)

export const TransformationPalette = ({
  clipId,
  representations,
  close,
  setActive,
}: {
  clipId: string
  representations: ClipDetail['representations']
  close: () => void
  setActive: (value: TransformPreview | null) => void
}) => {
  const [items, setItems] = useState<TransformerDescriptor[]>([])
  const [preferences, setPreferences] = useState<TransformPreferences>({
    favoriteTransformerIds: [],
  })
  const [transformerId, setTransformerId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [rootName, setRootName] = useState('Root')
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void Promise.all([
      invoke<TransformerDescriptor[]>('list_transformer_contributions', { clipId }),
      invoke<TransformPreferences>('get_transform_preferences'),
    ]).then(([descriptors, prefs]) => {
      const ordered = [...descriptors].sort(
        (a, b) =>
          Number(!prefs.favoriteTransformerIds.includes(a.id)) -
            Number(!prefs.favoriteTransformerIds.includes(b.id)) || a.label.localeCompare(b.label)
      )
      setItems(ordered)
      setPreferences(prefs)
      setTransformerId(ordered[0]?.id ?? '')
      setSourceId(
        representations.find(rep => rep.textValue !== undefined)?.id ?? representations[0]?.id ?? ''
      )
    })
  }, [clipId, representations])
  const run = async () => {
    try {
      const parameters =
        transformerId === 'builtin.transform.json.to_typescript' ? { rootName } : {}
      const value = await invoke<TransformPreview>('create_transform_preview', {
        clipId,
        transformerId,
        sourceId,
        parameters,
      })
      setPreview(value)
      setActive(value)
      setError('')
    } catch (reason) {
      setError(String(reason))
    }
  }
  const favorite = async () => {
    if (!transformerId) return
    const ids = preferences.favoriteTransformerIds.includes(transformerId)
      ? preferences.favoriteTransformerIds.filter(id => id !== transformerId)
      : [...preferences.favoriteTransformerIds, transformerId]
    const next = { favoriteTransformerIds: ids }
    await invoke('update_transform_preferences', { preferences: next })
    setPreferences(next)
  }
  return (
    <section
      className="mt-6 rounded border border-sky-800 bg-slate-900 p-3"
      aria-label="Transformations"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Transform</h2>
        <button className="tag" onClick={close}>
          Esc
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          Utility
          <select
            className="mt-1 w-full rounded bg-slate-800 p-2"
            value={transformerId}
            onChange={event => setTransformerId(event.target.value)}
          >
            {items.map(item => (
              <option key={item.id} value={item.id}>
                {preferences.favoriteTransformerIds.includes(item.id) ? '★ ' : ''}
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Source
          <select
            className="mt-1 w-full rounded bg-slate-800 p-2"
            value={sourceId}
            onChange={event => setSourceId(event.target.value)}
          >
            {representations
              .filter(rep => rep.textValue !== undefined || rep.binaryFileId)
              .map(rep => (
                <option key={rep.id} value={rep.id}>
                  {rep.formatKey}
                </option>
              ))}
          </select>
        </label>
      </div>
      {transformerId === 'builtin.transform.json.to_typescript' && (
        <label className="mt-2 block text-sm">
          Root type name
          <input
            className="mt-1 w-full rounded bg-slate-800 p-2"
            value={rootName}
            onChange={event => setRootName(event.target.value)}
          />
        </label>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className="button"
          disabled={!transformerId || !sourceId}
          onClick={() => void run()}
        >
          Preview
        </button>
        <button className="tag" disabled={!transformerId} onClick={() => void favorite()}>
          {preferences.favoriteTransformerIds.includes(transformerId) ? 'Unfavorite' : 'Favorite'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {preview && (
        <div className="mt-3">
          <RenderModelView model={preview.model} />
          <p className="mt-2 text-xs text-slate-400">
            Expires {date(preview.expiresAt)} ·{' '}
            {preview.outputs
              .map(output => `${output.canonicalMimeType ?? 'binary'} ${output.byteLength} bytes`)
              .join(', ')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="button"
              onClick={() =>
                void invoke('copy_clip_output', {
                  policy: { kind: 'transformed', resultId: preview.resultId },
                })
              }
            >
              Copy transformed
            </button>
            <button
              className="button"
              onClick={() =>
                void invoke('paste_clip_output', {
                  policy: { kind: 'transformed', resultId: preview.resultId },
                })
              }
            >
              Paste transformed
            </button>
            <button
              className="button"
              onClick={() =>
                void invoke<string>('save_transform_result', { resultId: preview.resultId }).then(
                  close
                )
              }
            >
              Save as new clip
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
