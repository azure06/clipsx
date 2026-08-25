import { useState, useEffect, useRef } from 'react'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { useTranslation } from 'react-i18next'

interface NoteFieldProps {
  clipId: string
}

export const NoteField = ({ clipId }: NoteFieldProps) => {
  const { t } = useTranslation()
  const note = useClipboardStore(
    state => state.clips.find(clip => clip.id === clipId)?.note ?? null
  )
  const [value, setValue] = useState(note ?? '')
  const [isFocused, setIsFocused] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCommittedRef = useRef<string | null>(note ?? null)
  const pendingCommitRef = useRef<string | null | undefined>(undefined)
  const queuedCommitRef = useRef<string | null | undefined>(undefined)
  const storeNoteRef = useRef<string | null>(note ?? null)
  const { updateClipNote } = useClipboardStore()

  useEffect(() => {
    setValue(note ?? '')
    lastCommittedRef.current = note ?? null
    pendingCommitRef.current = undefined
    queuedCommitRef.current = undefined
    storeNoteRef.current = note ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId])

  useEffect(() => {
    const nextStoreNote = note ?? null
    const resolvedPendingCommit =
      pendingCommitRef.current !== undefined && pendingCommitRef.current === nextStoreNote

    storeNoteRef.current = nextStoreNote

    if (resolvedPendingCommit) {
      pendingCommitRef.current = undefined
    }

    if (!isFocused || resolvedPendingCommit) {
      setValue(note ?? '')
    }

    lastCommittedRef.current = nextStoreNote
  }, [clipId, note, isFocused])

  const commitNote = async (rawValue: string) => {
    const normalizedValue = rawValue.trim() || null
    if (pendingCommitRef.current !== undefined) {
      if (
        pendingCommitRef.current === normalizedValue ||
        queuedCommitRef.current === normalizedValue
      ) {
        return
      }

      queuedCommitRef.current = normalizedValue
      return
    }

    if (lastCommittedRef.current === normalizedValue) {
      return
    }

    pendingCommitRef.current = normalizedValue
    lastCommittedRef.current = normalizedValue
    try {
      await updateClipNote(clipId, normalizedValue)
    } catch (error) {
      lastCommittedRef.current = storeNoteRef.current
      throw error
    } finally {
      const queuedValue = queuedCommitRef.current

      if (pendingCommitRef.current === normalizedValue) {
        pendingCommitRef.current = undefined
      }
      queuedCommitRef.current = undefined

      if (queuedValue !== undefined && queuedValue !== storeNoteRef.current) {
        void commitNote(queuedValue ?? '').catch(() => {})
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setValue(next)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void commitNote(next).catch(() => {})
    }, 500)
  }

  const handleBlur = () => {
    setIsFocused(false)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    void commitNote(value).catch(() => {})
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 shrink-0 uppercase tracking-wider">
        {t('clipboard.note')}
      </span>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        onKeyDown={e => {
          // Prevent all keys from bubbling to the clip list global handler
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder={t('clipboard.notePlaceholder')}
        className={`flex-1 text-[11px] bg-transparent border-b outline-none py-0.5 transition-colors placeholder-gray-500 text-gray-700 dark:text-gray-300 ${
          isFocused
            ? 'border-blue-400/60'
            : value
              ? 'border-gray-300/30 dark:border-gray-600/30'
              : 'border-transparent'
        }`}
      />
    </div>
  )
}
