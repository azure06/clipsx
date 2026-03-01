import { memo } from 'react'
import type { ClipItem, Tag, Collection } from '../../../shared/types'
import { formatClipPreview } from '../../../shared/types'
import { Star, Sparkles, Pin, Hash, Command, CornerDownLeft } from 'lucide-react'
import { ContentIcon, clipToContent } from '../../content'

type ClipboardListItemProps = {
  readonly clip: ClipItem & { readonly tags?: Tag[]; readonly collections?: Collection[] }
  readonly onCopy: (text: string, id: string) => void
  readonly onSelect?: (text: string, id: string) => void
  readonly onDoubleClick?: (text: string, id: string) => void
  readonly isSelected?: boolean
  readonly index?: number
}

const ClipboardListItemComponent = ({
  clip,
  onCopy,
  onSelect,
  onDoubleClick,
  isSelected = false,
  index,
}: ClipboardListItemProps) => {
  const preview = formatClipPreview(clip, 100)

  const isPinned = Boolean(clip.isPinned)
  const isFavorite = Boolean(clip.isFavorite)
  const tags = clip.tags ?? []
  const collections = clip.collections ?? []
  const hasAttributes =
    isPinned ||
    isFavorite ||
    tags.length > 0 ||
    collections.length > 0 ||
    Boolean(clip.hasEmbedding)

  const handleClick = () => {
    if (onSelect) {
      onSelect(clip.contentText ?? '', clip.id)
    } else {
      onCopy(clip.contentText ?? '', clip.id)
    }
  }

  return (
    <>
      <div
        onClick={handleClick}
        onDoubleClick={() => clip.contentText && onDoubleClick?.(clip.contentText, clip.id)}
        data-clip-index={index}
        className={`group relative flex items-center gap-3 py-2 px-3 transition-all duration-200 cursor-pointer mx-2 my-0.5 rounded-lg border ${
          isSelected
            ? 'bg-linear-to-r from-blue-100/40 dark:from-blue-500/20 to-violet-100/40 dark:to-violet-500/20 border-blue-200/60 dark:border-blue-500/30 backdrop-blur-md shadow-sm'
            : isPinned
              ? 'bg-violet-50/40 dark:bg-violet-500/5 border-violet-200/50 dark:border-violet-500/10'
              : 'bg-transparent border-transparent hover:bg-slate-100/50 dark:hover:bg-slate-100/5 hover:border-gray-100/60 dark:hover:border-gray-100/5 hover:shadow-sm dark:hover:shadow-none'
        }`}
      >
        {/* Accent border for pinned items */}
        {isPinned && (
          <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-violet-400/50 dark:bg-violet-400/50"></div>
        )}

        {/* Type icon */}
        <div className="shrink-0 text-gray-500 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
          <ContentIcon content={clipToContent(clip)} size="sm" />
        </div>

        {/* Main content area - Horizontal Flow */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          {/* Preview text - Strictly 1 line */}
          <span
            className={`truncate text-xs ${isSelected ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}
          >
            {preview}
          </span>

          {typeof clip.similarityScore === 'number' && clip.similarityScore > 0 && (
            <div
              className="flex items-center gap-0.5 px-1.5 py-px rounded border text-[10px] font-bold shadow-sm whitespace-nowrap shrink-0 ml-1"
              style={{
                background: 'linear-gradient(to right, rgba(139,92,246,0.1), rgba(236,72,153,0.1))',
                borderColor: 'rgba(236,72,153,0.2)',
                color: '#ec4899', // Pinkish text to match gradient
              }}
              title={`Semantic Match Score: ${Math.round(clip.similarityScore * 100)}%`}
            >
              <Sparkles className="h-2.5 w-2.5 inline mr-0.5" strokeWidth={3} />
              {Math.round(clip.similarityScore * 100)}%
            </div>
          )}
        </div>

        {/* Far Right Area: Shortcut, Icons, Enter Key */}
        <div className="flex items-center gap-2 shrink-0 ml-auto pl-2">
          {/* Attributes - Right Aligned */}
          {hasAttributes && (
            <div className="flex items-center gap-1.5 shrink-0 opacity-70">
              {isPinned && <Pin className="h-3 w-3 text-violet-500" strokeWidth={2.5} />}
              {isFavorite && (
                <Star className="h-3 w-3 text-amber-500 fill-amber-500" strokeWidth={2.5} />
              )}
              {tags.length > 0 && <Hash className="h-3 w-3 text-blue-400" strokeWidth={2.5} />}
              {clip.hasEmbedding && (
                <span title="Semantic Search Indexed">
                  <svg width="0" height="0" className="absolute">
                    <linearGradient
                      id={`sparkle-grad-${clip.id}`}
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop stopColor="#3b82f6" offset="0%" />
                      <stop stopColor="#8b5cf6" offset="50%" />
                      <stop stopColor="#ec4899" offset="100%" />
                    </linearGradient>
                  </svg>
                  <Sparkles
                    className="h-3.5 w-3.5"
                    strokeWidth={2.5}
                    style={{ stroke: `url(#sparkle-grad-${clip.id})` }}
                  />
                </span>
              )}
            </div>
          )}

          {/* Shortcut / Action Hint */}
          {isSelected || (index !== undefined && index >= 0 && index < 9) ? (
            <div className="flex shrink-0 items-center justify-center h-5 min-w-5 px-1.5 rounded border border-gray-300/60 dark:border-gray-700/50 bg-slate-50/60 dark:bg-slate-800/50 text-[10px] font-medium text-gray-600 dark:text-gray-400 shadow-sm transition-opacity">
              {isSelected ? (
                <CornerDownLeft
                  className="h-3 w-3 opacity-70 text-blue-500 dark:text-blue-400"
                  strokeWidth={2.5}
                />
              ) : (
                <>
                  <Command className="w-2.5 h-2.5 mr-0.5 opacity-70" />
                  <span className="opacity-70">{index! + 1}</span>
                </>
              )}
            </div>
          ) : (
            <div className="h-5 w-5 shrink-0 opacity-0 pointer-events-none" /> /* Placeholder space to prevent jump */
          )}
        </div>
      </div>
    </>
  )
} // Memoize the component to prevent re-renders when other items change
export const ClipboardListItem = memo(ClipboardListItemComponent)
