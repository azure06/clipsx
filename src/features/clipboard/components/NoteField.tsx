import { useState, useEffect, useRef } from 'react'
import { useClipboardStore } from '../../../stores/clipboardStore'

interface NoteFieldProps {
  clipId: string
}

export const NoteField = ({ clipId }: NoteFieldProps) => {
  const note = useClipboardStore(
    state => state.clips.find(clip => clip.id === clipId)?.note ?? null
  )
  const [value, setValue] = useState(note ?? '')
  const [isFocused, setIsFocused] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCommittedRef = useRef<string | null>(note ?? null)
  const pendingCommitRef = useRef<string | null | undefined>(undefined)
  const queuedCommitRef = useRef<string | null | undefined>(undefined)
  const storeNoteRef = useRef<string | null>(note ?? null)
  const { updateClipNote } = useClipboardStore()

  useEffect(() => {
    console.log('[NOTE_DEBUG][NoteField] clip changed / syncing local value', {
      clipId,
      storeNote: note,
      expected: 'local input should reflect the selected clip note when not actively editing',
    })
    setValue(note ?? '')
    setIsSaving(false)
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

    console.log('[NOTE_DEBUG][NoteField] store note observed', {
      clipId,
      storeNote: nextStoreNote,
      isFocused,
      isSaving,
      resolvedPendingCommit,
      expected:
        'after save succeeds, store note should become the saved note and local input should match it',
    })
    storeNoteRef.current = nextStoreNote

    if (resolvedPendingCommit) {
      pendingCommitRef.current = undefined
      setIsSaving(false)
    }

    if (!isFocused || resolvedPendingCommit) {
      setValue(note ?? '')
    }

    lastCommittedRef.current = nextStoreNote
  }, [clipId, note, isFocused])

  const commitNote = async (rawValue: string) => {
    const normalizedValue = rawValue.trim() || null
    console.log('[NOTE_DEBUG][NoteField] commit requested', {
      clipId,
      rawValue,
      normalizedValue,
      lastCommitted: lastCommittedRef.current,
      pendingCommit: pendingCommitRef.current,
      expected:
        'normalizedValue should be sent to the backend only when it differs from the last committed note',
    })
    if (pendingCommitRef.current !== undefined) {
      if (
        pendingCommitRef.current === normalizedValue ||
        queuedCommitRef.current === normalizedValue
      ) {
        console.log('[NOTE_DEBUG][NoteField] commit skipped', {
          clipId,
          normalizedValue,
          expected: 'skip save because this note value is already pending or queued',
        })
        return
      }

      queuedCommitRef.current = normalizedValue
      console.log('[NOTE_DEBUG][NoteField] commit queued', {
        clipId,
        normalizedValue,
        pendingCommit: pendingCommitRef.current,
        expected: 'save should run after the current in-flight request finishes',
      })
      return
    }

    if (lastCommittedRef.current === normalizedValue) {
      console.log('[NOTE_DEBUG][NoteField] commit skipped', {
        clipId,
        normalizedValue,
        expected: 'skip save because the note did not change',
      })
      return
    }

    pendingCommitRef.current = normalizedValue
    lastCommittedRef.current = normalizedValue
    setIsSaving(true)
    try {
      await updateClipNote(clipId, normalizedValue)
      console.log('[NOTE_DEBUG][NoteField] commit completed', {
        clipId,
        normalizedValue,
        expected: 'backend should have saved the note and clipboardStore should soon reflect it',
      })
    } catch (error) {
      console.error('[NOTE_DEBUG][NoteField] commit failed', {
        clipId,
        normalizedValue,
        error,
        expected: 'no error here; failure means the backend save path rejected the note update',
      })
      lastCommittedRef.current = storeNoteRef.current
      throw error
    } finally {
      const queuedValue = queuedCommitRef.current

      if (pendingCommitRef.current === normalizedValue) {
        pendingCommitRef.current = undefined
      }
      queuedCommitRef.current = undefined
      setIsSaving(false)

      if (queuedValue !== undefined && queuedValue !== storeNoteRef.current) {
        void commitNote(queuedValue ?? '').catch(() => {})
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    console.log('[NOTE_DEBUG][NoteField] onChange', {
      clipId,
      typedValue: next,
      expected: 'debounced save should fire after 500ms of inactivity',
    })
    setValue(next)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void commitNote(next).catch(() => {})
    }, 500)
  }

  const handleBlur = () => {
    console.log('[NOTE_DEBUG][NoteField] onBlur', {
      clipId,
      localValue: value,
      expected: 'blur should force one final save attempt with the current input value',
    })
    setIsFocused(false)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    void commitNote(value).catch(() => {})
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 shrink-0 uppercase tracking-wider">Note</span>
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
        placeholder="Add a note... (searchable)"
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
