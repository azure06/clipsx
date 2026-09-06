import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Layers3,
  Plus,
  Sparkles,
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
import './recall.css'

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
    <section
      aria-label="Recall"
      className="recall-workspace relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-white/55 text-gray-800 dark:bg-slate-950/30 dark:text-gray-200"
    >
      <header className="recall-header">
        <div className="min-w-0">
          {onBack && (
            <button className="mb-2 flex items-center gap-1 text-xs text-gray-500" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to results
            </button>
          )}
          <div className="recall-brand">
            <span className="recall-mark">
              <Sparkles size={17} strokeWidth={1.7} />
            </span>
            <div>
              <p className="recall-title">Recall</p>
              <p className="recall-scope" title={scopeLabel}>
                {scopeLabel}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={onClear}
          className="recall-new"
          title="New question"
          aria-label="New question"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New</span>
        </button>
      </header>

      <div className="recall-body custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="recall-question" key={latest.requestId}>
          <p className="recall-eyebrow">Your question</p>
          <h2>{latest.question}</h2>
        </div>
        <div className="recall-answer-label">
          <Sparkles size={13} />
          <span>{latest.answer ? 'Answer' : 'Working on your question'}</span>
          {latest.sources.length > 0 && (
            <button
              onClick={() => setSourcesOpen(value => !value)}
              className="recall-evidence-count"
            >
              <Layers3 size={12} />
              {latest.sources.length} sources
            </button>
          )}
        </div>
        {latest.status === 'running' && (
          <p
            role="status"
            className="mb-4 flex items-center gap-2 text-xs font-medium text-violet-600 dark:text-violet-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            {latest.answer
              ? 'Writing answer'
              : latest.stage === 'preparing_answer' || latest.stage === 'generating'
                ? 'Preparing answer'
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
          <div className="recall-answer">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  const match = href?.match(/^recall-source:(\d+)$/)
                  const evidence = match ? citations.get(Number(match[1])) : undefined
                  return evidence ? (
                    <button
                      className="recall-citation rounded bg-violet-100 px-1.5 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-200"
                      aria-label={`Show source ${evidence.citation}`}
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
          <div className="recall-sources">
            <button
              className="flex w-full items-center justify-between text-sm font-medium"
              onClick={() => setSourcesOpen(value => !value)}
              aria-expanded={sourcesOpen}
            >
              <span className="flex items-center gap-2">
                <Layers3 size={14} />
                Sources <span className="recall-count">{latest.sources.length}</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {sourcesOpen && (
              <div className="recall-source-grid">
                {latest.sources.map(source => (
                  <div
                    key={`${source.citation}-${source.clipId}`}
                    className="recall-source-card"
                    data-excluded={!selected.has(source.clipId)}
                  >
                    <button
                      role="checkbox"
                      aria-checked={selected.has(source.clipId)}
                      aria-label={`Include source ${source.citation}`}
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
                <div className="recall-source-actions flex flex-wrap gap-2 pt-1">
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
        {latest.answer && (
          <div className="recall-copy-actions flex flex-wrap gap-1">
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
          </div>
        )}
      </div>

      <footer className="recall-footer">
        {isRunning && (
          <button
            onClick={onCancel}
            className="recall-stop flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        )}
        <div className="recall-composer">
          <textarea
            aria-label="Ask a follow-up"
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
            className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-5 outline-none placeholder:text-gray-500"
          />
          <button
            onClick={submit}
            disabled={!followUp.trim() || isRunning}
            aria-label="Send follow-up"
            title="Send follow-up"
            className="recall-send"
          >
            <ArrowUp size={17} />
          </button>
        </div>
        <div className="recall-footer-meta">
          <span title={latest.model ?? undefined}>
            {latest.providerId
              ? `${latest.executionLocation === 'local' ? 'On this device' : 'Remote'} · ${latest.model}`
              : 'Temporary conversation'}
          </span>
          <span className="recall-key-hint">Ctrl/Cmd + Enter</span>
        </div>
      </footer>

      {openEvidence && (
        <aside className="recall-evidence absolute inset-0 z-20 flex flex-col bg-white/95 p-5 backdrop-blur-xl dark:bg-slate-950/95">
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
            <button
              aria-label="Close evidence"
              onClick={() => setOpenEvidence(null)}
              className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <pre className="custom-scrollbar mt-4 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200/60 bg-slate-100/70 p-4 text-[13px] leading-relaxed dark:border-white/10 dark:bg-white/5">
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
