import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import { AutomationAttemptList } from '../extensions/AutomationAttemptList'
import { retryAutomation, type AutomationAttempt } from '../extensions/automationAttempts'

export function ClipAutomationActivity({ clipId }: { clipId: string }) {
  const { t } = useTranslation()
  const [attempts, setAttempts] = useState<AutomationAttempt[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryFailed, setRetryFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let disposed = false
    let sequence = 0
    const refresh = () => {
      if (disposed) return
      const request = ++sequence
      void invoke<AutomationAttempt[]>('list_clip_automation_attempts', { clipId })
        .then(next => {
          if (disposed || request !== sequence) return
          setAttempts(next)
          setLoadFailed(false)
        })
        .catch(() => {
          if (!disposed && request === sequence) setLoadFailed(true)
        })
    }
    const listeners = [
      listen<string>('clip-automation-updated', event => {
        if (event.payload === clipId) refresh()
      }),
      listen<{ clipId: string }>('extension-job-updated', event => {
        if (event.payload.clipId === clipId) refresh()
      }),
    ]
    const subscriptions = Promise.allSettled(listeners)
    void subscriptions.then(refresh)
    return () => {
      disposed = true
      void subscriptions.then(results => {
        for (const result of results) {
          if (result.status === 'fulfilled') result.value()
        }
      })
    }
  }, [clipId, revision])

  const retry = async (attempt: AutomationAttempt) => {
    setBusy(true)
    setRetryFailed(false)
    try {
      await retryAutomation(attempt)
      setRevision(current => current + 1)
    } catch {
      setRetryFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (!attempts?.length && !loadFailed) return null
  return (
    <details className="border-t border-slate-200/60 py-2.5 dark:border-white/5">
      <summary className="cursor-pointer rounded text-xs font-medium focus-visible:outline-violet-500">
        {t('automationRules.clipActivity')}
      </summary>
      {loadFailed && (
        <div role="alert" className="flex items-center gap-2 py-2 text-xs text-slate-500">
          {t('automationRules.activityUnavailable')}
          <Button variant="ghost" size="sm" onClick={() => setRevision(current => current + 1)}>
            {t('desktopUi.retry')}
          </Button>
        </div>
      )}
      {attempts && (
        <AutomationAttemptList
          attempts={attempts}
          busy={busy}
          onRetry={attempt => void retry(attempt)}
        />
      )}
      {retryFailed && (
        <p role="alert" className="py-2 text-xs text-amber-700 dark:text-amber-300">
          {t('automationRules.retryFailed')}
        </p>
      )}
    </details>
  )
}
