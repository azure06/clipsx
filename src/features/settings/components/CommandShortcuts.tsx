import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { APP_COMMANDS, loadCommandBindings } from '../../../shared/keyboard/commands'
import { PROFILE_MUTATED_EVENT, SYNC_APPLIED_EVENT } from '../../../shared/sync/configSync'
import { Button } from '../../../shared/components/ui'

export function CommandShortcuts() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const load = () => {
      void loadCommandBindings()
        .then(setValues)
        .catch(() => undefined)
    }
    load()
    window.addEventListener(SYNC_APPLIED_EVENT, load)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, load)
  }, [])
  const save = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await invoke('set_command_shortcut', {
        commandId: id,
        accelerator: values[id]?.trim() || null,
      })
      await loadCommandBindings()
      window.dispatchEvent(new Event(PROFILE_MUTATED_EVENT))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 space-y-3">
      <h3 className="font-semibold">App-command shortcuts</h3>
      <p className="text-sm text-slate-500">
        These shortcuts sync. Primary means Command on macOS and Control on Windows/Linux. Leave
        blank to use the default.
      </p>
      {APP_COMMANDS.map(command => (
        <div key={command.id} className="flex items-center gap-2">
          <label className="flex-1 text-sm" htmlFor={command.id}>
            {command.label}
          </label>
          <input
            id={command.id}
            className="w-48 rounded border bg-transparent px-2 py-1"
            value={values[command.id] ?? ''}
            placeholder={command.shortcut || 'Platform default'}
            onChange={event =>
              setValues(previous => ({ ...previous, [command.id]: event.target.value }))
            }
          />
          <Button variant="secondary" disabled={busy} onClick={() => void save(command.id)}>
            Save
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
