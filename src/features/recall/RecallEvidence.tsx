import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'
import type { ClipboardCitation } from './runtime/citations'
import { isRecord } from './runtime/tools'

export function EvidenceMarkdown({
  text,
  citations,
  onCitation,
}: {
  text: string
  citations: ClipboardCitation[]
  onCitation: (citation: ClipboardCitation) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="max-w-none break-words text-sm leading-relaxed [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-slate-200/60 [&_code]:px-1 dark:[&_code]:bg-white/10 [&_pre]:rounded-lg [&_pre]:bg-slate-200/60 [&_pre]:p-3 dark:[&_pre]:bg-white/5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_pre]:max-w-full [&_pre]:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => {
            const citation = citations.find(c => href === `#clip-${c.number}`)
            if (citation)
              return (
                <button
                  type="button"
                  className="mx-0.5 inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-700 outline-none transition-all hover:bg-violet-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-violet-500 active:scale-95 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30"
                  aria-label={t('recallPage.citation', { number: citation.number })}
                  onClick={() => onCitation(citation)}
                >
                  [{citation.number}]
                </button>
              )
            if (href && /^https?:\/\//.test(href))
              return (
                <button
                  type="button"
                  className="break-all font-medium text-violet-600 underline underline-offset-2 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
                  onClick={() =>
                    void invoke('open_external_url', { url: href }).catch(() => undefined)
                  }
                >
                  {children}
                </button>
              )
            return <span>{children}</span>
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** Candidates stream from tool results; they never become citations on their own. */
export function ToolSearchResults({
  result,
  open,
}: {
  result: unknown
  open: (id: string) => void
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  if (!isRecord(result) || !Array.isArray(result['items'])) return null
  const candidates = result['items']
    .flatMap((item: unknown) => {
      if (!isRecord(item) || !isRecord(item['clip']) || typeof item['clip']['id'] !== 'string')
        return []
      return [
        {
          id: item['clip']['id'],
          snippet: typeof item['snippet'] === 'string' ? item['snippet'] : '',
          app:
            typeof item['clip']['sourceAppName'] === 'string'
              ? item['clip']['sourceAppName']
              : null,
          capturedAt:
            typeof item['clip']['capturedAt'] === 'number' ? item['clip']['capturedAt'] : null,
        },
      ]
    })
    .slice(0, 50)
  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-medium text-slate-500">
        <span>{t('recallPage.searchCandidates')}</span>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-white/5">
          {t('recallPage.resultCount', { count: candidates.length })}
        </span>
      </div>
      {!candidates.length && (
        <p className="py-2 text-xs text-slate-500">{t('recallPage.noMatches')}</p>
      )}
      <ul className="max-h-72 space-y-1.5 overflow-y-auto overscroll-contain pr-1 custom-scrollbar">
        {candidates.map(item => (
          <li
            key={item.id}
            className="group rounded-lg border border-slate-200/60 bg-slate-100/30 p-2.5 hover:border-violet-300 dark:border-white/10 dark:bg-slate-100/5 dark:hover:border-violet-500/40"
          >
            <button
              type="button"
              className="block w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
              onClick={() => open(item.id)}
            >
              <span className="line-clamp-2 whitespace-pre-wrap break-words text-xs font-medium text-slate-800 dark:text-slate-200">
                {item.snippet || t('recallPage.imageOrFiles')}
              </span>
              <span className="mt-1 block text-[10px] text-slate-500">
                {item.app ?? t('recallPage.unknownApp')}
                {item.capturedAt !== null
                  ? ' · ' + new Date(item.capturedAt).toLocaleString(i18n.language)
                  : ''}
              </span>
            </button>
            <div className="mt-1.5 flex gap-1 border-t border-slate-100 pt-1 dark:border-white/5">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 rounded-md px-2 text-xs"
                onClick={() => open(item.id)}
              >
                {t('recallPage.preview')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 rounded-md px-2 text-xs"
                onClick={() =>
                  void invoke('execute_clipboard_output', {
                    request: { disposition: 'copy', source: { kind: 'original', clipId: item.id } },
                  }).catch(() => toast({ title: t('recallPage.operationFailed'), type: 'error' }))
                }
              >
                {t('recallPage.copy')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {(result['exhaustive'] === false || typeof result['nextCursor'] === 'string') && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">
          {t('recallPage.retrievalIncomplete')}
        </p>
      )}
    </div>
  )
}
