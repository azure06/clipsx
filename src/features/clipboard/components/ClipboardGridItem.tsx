import { memo } from 'react'
import type { ClipSummary } from '../../../shared/types/v2'
import { formatTimestamp } from '../../../shared/types'
import { Star, Pin, Hash } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PreviewLeadingVisual } from './PreviewLeadingVisual'

type ClipboardGridItemProps = {
  readonly clip: ClipSummary
  readonly onCopy: (text: string, id: string) => void
  readonly onSelect?: (text: string, id: string) => void
  readonly onDoubleClick?: (text: string, id: string) => void
  readonly isSelected?: boolean
  readonly index?: number
}

const ClipboardGridItemComponent = ({
  clip,
  onCopy,
  onSelect,
  onDoubleClick,
  isSelected = false,
  index,
}: ClipboardGridItemProps) => {
  const { t, i18n } = useTranslation()
  const timestamp = formatTimestamp(Math.floor(clip.capturedAt / 1000), i18n.resolvedLanguage)
  const preview = clip.historyPreview

  const isFavorite = Boolean(clip.isFavorite)
  const isPinned = Boolean(clip.isPinned)
  const tags = clip.tags ?? []
  const hasAttributes = isPinned || isFavorite || tags.length > 0 || Boolean(clip.note)

  const handleClick = () => {
    if (onSelect) {
      onSelect(preview.title, clip.id)
    } else {
      onCopy(preview.title, clip.id)
    }
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={() => onDoubleClick?.(preview.title, clip.id)}
      data-clip-index={index}
      className={`group relative rounded-xl border transition-all duration-200 shadow-sm hover:shadow-md ${
        isSelected
          ? 'border-blue-400 dark:border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-400/50 dark:ring-blue-500/30'
          : isPinned
            ? 'border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/10'
            : 'border-gray-200 dark:border-gray-800 bg-slate-100/60 dark:bg-slate-900/50 hover:border-gray-300 dark:hover:border-gray-700'
      }`}
    >
      {/* Pinned accent */}
      {isPinned && (
        <div className="absolute left-0 top-0 h-1 w-full rounded-t-xl bg-linear-to-r from-violet-500 to-violet-600 dark:from-violet-400 dark:to-violet-500"></div>
      )}

      {/* Content Preview */}
      <div className="p-2.5 pb-0 flex items-center justify-center aspect-square overflow-hidden">
        <PreviewLeadingVisual clip={clip} preview={preview} size="lg" />
      </div>

      {/* Bottom section with metadata and attributes */}
      <div className="p-2.5 pt-2 space-y-1.5">
        {/* Preview title / subtitle / badge */}
        <div className="space-y-0.5">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-gray-800 dark:text-gray-100">
            {preview.title}
          </p>
          {preview.subtitle && (
            <p className="truncate text-[10px] text-gray-400">{preview.subtitle}</p>
          )}
          {preview.badge && (
            <span className="inline-flex rounded bg-slate-200/70 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
              {preview.badge}
            </span>
          )}
        </div>

        {/* Attributes badges - always visible */}
        {hasAttributes && (
          <div className="flex items-center gap-1 flex-wrap">
            {isPinned && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-linear-to-r from-blue-100 to-violet-100 dark:from-blue-900/30 dark:to-violet-900/30 text-blue-700 dark:text-blue-300 text-[9px] font-medium">
                <Pin className="h-2 w-2" strokeWidth={2.5} />
                {t('clipboard.pin')}
              </span>
            )}

            {isFavorite && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[9px] font-medium">
                <Star className="h-2 w-2 fill-current" strokeWidth={2.5} />
              </span>
            )}

            {tags.slice(0, 2).map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 text-[9px] font-medium"
                style={{
                  backgroundColor: tag.color ? `${tag.color}15` : undefined,
                  color: tag.color ?? undefined,
                }}
              >
                <Hash className="h-2 w-2" strokeWidth={2.5} />
                {tag.name.slice(0, 8)}
              </span>
            ))}

            {tags.length > 2 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 text-[9px] font-medium">
                +{tags.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-500">
          <span className="font-medium">{timestamp}</span>
        </div>
      </div>
    </div>
  )
}

export const ClipboardGridItem = memo(ClipboardGridItemComponent)
