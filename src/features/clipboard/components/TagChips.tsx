import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { V2Tag } from '../../../shared/types/v2'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { useTranslation } from 'react-i18next'
import { dropdownSurfaceClass, suggestionItemClass } from '../../../shared/components/ui'
import { cn } from '../../../shared/utils/cn'

interface TagChipsProps {
  clipId: string
  tags: V2Tag[]
}

export const TagChips = ({ clipId, tags }: TagChipsProps) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const availableTags = useClipboardStore(state => state.availableTags)
  const refreshAvailableTags = useClipboardStore(state => state.refreshAvailableTags)
  const addClipTag = useClipboardStore(state => state.addClipTag)
  const removeClipTag = useClipboardStore(state => state.removeClipTag)
  const createTagAndAttach = useClipboardStore(state => state.createTagAndAttach)

  useEffect(() => {
    if (availableTags.length === 0) {
      void refreshAvailableTags()
    }
  }, [availableTags.length, refreshAvailableTags])

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isEditing])

  const handleRemove = async (tagId: string) => {
    await removeClipTag(clipId, tagId)
  }

  const handleAdd = async (tag: V2Tag) => {
    if (tags.some(existingTag => existingTag.id === tag.id)) return
    await addClipTag(clipId, tag)
    setInputValue('')
    inputRef.current?.focus()
  }

  const handleCreateAndAdd = async () => {
    const name = inputValue.trim().toLowerCase()
    if (!name) return

    const existingTag = availableTags.find(tag => tag.name.toLowerCase() === name)
    if (existingTag) {
      await handleAdd(existingTag)
      return
    }

    await createTagAndAttach(clipId, name)
    setInputValue('')
    inputRef.current?.focus()
  }

  const filteredSuggestions = availableTags.filter(
    tag =>
      !tags.some(existingTag => existingTag.id === tag.id) &&
      tag.name.toLowerCase().startsWith(inputValue.toLowerCase())
  )
  const visibleSuggestions = filteredSuggestions.slice(0, 6)
  const normalizedInput = inputValue.trim().toLowerCase()
  const canCreate = Boolean(
    normalizedInput && !availableTags.some(tag => tag.name.toLowerCase() === normalizedInput)
  )
  const suggestionCount = visibleSuggestions.length + (canCreate ? 1 : 0)
  const showSuggestions = Boolean(inputValue && suggestionCount > 0)
  const suggestionListId = `tag-suggestions-${clipId}`

  const selectSuggestion = (index: number) => {
    const tag = visibleSuggestions[index]
    if (tag) {
      void handleAdd(tag)
    } else if (canCreate && index === visibleSuggestions.length) {
      void handleCreateAndAdd()
    }
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none min-h-5.5">
      {tags.map(tag => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-white shrink-0"
          style={{ backgroundColor: tag.color ?? '#6b7280' }}
        >
          {tag.name}
          <button
            onClick={event => {
              event.stopPropagation()
              void handleRemove(tag.id)
            }}
            className="opacity-60 hover:opacity-100 transition-opacity ml-0.5"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {isEditing ? (
        <div className="relative shrink-0">
          <input
            ref={inputRef}
            value={inputValue}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls={showSuggestions ? suggestionListId : undefined}
            aria-activedescendant={
              showSuggestions ? `${suggestionListId}-option-${selectedSuggestionIndex}` : undefined
            }
            onChange={event => {
              setInputValue(event.target.value)
              setSelectedSuggestionIndex(0)
            }}
            onKeyDown={event => {
              event.stopPropagation()
              if (showSuggestions && event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedSuggestionIndex(index => (index + 1) % suggestionCount)
                return
              }
              if (showSuggestions && event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedSuggestionIndex(index => (index - 1 + suggestionCount) % suggestionCount)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (showSuggestions) {
                  selectSuggestion(selectedSuggestionIndex)
                } else {
                  void handleCreateAndAdd()
                }
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setIsEditing(false)
                setInputValue('')
              }
            }}
            onBlur={() => {
              setTimeout(() => {
                setIsEditing(false)
                setInputValue('')
              }, 150)
            }}
            placeholder={t('clipboard.tagPlaceholder')}
            className="text-[10px] px-2 py-0.5 rounded-md border border-blue-400/40 bg-blue-500/10 text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none w-24"
          />
          {showSuggestions && (
            <div
              id={suggestionListId}
              role="listbox"
              className={cn(dropdownSurfaceClass, 'absolute top-full left-0 mt-1 min-w-32 p-1')}
            >
              {visibleSuggestions.map((tag, index) => (
                <button
                  key={tag.id}
                  id={`${suggestionListId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selectedSuggestionIndex === index}
                  onMouseEnter={() => setSelectedSuggestionIndex(index)}
                  onMouseDown={event => {
                    event.preventDefault()
                    void handleAdd(tag)
                  }}
                  className={cn(
                    suggestionItemClass,
                    'w-full gap-2 py-1.5 text-[11px]',
                    selectedSuggestionIndex === index &&
                      'bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200'
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: tag.color ?? '#6b7280' }}
                  />
                  {tag.name}
                </button>
              ))}
              {canCreate && (
                <button
                  id={`${suggestionListId}-option-${visibleSuggestions.length}`}
                  type="button"
                  role="option"
                  aria-selected={selectedSuggestionIndex === visibleSuggestions.length}
                  onMouseEnter={() => setSelectedSuggestionIndex(visibleSuggestions.length)}
                  onMouseDown={event => {
                    event.preventDefault()
                    void handleCreateAndAdd()
                  }}
                  className={cn(
                    suggestionItemClass,
                    'w-full gap-2 border-t border-slate-200/70 py-1.5 text-[11px] text-violet-600 dark:border-white/10 dark:text-violet-400',
                    selectedSuggestionIndex === visibleSuggestions.length &&
                      'bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200'
                  )}
                >
                  <Plus className="h-3 w-3" />
                  {t('clipboard.createTag', { name: inputValue.trim() })}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={event => {
            event.stopPropagation()
            setIsEditing(true)
          }}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] text-gray-500 hover:text-gray-800 border border-transparent hover:border-slate-300/80 transition-colors shrink-0 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600/50"
        >
          <Plus className="h-3 w-3" />
          {t('clipboard.tag')}
        </button>
      )}
    </div>
  )
}
