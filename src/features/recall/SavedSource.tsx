import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import type { RecallSourceSnapshot } from './contracts.generated'
import { isRecord } from './runtime/tools'

export function SavedSource({
  source,
  threadId,
  open,
}: {
  source: RecallSourceSnapshot
  threadId: string
  open: (id: string) => void
}) {
  const { t } = useTranslation()
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  let text = ''
  let kind = ''
  let mimeType = 'image/png'
  try {
    const snapshot: unknown = JSON.parse(source.snapshotJson)
    if (isRecord(snapshot)) {
      if (typeof snapshot['text'] === 'string') text = snapshot['text']
      if (snapshot['mimeType'] === 'image/jpeg') mimeType = 'image/jpeg'
      if (typeof snapshot['kind'] === 'string') kind = snapshot['kind']
    }
  } catch {
    /* Invalid snapshots cannot become executable content. */
  }
  return (
    <details className="my-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-white/10">
      <summary className="cursor-pointer focus-visible:outline-violet-500">
        {t('recallPage.sourcePreview')} · {source.clipId.slice(0, 8)}
        {kind ? ' · ' + kind : ''}
      </summary>
      {source.available ? (
        <Button size="sm" variant="ghost" onClick={() => open(source.clipId)}>
          {t('recallPage.openSource')}
        </Button>
      ) : (
        <p className="mt-2 text-slate-500">{t('recallPage.missingSource')}</p>
      )}
      {text && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">
          {text}
        </pre>
      )}
      {source.assetHash && !image && (
        <Button
          size="sm"
          variant="ghost"
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
          className="mt-2 max-h-80 max-w-full object-contain"
        />
      )}
      {failed && <p role="alert">{t('recallPage.operationFailed')}</p>}
    </details>
  )
}
