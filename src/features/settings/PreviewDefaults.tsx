import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { PanelsTopLeft, RotateCcw, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import { SettingsSection } from './components/SettingsPrimitives'

type Preferences = {
  byFacetId: Record<string, string>
  byCapabilityId: Record<string, string>
  byMimeType: Record<string, string>
}
type Renderer = { id: string; displayName: string }
export function PreviewDefaults() {
  const { t } = useTranslation()
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [renderers, setRenderers] = useState<Renderer[]>([])
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError(false)
    void Promise.all([
      invoke<Preferences>('get_renderer_preferences'),
      invoke<Renderer[]>('list_renderer_contributions'),
    ])
      .then(([prefs, items]) => {
        if (active) {
          setPreferences(prefs)
          setRenderers(items)
        }
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [revision])
  const reset = async (scope?: keyof Preferences, key?: string) => {
    if (!preferences || busy) return
    setBusy(true)
    setError(false)
    try {
      // Fetch the latest snapshot so resetting one rule preserves changes made elsewhere.
      const latest = await invoke<Preferences>('get_renderer_preferences')
      const next =
        scope && key
          ? {
              ...latest,
              [scope]: Object.fromEntries(
                Object.entries(latest[scope]).filter(([id]) => id !== key)
              ),
            }
          : { byFacetId: {}, byCapabilityId: {}, byMimeType: {} }
      await invoke('update_renderer_preferences', { preferences: next })
      setPreferences(next)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const rows = preferences
    ? (['byFacetId', 'byCapabilityId', 'byMimeType'] as const).flatMap(scope =>
        Object.entries(preferences[scope])
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, renderer]) => ({ scope, key, renderer }))
      )
    : []
  const contentName = (key: string) =>
    ({
      'core.data.table': t('previewWorkspace.table'),
      'core.data.json': 'JSON',
      'text/html': 'HTML',
      'text/plain': t('previewWorkspace.plainText'),
      'image/png': 'PNG',
      'image/jpeg': 'JPEG',
    })[key] ?? key
  return (
    <SettingsSection
      icon={<PanelsTopLeft size={16} />}
      title={t('previewDefaults.title')}
      description={t('previewDefaults.description')}
    >
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {t('previewDefaults.priority')}
      </p>
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 text-xs text-red-600 dark:text-red-400"
        >
          <span>{t('previewDefaults.error')}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setRevision(value => value + 1)}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {!preferences && !error && (
        <p role="status" className="text-xs text-slate-500">
          {t('common.loading')}
        </p>
      )}
      {preferences && (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200/70 dark:border-white/10">
            {rows.length ? (
              rows.map(row => (
                <div
                  key={row.scope + row.key}
                  className="flex items-center gap-3 border-b border-slate-200/60 p-3 last:border-0 dark:border-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="break-all font-medium text-slate-700 dark:text-slate-200">
                        {contentName(row.key)}
                      </span>
                      <ArrowRight aria-hidden="true" size={12} className="text-slate-400" />
                      <span className="break-all text-violet-700 dark:text-violet-300">
                        {renderers.find(item => item.id === row.renderer)?.displayName ??
                          row.renderer}
                      </span>
                    </div>
                    <details className="mt-1 text-[11px] text-slate-500">
                      <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                        {t(`previewDefaults.${row.scope}`)}
                      </summary>
                      <p className="mt-1 break-all font-mono">
                        {row.key} → {row.renderer}
                      </p>
                    </details>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t('previewDefaults.resetRule', { name: contentName(row.key) })}
                    onClick={() => void reset(row.scope, row.key)}
                    leftIcon={<RotateCcw size={12} />}
                  >
                    {t('previewDefaults.reset')}
                  </Button>
                </div>
              ))
            ) : (
              <p className="px-4 py-5 text-center text-xs text-slate-500">
                {t('previewDefaults.automatic')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-lg text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {t('previewDefaults.changeHint')}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !rows.length}
              onClick={() => void reset()}
            >
              {t('previewDefaults.resetAll')}
            </Button>
          </div>
        </>
      )}
    </SettingsSection>
  )
}
