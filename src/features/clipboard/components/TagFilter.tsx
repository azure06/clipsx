import { ChevronDown, Tags, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { Button } from '../../../shared/components/ui'
import { TagPicker } from './TagPicker'

export const TagFilter = () => {
  const { t } = useTranslation()
  const tags = useClipboardStore(state => state.availableTags)
  const filter = useClipboardStore(state => state.tagFilter)
  const setFilter = useClipboardStore(state => state.setTagFilter)
  const deleteTag = useClipboardStore(state => state.deleteAvailableTag)
  const selected = tags.find(tag => tag.id === filter)
  return (
    <div className="ml-auto flex min-w-0 max-w-full items-center gap-0.5">
      <TagPicker
        selectedIds={filter ? [filter] : []}
        onChoose={tag => setFilter(tag?.id ?? null)}
        onDelete={deleteTag}
        trigger={
          <Button
            size="sm"
            variant={filter ? 'secondary' : 'ghost'}
            aria-label={t('clipboard.filterByTag')}
            className={`min-w-0 max-w-40 gap-1.5 px-2 ${filter ? 'text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400'}`}
            leftIcon={<Tags aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
            rightIcon={<ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />}
          >
            <span className="truncate">{selected?.name ?? t('clipboard.tags')}</span>
          </Button>
        }
      />
      {filter && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 px-1.5"
          aria-label={t('clipboard.clearFilter')}
          onClick={() => void setFilter(null)}
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
