import { useMemo } from 'react'
import type { ClipItem } from '../../shared/types'
import {
  ContentPreview,
  clipToContent,
  getContentDisplayAccentType,
  getContentDisplayLabel,
  getContentSourceLabel,
  getTypeColor,
} from '../content'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { TagChips } from './components/TagChips'
import { NoteField } from './components/NoteField'
import { useClipboardStore } from '../../stores/clipboardStore'
import { useTranslation } from 'react-i18next'

interface ClipPreviewProps {
  clip: ClipItem
}

export const ClipPreview = ({ clip }: ClipPreviewProps) => {
  const { t, i18n } = useTranslation()
  const { deleteClip, togglePin, toggleFavorite } = useClipboardStore()

  // Convert ClipItem to unified Content
  const content = useMemo(() => clipToContent(clip), [clip])
  const typeLabel = getContentDisplayLabel(content)
  const typeAccent = getContentDisplayAccentType(content)
  const sourceLabel = getContentSourceLabel(content)
  const localizedTypeLabel = t(`content.${typeLabel}` as 'content.text')

  const actionContext = useMemo(
    () => ({
      onDelete: (id: string) => deleteClip(id),
      onTogglePin: (id: string) => togglePin(id),
      onToggleFavorite: (id: string) => toggleFavorite(id),
    }),
    [deleteClip, togglePin, toggleFavorite]
  )

  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden my-0.5 mr-2 bg-slate-100/25 dark:bg-slate-100/5 backdrop-blur-xl border border-slate-200/70 dark:border-white/5">
      {/* Header: L2 — slightly more opaque */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100/10 dark:border-slate-100/5 shrink-0 bg-slate-100/40 dark:bg-slate-100/5">
        <div className="flex items-center gap-3">
          {/* Type badge: L3 */}
          <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-100/50 dark:bg-slate-100/10">
            <span className={`w-1.5 h-1.5 rounded-full ${getTypeColor(typeAccent)}`} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-gray-400">
              {localizedTypeLabel}
            </span>
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-500 tabular-nums">
            {new Date(clip.createdAt * 1000).toLocaleString(i18n.resolvedLanguage)}
          </span>
        </div>

        {/* Actions Toolbar - Replaces bottom grid */}
        <div className="flex items-center gap-1">
          <ClipActionsToolbar content={content} context={actionContext} />
        </div>
      </div>

      {/* Main Content Body - Maximized */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-0 relative">
        <ContentPreview content={content} />
      </div>

      {/* Tags & Note Bar */}
      <div className="shrink-0 flex flex-col gap-1.5 px-3 py-2 bg-slate-100/45 dark:bg-black/10 border-t border-slate-200/70 dark:border-slate-100/5">
        <TagChips clipId={clip.id} tags={clip.tags ?? []} />
        <NoteField clipId={clip.id} />
      </div>

      {/* Status Bar: L2 */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1 bg-slate-100/60 dark:bg-black/20 border-t border-slate-200/70 dark:border-slate-100/5 text-[10px] text-gray-600 dark:text-gray-500 font-mono">
        <div className="flex items-center gap-4">
          <span>{t('clipboard.characters', { count: content.text.length })}</span>
          {content.metadata.line_count && (
            <span>{t('clipboard.lines', { count: content.metadata.line_count })}</span>
          )}
          {content.metadata.language && <span>{content.metadata.language}</span>}
          {(clip.ocrStatus === 'pending' || clip.ocrStatus === 'running') && (
            <span className="text-sky-500 dark:text-sky-400 animate-pulse">
              {clip.ocrStatus === 'running' ? t('clipboard.ocrRunning') : t('clipboard.ocrQueued')}
            </span>
          )}
          {clip.ocrStatus === 'failed' && clip.contentType === 'image' && (
            <span className="text-amber-600 dark:text-amber-400">
              {t('clipboard.ocrUnavailable')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {clip.primaryTextSource === 'ocr' && (
            <span className="text-sky-500 dark:text-sky-400 opacity-80">OCR</span>
          )}
          {sourceLabel && (
            <span className="text-gray-600 dark:text-gray-400">
              <span className="opacity-60 mr-1">{t('clipboard.source')}</span>
              {sourceLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
