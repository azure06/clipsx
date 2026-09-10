import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../shared/components/ui'
import { SYNC_APPLIED_EVENT } from '../../../shared/sync/configSync'

type PendingEffect = { id: string; key: string; kind: string; reason: string; quarantined: boolean }

export const PortableRecovery = () => {
  const { t } = useTranslation()
  const [effects, setEffects] = useState<PendingEffect[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const records = await invoke<PendingEffect[]>('sync_recovery', { action: 'list', id: null })
      setEffects(records.filter(record => !record.quarantined))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const onApplied = () => {
      void refresh()
    }
    window.addEventListener(SYNC_APPLIED_EVENT, onApplied)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, onApplied)
  }, [refresh])

  const retry = async () => {
    setBusy(true)
    try {
      await invoke('sync_recovery', { action: 'retry_effects', id: null })
      window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
      await refresh()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (!effects.length && !failed) return null
  return (
    <div className="space-y-2 rounded-lg border border-amber-400 p-3 text-sm" role="status">
      <p>{t('settings.portablePending')}</p>
      <p>{t('settings.portableRecovery')}</p>
      <ul>
        {effects.map(effect => (
          <li key={effect.id}>
            {effect.key}: {effect.reason}
          </li>
        ))}
      </ul>
      {failed && <p role="alert">{t('settings.retryFailed')}</p>}
      <Button disabled={busy} onClick={() => void retry()}>
        {t('settings.retryEffects')}
      </Button>
    </div>
  )
}
