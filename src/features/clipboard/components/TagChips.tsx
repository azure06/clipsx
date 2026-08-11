import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { V2Tag } from '../../../shared/types/v2'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { previewTheme } from '../../content/previews/previewTheme'
import { useTranslation } from 'react-i18next'

interface TagChipsProps {
  clipId: string
  tags: V2Tag[]
}

export const TagChips = ({ clipId, tags }: TagChipsProps) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
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
            onChange={event => setInputValue(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleCreateAndAdd()
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
          {filteredSuggestions.length > 0 && inputValue && (
            <div
              className={`absolute left-0 top-full mt-1 z-50 rounded-lg shadow-lg overflow-hidden min-w-32 ${previewTheme.surfaceElevated}`}
            >
              {filteredSuggestions.slice(0, 6).map(tag => (
                <button
                  key={tag.id}
                  onMouseDown={() => void handleAdd(tag)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-700 hover:bg-slate-100 transition-colors dark:text-gray-200 dark:hover:bg-slate-700"
                >
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: tag.color ?? '#6b7280' }}
                  />
                  {tag.name}
                </button>
              ))}
              {inputValue &&
                !availableTags.some(
                  tag => tag.name.toLowerCase() === inputValue.trim().toLowerCase()
                ) && (
                  <button
                    onMouseDown={() => void handleCreateAndAdd()}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-blue-600 hover:bg-slate-100 transition-colors border-t border-slate-200/70 dark:border-white/5 dark:text-blue-400 dark:hover:bg-slate-700"
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
