import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import type { RecallSourceSnapshot } from './contracts.generated'
import { isRecord } from './runtime/tools'

export function SavedSource({
  source,
  threadId,
  open,
  citation,
  selected = false,
  activation = 0,
}: {
  source: RecallSourceSnapshot
  threadId: string
  open: (id: string) => void
  citation?: number
  selected?: boolean
  activation?: number
}) {
  const { t } = useTranslation()
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!selected || !details.current) return
    details.current.open = true
    details.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    details.current.querySelector('summary')?.focus()
  }, [selected, activation])
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  let text = ''
  let kind = ''
  let appName = ''
  let mimeType = 'image/png'
  try {
    const snapshot: unknown = JSON.parse(source.snapshotJson)
    if (isRecord(snapshot)) {
      if (typeof snapshot['text'] === 'string') text = snapshot['text']
      if (snapshot['mimeType'] === 'image/jpeg') mimeType = 'image/jpeg'
      if (typeof snapshot['kind'] === 'string') kind = snapshot['kind']
      if (isRecord(snapshot['clip']) && typeof snapshot['clip']['sourceAppName'] === 'string')
        appName = snapshot['clip']['sourceAppName']
    }
  } catch {
    /* Invalid snapshots cannot become executable content. */
  }
  return (
    <details
      ref={details}
      className={`group my-2 rounded-xl border p-2.5 text-xs transition-all duration-200 ${
        selected
          ? 'border-violet-400 bg-violet-50/30 ring-1 ring-violet-500/40 dark:border-violet-500/50 dark:bg-violet-950/20'
          : 'border-slate-200/80 bg-slate-100/30 hover:border-slate-300 dark:border-white/10 dark:bg-slate-100/5 dark:hover:border-white/20'
      }`}
    >
      <summary className="cursor-pointer font-medium text-slate-700 outline-none select-none transition-colors hover:text-slate-900 focus-visible:outline-violet-500 dark:text-slate-300 dark:hover:text-slate-100">
        {citation ? `[${citation}] ` : ''}
        <span className="font-semibold text-slate-800 dark:text-slate-200">
          {appName || `${t('recallOptions.source')} · ${source.clipId.slice(0, 8)}`}
        </span>
        {kind ? (
          <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-slate-400">
            {t(`recallPage.sourceKinds.${kind}`, { defaultValue: kind })}
          </span>
        ) : null}
      </summary>
      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-white/5 space-y-2">
        {source.available ? (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg text-xs"
            onClick={() => open(source.clipId)}
          >
            {t('recallPage.openSource')}
          </Button>
        ) : (
          <p className="text-xs text-slate-500">{t('recallPage.missingSource')}</p>
        )}
        {text && (
          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200/60 bg-slate-50/90 p-2.5 font-mono text-[11px] leading-relaxed text-slate-800 whitespace-pre-wrap break-words dark:border-white/5 dark:bg-slate-950/70 dark:text-slate-200 custom-scrollbar">
            {text}
          </pre>
        )}
        {source.assetHash && !image && (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg text-xs"
            onClick={() => {
              setFailed(false)
              void invoke<string>('recall_snapshot_image', { threadId, snapshotId: source.id })
                .then(data => setImage('data:' + mimeType + ';base64,' + data))
                .catch(() => setFailed(true))
            }}
          >
            {t('recallPage.preview')}
          </Button>
        )}
        {image && (
          <img
            src={image}
            alt={t('recallPage.sourcePreview')}
            className="rounded-lg max-h-80 max-w-full object-contain border border-slate-200/60 dark:border-white/10"
          />
        )}
        {failed && (
          <p role="alert" className="text-xs text-red-500">
            {t('recallPage.operationFailed')}
          </p>
        )}
      </div>
    </details>
  )
}
