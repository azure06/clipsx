import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../i18n/index'
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
import { DocumentationLink } from '../../shared/components/DocumentationLink'

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
  `${turn.answer}\n\n${i18n.t('desktopUi.sourcesHeading')}\n${turn.sources
    .map(
      source =>
        `[${source.citation}] ${source.sourceAppName ?? source.sourceKind} — ${i18n.t('desktopUi.copiedAt', { date: new Date(source.capturedAt).toLocaleString(i18n.resolvedLanguage) })}\n${source.excerpt}`
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
  useTranslation()

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
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl bg-slate-100/10 p-8 text-center text-sm text-gray-500 dark:bg-slate-100/5">
        <p>
          {expired
            ? i18n.t('desktopUi.thisTemporaryRecallSessionExpiredAskAgainToStart')
            : i18n.t('desktopUi.askAQuestionToRecallSomethingFromYourClipboard')}
        </p>
        <DocumentationLink guide="recall" label={i18n.t('documentation.recallGuide')} />
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
      className="recall-workspace relative flex h-full min-h-0 flex-col overflow-hidden bg-white/55 text-gray-800 dark:bg-slate-950/30 dark:text-gray-200"
    >
      <header className="recall-header">
        <div className="min-w-0">
          {onBack && (
            <button className="mb-2 flex items-center gap-1 text-xs text-gray-500" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              <Trans i18nKey="desktopUi.backToResults" />
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
        <div className="flex flex-wrap items-center justify-end gap-1">
          <DocumentationLink guide="recall" label={i18n.t('documentation.recallGuide')} />
          <button
            onClick={onClear}
            className="recall-new"
            title={i18n.t('desktopUi.newQuestion')}
            aria-label={i18n.t('desktopUi.newQuestion')}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>
              <Trans i18nKey="desktopUi.new" />
            </span>
          </button>
        </div>
      </header>

      <div className="recall-body custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="recall-question" key={latest.requestId}>
          <p className="recall-eyebrow">
            <Trans i18nKey="desktopUi.yourQuestion" />
          </p>
          <h2>{latest.question}</h2>
        </div>
        <div className="recall-answer-label">
          <Sparkles size={13} />
          <span>
            {latest.answer ? i18n.t('desktopUi.answer') : i18n.t('desktopUi.workingOnYourQuestion')}
          </span>
          {latest.sources.length > 0 && (
            <button
              onClick={() => setSourcesOpen(value => !value)}
              className="recall-evidence-count"
            >
              <Layers3 size={12} />
              {latest.sources.length} <Trans i18nKey="desktopUi.sources878a" />
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
              ? i18n.t('desktopUi.writingAnswer')
              : latest.stage === 'preparing_answer' || latest.stage === 'generating'
                ? i18n.t('desktopUi.preparingAnswer')
                : i18n.t('desktopUi.findingRelevantClips')}
          </p>
        )}
        {latest.invalidated && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <Trans i18nKey="desktopUi.aSupportingClipChangedOrWasDeletedThisAnswer" />
          </p>
        )}
        {latest.contextReduced && (
          <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
            <Trans i18nKey="desktopUi.someLowerRankedEvidenceWasOmittedToFitThis" />
          </p>
        )}
        {latest.status === 'incomplete' && (
          <p className="mb-3 text-xs font-medium text-amber-700">
            <Trans i18nKey="desktopUi.incompleteAnswer" />
          </p>
        )}
        {(latest.status === 'error' || latest.status === 'no_evidence') && (
          <div className="rounded-xl bg-slate-100/70 p-4 text-sm dark:bg-white/5">
            <p>{latest.error}</p>
            <button
              className="mt-3 flex items-center gap-1 text-violet-600"
              onClick={() => onRetry(latest)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <Trans i18nKey="desktopUi.retry" />
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
                      aria-label={i18n.t('desktopUi.showSourceNumber', {
                        number: evidence.citation,
                      })}
                      onClick={() => setOpenEvidence(evidence)}
                    >
                      {children}
                    </button>
                  ) : (
                    <span className="text-amber-600" title={i18n.t('desktopUi.unresolvedCitation')}>
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
                        title={i18n.t('desktopUi.copyCode')}
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
                <Trans i18nKey="desktopUi.sources" />{' '}
                <span className="recall-count">{latest.sources.length}</span>
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
                      aria-label={i18n.t('desktopUi.includeSourceNumber', {
                        number: source.citation,
                      })}
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
                    <Trans i18nKey="desktopUi.useOnlyTheseClips" />
                  </button>
                  <button
                    className="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-black/5 dark:text-gray-300"
                    onClick={() => onSearchAll(latest)}
                  >
                    <Trans i18nKey="desktopUi.searchAllHistory" />
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
              <Trans i18nKey="desktopUi.copyAnswer" />
            </button>
            <button
              disabled={!latest.answer}
              onClick={() => void copyLiteralText(withSources(latest))}
              className="rounded-lg px-2.5 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
            >
              <Trans i18nKey="desktopUi.copyWithSources" />
            </button>
          </div>
        )}
      </div>

      <footer className="recall-footer">
        {isRunning && (
          <div className="recall-status-bar">
            <span className="recall-status-dot motion-safe:animate-pulse" />
            <Trans i18nKey="desktopUi.generating" />
            <button onClick={onCancel} className="recall-stop">
              <Square className="h-2.5 w-2.5 fill-current" />
              <Trans i18nKey="desktopUi.stop" />
            </button>
          </div>
        )}
        <div className="recall-composer">
          <textarea
            aria-label={i18n.t('desktopUi.askAFollowUp')}
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
            placeholder={i18n.t('desktopUi.askAFollowUpb8eb')}
            className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-5 outline-none placeholder:text-gray-500"
          />
          <button
            onClick={submit}
            disabled={!followUp.trim() || isRunning}
            aria-label={i18n.t('desktopUi.sendFollowUp')}
            title={i18n.t('desktopUi.sendFollowUp')}
            className="recall-send"
          >
            <ArrowUp size={17} />
          </button>
        </div>
        <div className="recall-footer-meta">
          <span className="recall-model-chip" title={latest.model ?? undefined}>
            {latest.providerId && (
              <span
                className={`recall-model-dot ${latest.executionLocation === 'local' ? 'is-local' : 'is-remote'}`}
              />
            )}
            {latest.providerId
              ? `${latest.executionLocation === 'local' ? i18n.t('desktopUi.onThisDevice') : i18n.t('desktopUi.remote')} · ${latest.model}`
              : i18n.t('desktopUi.temporaryConversation')}
          </span>
          <kbd className="recall-key-hint">Ctrl/Cmd + Enter</kbd>
        </div>
      </footer>

      {openEvidence && (
        <aside className="recall-evidence absolute inset-0 z-20 flex flex-col bg-white/95 p-5 backdrop-blur-xl dark:bg-slate-950/95">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-violet-600">
                <Trans i18nKey="desktopUi.evidence" />
                {openEvidence.citation}]
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {openEvidence.sourceAppName ?? openEvidence.sourceKind}{' '}
                <Trans i18nKey="desktopUi.copied" />{' '}
                {new Date(openEvidence.capturedAt).toLocaleString()}
              </p>
            </div>
            <button
              aria-label={i18n.t('desktopUi.closeEvidence')}
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
            <Trans i18nKey="desktopUi.openClip" />
          </button>
        </aside>
      )}
    </section>
  )
}
