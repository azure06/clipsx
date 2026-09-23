import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Copy, Database, RotateCcw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { copyClipboardOutput, pasteClipboardOutput } from '../../shared/clipboardOutput'

type ExtensionResult = {
  jobId: string
  clipId: string
  sourceId: string
  packageId: string
  transformerId: string
  transformerVersion: string
  status: 'pending' | 'running' | 'waiting_provider' | 'completed' | 'failed' | 'cancelled'
  reasonCode: string | null
  parameters: Record<string, unknown>
  outputText: string | null
  sourceText: string | null
}

export function ExtensionResults({ clipId }: { clipId: string }) {
  const [results, setResults] = useState<ExtensionResult[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(
    () =>
      void invoke<ExtensionResult[]>('list_clip_extension_results', { clipId }).then(setResults),
    [clipId]
  )

  useEffect(() => {
    refresh()
    let unlisten: (() => void) | undefined
    void listen<{ clipId: string }>('extension-job-updated', event => {
      if (event.payload.clipId === clipId) refresh()
    }).then(value => (unlisten = value))
    return () => unlisten?.()
  }, [clipId, refresh])

  if (results.length === 0) return null
  const active = results.find(result => result.jobId === selected) ?? results[0]
  if (!active) return null
  const presetValue = active.parameters['preset']
  const preset = typeof presetValue === 'string' ? presetValue : 'rewrite'
  const runAgain = async (command: 'retry_extension_job' | 'regenerate_extension_result') => {
    try {
      setError(null)
      const invocation = await invoke<{ token: string }>('issue_extension_transformer_invocation', {
        transformerId: active.transformerId,
        clipId,
        sourceId: active.sourceId,
      })
      await invoke(command, {
        jobId: active.jobId,
        requestId: crypto.randomUUID(),
        invocationToken: invocation.token,
      })
      refresh()
    } catch (value) {
      setError(String(value))
    }
  }
  return (
    <section className="max-h-[45%] shrink-0 border-t border-slate-200/70 bg-white/45 px-3 py-2 dark:border-white/5 dark:bg-black/10">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Results</h3>
        <div className="flex gap-1 overflow-x-auto">
          {results.map(result => (
            <button
              key={result.jobId}
              type="button"
              onClick={() => setSelected(result.jobId)}
              className={`rounded px-2 py-1 text-[10px] ${result.jobId === active.jobId ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-200/60 dark:hover:bg-white/10'}`}
            >
              {typeof result.parameters['preset'] === 'string'
                ? result.parameters['preset'].replaceAll('_', ' ')
                : result.status}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200/70 bg-white/70 p-2 dark:border-white/10 dark:bg-slate-950/30">
        {active.status === 'completed' && active.outputText !== null ? (
          <div className="grid gap-2 md:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                Original
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-700 dark:text-slate-200">
                {active.sourceText}
              </pre>
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-semibold uppercase text-violet-600 dark:text-violet-300">
                Result
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-700 dark:text-slate-200">
                {active.outputText}
              </pre>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {active.status.replaceAll('_', ' ')}
            {active.reasonCode ? ` · ${active.reasonCode.replaceAll('_', ' ')}` : ''}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1">
          {active.status === 'completed' && (
            <>
              <button
                title="Copy result"
                onClick={() => void copyClipboardOutput({ kind: 'derived', jobId: active.jobId })}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                title="Paste result"
                onClick={() => void pasteClipboardOutput({ kind: 'derived', jobId: active.jobId })}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10"
              >
                Paste
              </button>
              <button
                title="Save as new clip"
                onClick={() =>
                  void invoke('promote_extension_result', {
                    jobId: active.jobId,
                    requestId: crypto.randomUUID(),
                  })
                }
                className="rounded p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10"
              >
                <Database className="h-3.5 w-3.5" />
              </button>
              <button
                title="Regenerate result"
                onClick={() => void runAgain('regenerate_extension_result')}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {active.status === 'failed' && (
            <button
              title="Retry result"
              onClick={() => void runAgain('retry_extension_job')}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {(active.status === 'pending' ||
            active.status === 'running' ||
            active.status === 'waiting_provider') && (
            <button
              title="Cancel"
              onClick={() =>
                void invoke('cancel_extension_job', { jobId: active.jobId }).then(refresh)
              }
              className="rounded p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title={`Delete ${preset} result`}
            onClick={() =>
              void invoke('delete_extension_result', { jobId: active.jobId }).then(refresh)
            }
            className="ml-auto rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  )
}
