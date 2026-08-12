import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { BrainCircuit, CheckCircle2, Circle, Loader2, Sparkles } from 'lucide-react'
import type { TextEmbeddingStatus } from '../../shared/types/v2'

const StatusDot = ({ active, loading }: { active: boolean; loading?: boolean }) => {
  if (loading) return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
  return active ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  ) : (
    <Circle className="h-3.5 w-3.5 text-gray-400" />
  )
}

export const IntelligencePage = () => {
  const [status, setStatus] = useState<TextEmbeddingStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    invoke<TextEmbeddingStatus>('get_text_embedding_status')
      .then(s => {
        setStatus(s)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const isActive = Boolean(status?.enabled && status.activeSpaceId)
  const indexed = status?.indexedClips ?? 0
  const pending = status?.pendingJobs ?? 0

  return (
    <div className="flex h-full flex-col overflow-auto p-8">
      <div className="mx-auto w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-violet-500/20 to-pink-500/20">
            <Sparkles className="h-5 w-5 text-violet-500" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Intelligence</h1>
            <p className="text-xs text-gray-500">
              On-device AI — semantic search, OCR, and more
            </p>
          </div>
        </div>

        {/* Semantic Search Status */}
        <div className="rounded-2xl border border-slate-200/60 bg-slate-100/30 p-5 dark:border-white/10 dark:bg-slate-100/5">
          <div className="mb-4 flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Semantic Search
            </span>
            <div className="ml-auto">
              <StatusDot active={isActive} loading={loading} />
            </div>
          </div>

          {loading && (
            <p className="text-xs text-gray-500">Loading status…</p>
          )}

          {!loading && !isActive && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Semantic search is not configured. Connect an Ollama instance to enable meaning-based
              search across your clipboard history.
            </p>
          )}

          {!loading && isActive && (
            <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
              <div className="flex items-center justify-between">
                <span>Indexed clips</span>
                <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">
                  {indexed.toLocaleString()}
                </span>
              </div>
              {pending > 0 && (
                <div className="flex items-center justify-between">
                  <span>Pending</span>
                  <span className="font-mono text-amber-600 dark:text-amber-400">
                    {pending.toLocaleString()}
                  </span>
                </div>
              )}
              {status?.diagnostic && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                  {status.diagnostic}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Ollama Config — Sprint 3 placeholder */}
        <div className="rounded-2xl border border-dashed border-slate-300/60 bg-slate-50/30 p-5 dark:border-white/10 dark:bg-slate-100/3">
          <p className="text-center text-xs text-gray-400 dark:text-gray-600">
            Ollama configuration coming in a future update
          </p>
        </div>
      </div>
    </div>
  )
}
