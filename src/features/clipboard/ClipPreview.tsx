import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipPresentation, ClipSummary } from '../../shared/types/v2'
import {
  getContentDisplayAccentType,
  getContentDisplayLabel,
  getContentSourceLabel,
  getTypeColor,
} from '../content'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { TagChips } from './components/TagChips'
import { NoteField } from './components/NoteField'
import { presentationToContent, V2ViewPanel } from './V2ViewPanel'
import { useClipboardStore } from '../../stores/clipboardStore'

export const ClipPreview = ({ clip }: { clip: ClipSummary }) => {
  const { t, i18n } = useTranslation()
  const [presentation, setPresentation] = useState<ClipPresentation | null>(null)
  const { deleteClip, togglePin, toggleFavorite } = useClipboardStore()
  const content = useMemo(() => {
    if (!presentation) return null
    const value = presentationToContent(presentation)
    return {
      ...value,
      clip: { ...value.clip, isFavorite: clip.isFavorite, isPinned: clip.isPinned },
    }
  }, [clip.isFavorite, clip.isPinned, presentation])
  const actionContext = useMemo(
    () => ({
      onDelete: (id: string) => deleteClip(id),
      onTogglePin: (id: string) => togglePin(id),
      onToggleFavorite: (id: string) => toggleFavorite(id),
    }),
    [deleteClip, toggleFavorite, togglePin]
  )
  const handlePresentation = useCallback(
    (value: ClipPresentation | null) => setPresentation(value),
    []
  )
  const typeLabel = content ? getContentDisplayLabel(content) : 'text'
  const typeAccent = content ? getContentDisplayAccentType(content) : 'text'
  const sourceLabel = content ? getContentSourceLabel(content) : clip.sourceAppName

  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden my-0.5 mr-2 bg-slate-100/25 dark:bg-slate-100/5 backdrop-blur-xl border border-slate-200/70 dark:border-white/5">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100/10 dark:border-slate-100/5 shrink-0 bg-slate-100/40 dark:bg-slate-100/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-100/50 dark:bg-slate-100/10">
            <span className={`w-1.5 h-1.5 rounded-full ${getTypeColor(typeAccent)}`} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-gray-400">
              {t(`content.${typeLabel}` as 'content.text')}
            </span>
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-500 tabular-nums">
            {new Date(clip.capturedAt).toLocaleString(i18n.resolvedLanguage)}
          </span>
        </div>
        {content && <ClipActionsToolbar content={content} context={actionContext} />}
      </div>

      <div className="flex-1 overflow-hidden p-0 relative">
        <V2ViewPanel key={clip.id} clipId={clip.id} onPresentation={handlePresentation} />
      </div>

      <div className="shrink-0 flex flex-col gap-1.5 px-3 py-2 bg-slate-100/45 dark:bg-black/10 border-t border-slate-200/70 dark:border-slate-100/5">
        <TagChips clipId={clip.id} tags={clip.tags ?? []} />
        <NoteField clipId={clip.id} />
      </div>

      <div className="shrink-0 flex items-center justify-between px-3 py-1 bg-slate-100/60 dark:bg-black/20 border-t border-slate-200/70 dark:border-slate-100/5 text-[10px] text-gray-600 dark:text-gray-500 font-mono">
        <div className="flex items-center gap-4">
          <span>{t('clipboard.characters', { count: content?.text.length ?? 0 })}</span>
          {content?.metadata.line_count && (
            <span>{t('clipboard.lines', { count: content.metadata.line_count })}</span>
          )}
          {content?.metadata.language && <span>{content.metadata.language}</span>}
        </div>
        {sourceLabel && (
          <span>
            <span className="opacity-60 mr-1">{t('clipboard.source')}</span>
            {sourceLabel}
          </span>
        )}
      </div>
    </div>
  )
}
