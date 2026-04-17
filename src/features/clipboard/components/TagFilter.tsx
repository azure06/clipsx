import { useEffect } from 'react'
import { Trash2, X } from 'lucide-react'
import { useClipboardStore } from '../../../stores/clipboardStore'

export const TagFilter = () => {
  const tags = useClipboardStore(state => state.availableTags)
  const tagFilter = useClipboardStore(state => state.tagFilter)
  const setTagFilter = useClipboardStore(state => state.setTagFilter)
  const refreshAvailableTags = useClipboardStore(state => state.refreshAvailableTags)
  const deleteAvailableTag = useClipboardStore(state => state.deleteAvailableTag)

  useEffect(() => {
    if (tags.length === 0) {
      void refreshAvailableTags()
    }
  }, [tags.length, refreshAvailableTags])

  if (tags.length === 0) return null

  const activeTag = tags.find(tag => tag.id === tagFilter)

  const handleDelete = async (tagId: number) => {
    await deleteAvailableTag(tagId)
  }

  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 overflow-x-auto scrollbar-none">
      {activeTag && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-white shrink-0"
          style={{ backgroundColor: activeTag.color ?? '#6b7280' }}
        >
          {activeTag.name}
          <button
            onClick={() => void setTagFilter(null)}
            className="opacity-70 hover:opacity-100 transition-opacity ml-0.5"
            title="Clear filter"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      )}

      {!activeTag &&
        tags.map(tag => (
          <div key={tag.id} className="inline-flex items-center shrink-0">
            <button
              onClick={() => void setTagFilter(tag.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-l-md text-[10px] font-medium border-y border-l text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-600/40 transition-colors hover:text-white"
              onMouseEnter={event => {
                event.currentTarget.style.backgroundColor = tag.color ?? '#6b7280'
                event.currentTarget.style.borderColor = tag.color ?? '#6b7280'
                event.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={event => {
                event.currentTarget.style.backgroundColor = ''
                event.currentTarget.style.borderColor = ''
                event.currentTarget.style.color = ''
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-sm shrink-0"
                style={{ backgroundColor: tag.color ?? '#6b7280' }}
              />
              {tag.name}
            </button>

            <button
              onClick={() => void handleDelete(tag.id)}
              title="Delete tag globally"
              className="inline-flex items-center px-1 py-0.5 rounded-r-md text-[10px] border-y border-r text-gray-400 border-gray-200/60 dark:border-gray-600/40 hover:text-red-400 hover:border-red-400/40 transition-colors"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
    </div>
  )
}
