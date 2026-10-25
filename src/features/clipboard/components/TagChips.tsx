import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { V2Tag } from '../../../shared/types/v2'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { Button } from '../../../shared/components/ui'
import { TagBadge } from './TagBadge'
import { TagPicker } from './TagPicker'

export const TagChips = ({ clipId, tags }: { clipId: string; tags: V2Tag[] }) => {
  const { t } = useTranslation()
  const [removing, setRemoving] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const addTag = useClipboardStore(state => state.addClipTag)
  const removeTag = useClipboardStore(state => state.removeClipTag)
  const createTag = useClipboardStore(state => state.createTagAndAttach)
  const remove = async (id: string) => {
    setRemoving(id)
    setFailed(false)
    try {
      await removeTag(clipId, id)
    } catch {
      setFailed(true)
    } finally {
      setRemoving(null)
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {t('clipboard.tags')}
        </span>
        {tags.map(tag => (
          <TagBadge key={tag.id} tag={tag}>
            <button
              type="button"
              aria-label={t('clipboard.removeTag', { name: tag.name })}
              disabled={removing !== null}
              onClick={() => void remove(tag.id)}
              className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-slate-200"
            >
              <X aria-hidden="true" className="h-2.5 w-2.5" />
            </button>
          </TagBadge>
        ))}
        <TagPicker
          key={clipId}
          selectedIds={tags.map(tag => tag.id)}
          onChoose={tag => (tag ? addTag(clipId, tag) : Promise.resolve())}
          onCreate={name => createTag(clipId, name)}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-1.5 py-1 text-[11px] text-slate-500 dark:text-slate-400"
              leftIcon={<Plus aria-hidden="true" className="h-3 w-3" />}
            >
              {t('clipboard.addTag')}
            </Button>
          }
        />
      </div>
      {failed && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t('clipboard.tagActionError')}
        </p>
      )}
    </div>
  )
}
