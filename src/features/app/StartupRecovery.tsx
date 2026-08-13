import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { FactoryResetResult, StartupStatus } from '../../shared/types'
import { Button } from '../../shared/components/ui'

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
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 dark:bg-slate-950">
      <section className="w-full max-w-lg rounded-2xl border border-amber-400/30 bg-white/80 p-7 shadow-2xl backdrop-blur-xl dark:border-amber-400/20 dark:bg-slate-900/80">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-500" strokeWidth={1.5} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
            Storage recovery
          </p>
        </div>

        <h1 className="mt-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">
          A factory reset is required
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-slate-300">{status.message}</p>
        <p className="mt-4 rounded-xl border border-amber-200/60 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          ClipsX will delete its local database, managed clipboard files, extension packages, and
          saved credentials. The retired database is not migrated.
        </p>

        <label
          className="mt-6 block text-sm font-medium text-gray-700 dark:text-gray-300"
          htmlFor="reset-confirmation"
        >
          Type{' '}
          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
            {CONFIRMATION}
          </span>{' '}
          to continue
        </label>
        <input
          id="reset-confirmation"
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50/60 px-3 py-2 font-mono text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 dark:border-white/10 dark:bg-slate-100/5 dark:text-gray-100"
        />

        {error && (
          <p
            role="alert"
            className="mt-4 whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <Button
          variant="destructive"
          className="mt-6 w-full"
          isLoading={busy}
          disabled={busy || confirmation !== CONFIRMATION || !status.resetAvailable}
          onClick={() => void reset()}
        >
          {busy ? 'Resetting ClipsX…' : 'Reset local ClipsX data'}
        </Button>
      </section>
    </main>
  )
}
