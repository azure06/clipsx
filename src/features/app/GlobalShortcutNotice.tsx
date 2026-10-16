import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import { useSettingsStore } from '../../stores/settingsStore'

export function GlobalShortcutNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation()
  const failed = useSettingsStore(state => state.failedEffects.includes('shortcut'))
  if (!failed) return null

  return (
    <div
      role="alert"
      className="mx-2 mb-1 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <p className="min-w-0 flex-1">{t('settings.effectRecovery.shortcut')}</p>
      <Button variant="outline" size="sm" onClick={onOpenSettings}>
        {t('settings.shortcutSettings')}
      </Button>
    </div>
  )
}
