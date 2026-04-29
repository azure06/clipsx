import { useEffect } from 'react'
import { X } from 'lucide-react'
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
          <div
            key={tag.id}
            className="group relative inline-flex items-center shrink-0 h-5"
            onMouseEnter={event => {
              const pill = event.currentTarget.querySelector<HTMLElement>('.tag-pill')
              if (pill) {
                pill.style.backgroundColor = tag.color ?? '#6b7280'
                pill.style.borderColor = tag.color ?? '#6b7280'
                pill.style.color = '#fff'
              }
            }}
            onMouseLeave={event => {
              const pill = event.currentTarget.querySelector<HTMLElement>('.tag-pill')
              if (pill) {
                pill.style.backgroundColor = ''
                pill.style.borderColor = ''
                pill.style.color = ''
              }
            }}
          >
            <button
              onClick={() => void setTagFilter(tag.id)}
              className="tag-pill inline-flex items-center gap-1 pl-2 pr-2 group-hover:pr-5 h-full rounded-md text-[10px] font-medium border text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-600/40 transition-[padding,background-color,border-color,color] duration-150"
            >
              <span
                className="w-1.5 h-1.5 rounded-sm shrink-0"
                style={{ backgroundColor: tag.color ?? '#6b7280' }}
              />
              {tag.name}
            </button>
            <button
              onClick={event => {
                event.stopPropagation()
                void handleDelete(tag.id)
              }}
              title="Delete tag"
              className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity text-white/70 hover:text-white"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
    </div>
  )
}
