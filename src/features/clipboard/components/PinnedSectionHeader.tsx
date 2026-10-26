import { ChevronDown, ChevronRight, Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../shared/components/ui'

type Props = {
  collapsed: boolean
  onToggle: () => void
  onViewAll: () => void
  count: number
  loading: boolean
  failed: boolean
  onRetry: () => void
}

export function PinnedSectionHeader({
  collapsed,
  onToggle,
  onViewAll,
  count,
  loading,
  failed,
  onRetry,
}: Props) {
  const { t } = useTranslation()
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <div
      data-history-controls
      className="mx-2 mt-1 mb-1 rounded-lg border border-violet-200/60 bg-violet-50/50 dark:border-violet-400/15 dark:bg-violet-400/5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 px-1 py-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'clipboard.expandPinned' : 'clipboard.collapsePinned')}
          className="gap-2 text-xs text-slate-600 dark:text-slate-300"
        >
          <Chevron size={13} aria-hidden="true" />
          <Pin size={13} className="text-violet-500 dark:text-violet-400" aria-hidden="true" />
          <span>{t('clipboard.pinned')}</span>
          {count > 0 && (
            <span className="rounded bg-violet-100/70 px-1.5 text-[10px] tabular-nums text-violet-600 dark:bg-violet-400/10 dark:text-violet-300">
              {Math.min(count, 3)}
              {count > 3 ? '+' : ''}
            </span>
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs">
          {t('clipboard.viewAllPinned')}
        </Button>
      </div>
      {failed ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-1 px-3 pb-2 text-xs text-slate-500 dark:text-slate-400"
        >
          <span>{t('clipboard.pinnedLoadError')}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : loading && count === 0 ? (
        <p role="status" className="px-3 pb-2 text-xs text-slate-500">
          {t('clipboard.loadingPinned')}
        </p>
      ) : null}
    </div>
  )
}
