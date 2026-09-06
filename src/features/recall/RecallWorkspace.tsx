import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  RefreshCw,
  Square,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { copyLiteralText } from '../../shared/clipboardOutput'
import type { RecallEvidence } from '../../shared/types/v2'
import type { RecallTurn } from './useRecall'
import { linkRecallCitations } from './recallMarkdown'

type Props = {
  turns: RecallTurn[]
  scopeLabel: string
  isRunning: boolean
  expired: boolean
  onCancel: () => void
  onClear: () => void
  onFollowUp: (question: string) => void
  onRetry: (turn: RecallTurn) => void
  onApplySources: (turn: RecallTurn, clipIds: string[]) => void
  onSearchAll: (turn: RecallTurn) => void
  onOpenClip: (clipId: string) => void
  onBack?: () => void
}

const withSources = (turn: RecallTurn) =>
  `${turn.answer}\n\nSources\n${turn.sources
    .map(
      source =>
        `[${source.citation}] ${source.sourceAppName ?? source.sourceKind} — Copied ${new Date(source.capturedAt).toLocaleString()}\n${source.excerpt}`
    )
    .join('\n\n')}`

export function RecallWorkspace({
  turns,
  scopeLabel,
  isRunning,
  expired,
  onCancel,
  onClear,
  onFollowUp,
  onRetry,
  onApplySources,
  onSearchAll,
  onOpenClip,
  onBack,
}: Props) {
  const latest = turns.at(-1)
  const [openEvidence, setOpenEvidence] = useState<RecallEvidence | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (openEvidence) {
        event.preventDefault()
        event.stopPropagation()
        setOpenEvidence(null)
      } else if (isRunning) {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [isRunning, onCancel, openEvidence])

  const citations = useMemo(
    () => new Map(latest?.sources.map(source => [source.citation, source]) ?? []),
    [latest?.sources]
  )
  const selected = useMemo(
    () =>
      new Set(latest?.sources.map(source => source.clipId).filter(id => !excluded.has(id)) ?? []),
    [excluded, latest?.sources]
  )
  if (!latest) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl bg-slate-100/10 p-8 text-center text-sm text-gray-500 dark:bg-slate-100/5">
        {expired
          ? 'This temporary Recall session expired. Ask again to start a new one.'
          : 'Ask a question to recall something from your clipboard history.'}
      </div>
    )
  }

  const submit = () => {
    if (!followUp.trim() || isRunning) return
    onFollowUp(followUp)
    setFollowUp('')
  }

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-white/55 dark:bg-slate-950/30">
      <header className="flex items-start justify-between border-b border-slate-200/60 px-5 py-4 dark:border-white/10">
        <div className="min-w-0">
          {onBack && (
            <button className="mb-2 flex items-center gap-1 text-xs text-gray-500" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to results
            </button>
          )}
          <p className="text-xs font-medium uppercase tracking-wider text-violet-600 dark:text-violet-300">
            Recall · {scopeLabel}
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            {latest.question}
          </h2>
          {latest.providerId && (
            <p className="mt-1 text-xs text-gray-500">
              {latest.executionLocation === 'local' ? 'On this device' : 'Remote'} · {latest.model}
            </p>
          )}
        </div>
        <button
          onClick={onClear}
          className="rounded-lg p-2 text-gray-400 hover:bg-black/5 dark:hover:bg-white/5"
          title="New question"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {latest.status === 'running' && (
          <p className="mb-3 text-xs text-violet-600 dark:text-violet-300">
            {latest.stage === 'preparing_answer'
              ? 'Preparing answer'
              : latest.answer
                ? 'Writing answer'
                : 'Finding relevant clips'}
          </p>
        )}
        {latest.invalidated && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            A supporting clip changed or was deleted. This answer can’t be reused as context.
          </p>
        )}
        {latest.contextReduced && (
          <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
            Some lower-ranked evidence was omitted to fit this model’s context.
          </p>
        )}
        {latest.status === 'incomplete' && (
          <p className="mb-3 text-xs font-medium text-amber-700">Incomplete answer</p>
        )}
        {(latest.status === 'error' || latest.status === 'no_evidence') && (
          <div className="rounded-xl bg-slate-100/70 p-4 text-sm dark:bg-white/5">
            <p>{latest.error}</p>
            <button
              className="mt-3 flex items-center gap-1 text-violet-600"
              onClick={() => onRetry(latest)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        )}

        {latest.answer && (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-a:text-violet-600 prose-pre:bg-slate-950">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  const match = href?.match(/^recall-source:(\d+)$/)
                  const evidence = match ? citations.get(Number(match[1])) : undefined
                  return evidence ? (
                    <button
                      className="rounded bg-violet-100 px-1 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-200"
                      onClick={() => setOpenEvidence(evidence)}
                    >
                      {children}
                    </button>
                  ) : (
                    <span className="text-amber-600" title="Unresolved citation">
                      {children}
                    </span>
                  )
                },
                p: ({ children }) => <p>{children}</p>,
                code: ({ children, className }) =>
                  className ? (
                    <span className="relative block">
                      <code className={className}>{children}</code>
                      <button
                        className="absolute right-2 top-2 rounded bg-white/10 p-1 text-white"
                        title="Copy code"
                        onClick={() =>
                          void copyLiteralText(
                            (Array.isArray(children) ? children : [children])
                              .map(child =>
                                typeof child === 'string' || typeof child === 'number'
                                  ? String(child)
                                  : ''
                              )
                              .join('')
                              .replace(/\n$/, '')
                          )
                        }
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <code>{children}</code>
                  ),
              }}
            >
              {linkRecallCitations(latest.answer)}
            </ReactMarkdown>
          </div>
        )}

        {latest.sources.length > 0 && (
          <div className="mt-5 border-t border-slate-200/70 pt-4 dark:border-white/10">
            <button
              className="flex w-full items-center justify-between text-sm font-medium"
              onClick={() => setSourcesOpen(value => !value)}
            >
              <span>Sources ({latest.sources.length})</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {sourcesOpen && (
              <div className="mt-3 space-y-2">
                {latest.sources.map(source => (
                  <div
                    key={`${source.citation}-${source.clipId}`}
                    className="flex items-start gap-2 rounded-xl border border-slate-200/70 p-3 dark:border-white/10"
                  >
                    <button
                      onClick={() =>
                        setExcluded(current => {
                          const next = new Set(current)
                          if (next.has(source.clipId)) next.delete(source.clipId)
                          else next.add(source.clipId)
                          return next
                        })
                      }
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected.has(source.clipId) ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-300'}`}
                    >
                      {selected.has(source.clipId) && <Check className="h-3 w-3" />}
                    </button>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setOpenEvidence(source)}
                    >
                      <span className="block text-xs font-medium">
                        [{source.citation}] {source.sourceAppName ?? source.sourceKind}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs text-gray-500">
                        {source.excerpt}
                      </span>
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    disabled={selected.size === 0 || isRunning}
                    onClick={() => onApplySources(latest, [...selected])}
                  >
                    Use only these clips
                  </button>
                  <button
                    className="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-black/5 dark:text-gray-300"
                    onClick={() => onSearchAll(latest)}
                  >
                    Search all history
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200/60 p-4 dark:border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            disabled={!latest.answer}
            onClick={() => void copyLiteralText(latest.answer)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy answer
          </button>
          <button
            disabled={!latest.answer}
            onClick={() => void copyLiteralText(withSources(latest))}
            className="rounded-lg px-2.5 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
          >
            Copy with sources
          </button>
          {isRunning && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          )}
        </div>
        <textarea
          data-recall-input="follow-up"
          ref={composerRef}
          value={followUp}
          onChange={event => setFollowUp(event.target.value)}
          onKeyDown={event => {
            if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing &&
              !event.repeat
            ) {
              event.preventDefault()
              event.stopPropagation()
              submit()
            }
          }}
          rows={2}
          placeholder="Ask a follow-up…"
          className="w-full resize-none rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-white/10 dark:bg-white/5"
        />
        <p className="mt-1 text-right text-[10px] text-gray-400">Ctrl/Cmd + Enter to ask</p>
      </footer>

      {openEvidence && (
        <aside className="absolute inset-0 z-20 flex flex-col bg-white/95 p-5 backdrop-blur-xl dark:bg-slate-950/95">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-violet-600">
                Evidence [{openEvidence.citation}]
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {openEvidence.sourceAppName ?? openEvidence.sourceKind} · Copied{' '}
                {new Date(openEvidence.capturedAt).toLocaleString()}
              </p>
            </div>
            <button onClick={() => setOpenEvidence(null)} className="p-1">
              <X className="h-4 w-4" />
            </button>
          </div>
          <pre className="mt-5 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-100 p-4 text-xs dark:bg-white/5">
            {openEvidence.excerpt}
          </pre>
          <button
            onClick={() => onOpenClip(openEvidence.clipId)}
            className="mt-4 flex items-center justify-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white"
          >
            <ExternalLink className="h-4 w-4" />
            Open clip
          </button>
        </aside>
      )}
    </section>
  )
}
