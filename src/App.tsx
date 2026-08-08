import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { FactoryResetResult, StartupStatus } from './shared/types/architecture'

const App = () => {
  const [status, setStatus] = useState<StartupStatus | null>(null)
  const [resetting, setResetting] = useState(false)
  const [result, setResult] = useState<FactoryResetResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void invoke<StartupStatus>('get_startup_status')
      .then(setStatus)
      .catch(value => setError(String(value)))
  }, [])

  const reset = async () => {
    if (
      !window.confirm(
        'This permanently deletes all local ClipsX history, configuration, models, and sign-in credentials. Continue?'
      )
    )
      return
    setResetting(true)
    setError(null)
    try {
      setResult(await invoke<FactoryResetResult>('factory_reset', { confirmation: 'RESET CLIPSX' }))
    } catch (value) {
      setError(String(value))
    } finally {
      setResetting(false)
    }
  }

  if (error)
    return (
      <main className="flex h-screen items-center justify-center p-8 text-red-700">{error}</main>
    )
  if (!status)
    return <main className="flex h-screen items-center justify-center">Preparing ClipsX v2…</main>
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <section className="max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-sky-400">
          ClipsX architecture cutover
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Foundation active</h1>
        <p className="mt-4 leading-7 text-slate-300">{status.message}</p>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          This release does not read, migrate, or retain the retired clipboard schema. M1 restores
          capture on the v2 representation model.
        </p>
        {status.resetAvailable && !result && (
          <button
            className="mt-7 rounded-md bg-red-600 px-4 py-2 font-medium hover:bg-red-500 disabled:opacity-50"
            disabled={resetting}
            onClick={() => void reset()}
          >
            {resetting ? 'Resetting…' : 'Factory reset local ClipsX data'}
          </button>
        )}
        {result && (
          <div className="mt-7 rounded-md border border-emerald-700 bg-emerald-950/40 p-4">
            <p>Reset complete. Restart ClipsX to create a fresh v2 database.</p>
            {result.failures.length > 0 && (
              <p className="mt-2 text-amber-300">
                Some cleanup items failed: {result.failures.join('; ')}
              </p>
            )}
            <button
              className="mt-4 rounded-md bg-sky-600 px-4 py-2 font-medium hover:bg-sky-500"
              onClick={() => void invoke('restart_app')}
            >
              Restart ClipsX
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
export default App
