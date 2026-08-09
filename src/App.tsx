import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type {
  CaptureSettings,
  ClipDetail,
  ClipPage,
  ClipSummary,
  Tag,
} from './shared/types/architecture'

const date = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
const App = () => {
  const [page, setPage] = useState<ClipPage>({ items: [] })
  const [selected, setSelected] = useState<ClipDetail | null>(null)
  const [scope, setScope] = useState('all')
  const [tags, setTags] = useState<Tag[]>([])
  const [settings, setSettings] = useState<CaptureSettings | null>(null)
  const [notice, setNotice] = useState('')
  const load = async () => {
    setPage(await invoke<ClipPage>('list_clips', { request: { limit: 50, scope } }))
    setTags(await invoke<Tag[]>('list_tags'))
  }
  useEffect(() => {
    void invoke<ClipPage>('list_clips', { request: { limit: 50, scope } }).then(setPage)
    void invoke<Tag[]>('list_tags').then(setTags)
  }, [scope])
  const select = async (clip: ClipSummary) =>
    setSelected(await invoke<ClipDetail>('get_clip_detail', { clipId: clip.id }))
  const capture = async () => {
    try {
      await invoke('capture_clipboard')
      await load()
      setNotice('Captured clipboard snapshot.')
    } catch (e) {
      setNotice(String(e))
    }
  }
  const action = async (command: string, args: Record<string, unknown>) => {
    await invoke(command, args)
    await load()
    if (selected)
      setSelected(await invoke<ClipDetail>('get_clip_detail', { clipId: selected.clip.id }))
  }
  const scopes: Array<[string, string]> = [
    ['all', 'All'],
    ['favorites', 'Favorites'],
    ['pinned', 'Pinned'],
  ]
  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">ClipsX</h1>
          <p className="text-sm text-slate-400">Original representations, stored locally.</p>
        </div>
        <div className="flex gap-2">
          <button className="button" onClick={() => void capture()}>
            Capture clipboard
          </button>
          <button
            className="button"
            onClick={() => void invoke<CaptureSettings>('get_capture_settings').then(setSettings)}
          >
            Storage
          </button>
        </div>
      </header>
      {notice && <p className="mb-3 text-sm text-amber-300">{notice}</p>}
      <nav className="mb-4 flex gap-2">
        {scopes.map(([value, label]) => (
          <button
            key={value}
            className={scope === value ? 'tab tab-active' : 'tab'}
            onClick={() => setScope(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="grid min-h-[70vh] grid-cols-[minmax(18rem,2fr)_minmax(22rem,3fr)] gap-4">
        <section className="panel overflow-auto">
          {page.items.length === 0 ? (
            <p className="p-6 text-slate-400">No clips yet. Capture your clipboard to begin.</p>
          ) : (
            page.items.map(clip => (
              <button key={clip.id} className="clip" onClick={() => void select(clip)}>
                <div className="flex justify-between gap-2">
                  <strong className="truncate">{clip.safeSummary}</strong>
                  <span>
                    {clip.isPinned ? 'Pinned ' : ''}
                    {clip.isFavorite ? 'Favorite' : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {clip.sourceAppName ?? 'Unknown app'} · {date(clip.capturedAt)} ·{' '}
                  {clip.representationCount} representations
                </p>
                {clip.tags.length > 0 && (
                  <p className="mt-1 text-xs text-sky-300">
                    {clip.tags.map(t => t.name).join(', ')}
                  </p>
                )}
              </button>
            ))
          )}
        </section>
        <section className="panel p-5">
          {selected ? (
            <Detail detail={selected} action={action} tags={tags} />
          ) : (
            <p className="text-slate-400">Select a clip to inspect its original representations.</p>
          )}
        </section>
      </div>
      {settings && (
        <Settings
          settings={settings}
          close={() => setSettings(null)}
          save={async value => {
            await invoke('update_capture_settings', { settings: value })
            setSettings(null)
          }}
        />
      )}
    </main>
  )
}
const Detail = ({
  detail,
  action,
  tags,
}: {
  detail: ClipDetail
  action: (c: string, a: Record<string, unknown>) => Promise<void>
  tags: Tag[]
}) => (
  <>
    <div className="flex gap-2">
      <button
        className="button"
        onClick={() => void invoke('copy_clip_original', { clipId: detail.clip.id })}
      >
        Copy original
      </button>
      <button
        className="button"
        onClick={() =>
          void action('set_clip_pinned', { clipId: detail.clip.id, value: !detail.clip.isPinned })
        }
      >
        {detail.clip.isPinned ? 'Unpin' : 'Pin'}
      </button>
      <button
        className="button"
        onClick={() =>
          void action('set_clip_favorite', {
            clipId: detail.clip.id,
            value: !detail.clip.isFavorite,
          })
        }
      >
        {detail.clip.isFavorite ? 'Unfavorite' : 'Favorite'}
      </button>
      <button
        className="button danger"
        onClick={() => void action('delete_clip', { clipId: detail.clip.id })}
      >
        Delete
      </button>
    </div>
    <textarea
      className="mt-4 w-full rounded bg-slate-800 p-2"
      placeholder="Note"
      defaultValue={detail.clip.note}
      onBlur={e =>
        void action('update_clip_note', {
          clipId: detail.clip.id,
          note: e.currentTarget.value || null,
        })
      }
    />
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map(tag => (
        <button
          key={tag.id}
          className="tag"
          onClick={() =>
            void action(
              detail.clip.tags.some(t => t.id === tag.id) ? 'remove_clip_tag' : 'add_clip_tag',
              { clipId: detail.clip.id, tagId: tag.id }
            )
          }
        >
          {detail.clip.tags.some(t => t.id === tag.id) ? '✓ ' : ''}
          {tag.name}
        </button>
      ))}
    </div>
    <h2 className="mt-6 font-semibold">Raw representations</h2>
    {detail.representations.map(rep => (
      <article key={rep.id} className="mt-3 rounded border border-slate-700 p-3">
        <p className="text-sm font-medium">
          {rep.ordinal + 1}. {rep.formatKey}
        </p>
        <p className="text-xs text-slate-400">
          {rep.storageKind} · {rep.byteLength} bytes {rep.nativeType && ` · ${rep.nativeType}`}
        </p>
        {rep.textValue !== undefined && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs">
            {rep.textValue}
          </pre>
        )}
        {rep.fileReferences.length > 0 && (
          <ol className="mt-2 list-decimal pl-5 text-sm">
            {rep.fileReferences.map(file => (
              <li key={file}>{file}</li>
            ))}
          </ol>
        )}
        {rep.binaryFileId && (
          <p className="mt-2 text-xs text-slate-400">Binary asset {rep.sha256}</p>
        )}
      </article>
    ))}
  </>
)
const Settings = ({
  settings,
  close,
  save,
}: {
  settings: CaptureSettings
  close: () => void
  save: (s: CaptureSettings) => Promise<void>
}) => {
  const [value, setValue] = useState(settings)
  const field = (key: keyof CaptureSettings, label: string) => (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded bg-slate-800 p-2"
        type="number"
        value={value[key] ?? ''}
        placeholder="Disabled"
        onChange={e =>
          setValue({ ...value, [key]: e.target.value === '' ? undefined : Number(e.target.value) })
        }
      />
    </label>
  )
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60">
      <section className="panel w-full max-w-md p-5">
        <h2 className="text-lg font-semibold">Storage limits</h2>
        <p className="my-2 text-sm text-slate-400">
          Blank disables a limit. Pinned and favorite clips are protected.
        </p>
        <div className="space-y-3">
          {field('maxOrdinaryClips', 'Maximum ordinary clips')}
          {field('maxAgeDays', 'Expiry days')}
          {field('maxManagedBytes', 'Managed bytes')}
          {field('maxRepresentationBytes', 'Maximum representation bytes')}
          {field('maxSnapshotBytes', 'Maximum snapshot bytes')}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="button" onClick={close}>
            Cancel
          </button>
          <button className="button" onClick={() => void save(value)}>
            Save
          </button>
        </div>
      </section>
    </div>
  )
}
export default App
