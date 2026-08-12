import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import type { FactoryResetResult, StartupStatus } from '../../shared/types'

const CONFIRMATION = 'RESET CLIPSX'

export const StartupRecovery = ({ status }: { status: StartupStatus }) => {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await invoke<FactoryResetResult>('factory_reset', { confirmation })
      if (result.failures.length > 0) {
        setError(result.failures.join('\n'))
        return
      }
      if (result.restartRequired) await invoke('restart_app')
    } catch (value) {
      setError(String(value))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-lg rounded-2xl border border-amber-400/25 bg-slate-900 p-7 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">
          Storage recovery
        </p>
        <h1 className="mt-2 text-2xl font-semibold">A factory reset is required</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{status.message}</p>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          ClipsX will delete its local database, managed clipboard files, extension packages, and
          saved credentials. The retired database is not migrated.
        </p>
        <label className="mt-6 block text-sm font-medium" htmlFor="reset-confirmation">
          Type <span className="font-mono text-amber-300">{CONFIRMATION}</span> to continue
        </label>
        <input
          id="reset-confirmation"
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-amber-400"
        />
        {error && (
          <p role="alert" className="mt-4 whitespace-pre-wrap text-sm text-red-300">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={busy || confirmation !== CONFIRMATION || !status.resetAvailable}
          onClick={() => void reset()}
          className="mt-6 w-full rounded-lg bg-amber-400 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Resetting ClipsX…' : 'Reset local ClipsX data'}
        </button>
      </section>
    </main>
  )
}
