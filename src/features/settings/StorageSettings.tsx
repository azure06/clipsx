import { useState } from 'react'
import type { CaptureSettings } from '../../shared/types'

export const StorageSettings = ({
  settings,
  close,
  save,
}: {
  settings: CaptureSettings
  close: () => void
  save: (settings: CaptureSettings) => Promise<void>
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
        onChange={event =>
          setValue({
            ...value,
            [key]: event.target.value === '' ? undefined : Number(event.target.value),
          })
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
        <p className="mb-3 text-xs text-slate-500">
          Currently using {value.managedBytesUsed.toLocaleString()} managed bytes.
        </p>
        {value.retentionWarning && (
          <p className="mb-3 rounded bg-amber-950 p-2 text-sm text-amber-200">
            {value.retentionWarning}
          </p>
        )}
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
