import type { ReactNode } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { useTranslation } from 'react-i18next'
import { Button, Select } from '../../shared/components/ui'
import type { RecallSourceSnapshot } from './contracts.generated'
import { ToolSearchResults } from './RecallEvidence'
import { SavedSource } from './SavedSource'
import { readCitations } from './runtime/citations'
import { isRecord } from './runtime/tools'

export type ContextSelection = {
  messageId: string | null
  citation: number | null
  activation: number
}

/** This view observes the existing agent transcript; it never executes a second tool loop. */
export function RecallContext({
  threadId,
  sources,
  suggestions,
  preview,
  selection,
  onSelect,
  open,
}: {
  threadId: string
  sources: RecallSourceSnapshot[]
  suggestions?: ReactNode
  preview?: ReactNode
  selection: ContextSelection
  onSelect: (messageId: string | null, citation?: number) => void
  open: (id: string) => void
}) {
  const { t } = useTranslation()
  const messages = useAuiState(s => s.thread.messages)
  const running = useAuiState(s => s.thread.isRunning)
  const answers = messages.filter(message => message.role === 'assistant')
  const latest = answers.at(-1)
  const answer =
    (running ? latest : answers.find(message => message.id === selection.messageId)) ?? latest
  const citations = readCitations(answer?.metadata.custom['citations'])
  const tools = answer?.content.filter(part => part.type === 'tool-call') ?? []
  const searches = tools.filter(part => part.toolName === 'search_clips')
  const citationFor = (source: RecallSourceSnapshot) => {
    try {
      const data: unknown = JSON.parse(source.snapshotJson)
      if (!isRecord(data)) return undefined
      const revision = isRecord(data['clip']) ? data['clip']['revision'] : data['revision']
      return citations.find(item => item.clipId === source.clipId && item.revision === revision)
    } catch {
      return undefined
    }
  }
  const retained = sources.filter(source => source.messageId === answer?.id && citationFor(source))
  // Read results arrive before the final answer/checkpoint. Preserve each page and representation.
  const live = tools.flatMap(part => {
    const result: unknown = part.result
    if (
      !['read_clip', 'read_clip_image'].includes(part.toolName) ||
      !isRecord(result) ||
      result['error'] ||
      !isRecord(result['citation'])
    )
      return []
    const clip = isRecord(result['clip']) ? result['clip'] : null
    const clipId = clip?.['id'] ?? result['clipId']
    if (typeof clipId !== 'string' || !answer) return []
    return [
      {
        id: 'live-' + part.toolCallId,
        messageId: answer.id,
        clipId,
        available: true,
        assetHash: null,
        snapshotJson: JSON.stringify(result),
      } satisfies RecallSourceSnapshot,
    ]
  })
  const sourceIdentity = (source: RecallSourceSnapshot) => {
    try {
      const data: unknown = JSON.parse(source.snapshotJson)
      if (!isRecord(data)) return source.id
      const revision = isRecord(data['clip']) ? data['clip']['revision'] : data['revision']
      return JSON.stringify([
        source.clipId,
        revision,
        data['representationId'],
        data['kind'],
        data['text'],
      ])
    } catch {
      return source.id
    }
  }
  const retainedIdentities = new Set(retained.map(sourceIdentity))
  const evidence = [
    ...retained,
    ...live.filter(source => !retainedIdentities.has(sourceIdentity(source))),
  ].filter(source => citationFor(source))
  const question = answer
    ? messages.slice(0, messages.indexOf(answer)).findLast(message => message.role === 'user')
    : null
  const questionText =
    question?.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join(' ') ?? ''
  if (preview) return <div className="h-full min-h-0">{preview}</div>
  return (
    <div className="h-full min-h-0 overflow-y-auto p-3 custom-scrollbar">
      {answer && (
        <section className="mb-4 space-y-3" aria-label={t('recallContext.answerContext')}>
          <Select
            ariaLabel={t('recallContext.answerContext')}
            value={answer.id}
            onChange={id => onSelect(id)}
            disabled={running}
            options={[...answers].reverse().map((message, index) => {
              const question = messages
                .slice(0, messages.indexOf(message))
                .findLast(item => item.role === 'user')
              const text =
                question?.content
                  .filter(part => part.type === 'text')
                  .map(part => part.text)
                  .join(' ') ?? ''
              return {
                value: message.id,
                label: (index === 0 ? t('recallContext.latest') + ' · ' : '') + text.slice(0, 80),
              }
            })}
          />
          {questionText && (
            <p className="line-clamp-2 break-words text-xs text-slate-500">{questionText}</p>
          )}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t('recallContext.read')}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {t('recallContext.readHelp')}
            </p>
            {!evidence.length && (
              <p className="py-3 text-xs text-slate-500">{t('recallContext.nothingRead')}</p>
            )}
            {evidence.map(source => {
              const citation = citationFor(source)
              return (
                <SavedSource
                  key={source.id}
                  source={source}
                  threadId={threadId}
                  open={open}
                  citation={citation?.number}
                  selected={Boolean(
                    citation &&
                    citation.number === selection.citation &&
                    answer.id === selection.messageId
                  )}
                  activation={selection.activation}
                />
              )
            })}
          </div>
          {searches.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {t('recallContext.found')}
              </h3>
              {searches.map((part, index) => (
                <details
                  key={part.toolCallId}
                  open={running || undefined}
                  className="rounded-lg border border-slate-200/60 p-2 dark:border-white/10"
                >
                  <summary className="cursor-pointer break-words text-xs text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-300">
                    {index + 1}.{' '}
                    {typeof part.args['query'] === 'string'
                      ? part.args['query']
                      : t('recallPage.searchCandidates')}
                  </summary>
                  <ToolSearchResults result={part.result} open={open} />
                </details>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onSelect(null)}
            disabled={running || answer.id === latest?.id}
          >
            {t('recallContext.followLatest')}
          </Button>
        </section>
      )}
      <section className="space-y-2 border-t border-slate-200/60 pt-3 dark:border-white/10">
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {t('recallContext.suggestions')}
        </h3>
        {suggestions}
      </section>
    </div>
  )
}
