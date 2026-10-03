import { useTranslation } from 'react-i18next'
import i18n from '../../i18n/index'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../../shared/components/ui'
import { describeFailure } from './failures'

export function FailureNotice({ reason, packageId }: { reason: string | null; packageId: string }) {
  useTranslation()

  const failure = describeFailure(reason)
  const setActiveView = useUIStore(state => state.setActiveView)
  const openExtensionSettings = useUIStore(state => state.openExtensionSettings)
  return (
    <div className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
      <p>{failure.message}</p>
      {failure.action && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-xs"
          onClick={() =>
            failure.action === 'generation'
              ? setActiveView('intelligence')
              : openExtensionSettings({ packageId, section: 'permissions' })
          }
        >
          {failure.action === 'generation'
            ? i18n.t('desktopUi.localTextGeneration')
            : i18n.t('desktopUi.reviewPermissions')}
        </Button>
      )}
    </div>
  )
}
