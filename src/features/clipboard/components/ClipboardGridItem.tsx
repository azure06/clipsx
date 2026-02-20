import { memo } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ClipItem, Tag, Collection } from '../../../shared/types'
import { formatTimestamp } from '../../../shared/types'
import { Star, Copy, Trash, MoreVertical, Sparkles, Pin, Folder, Hash } from 'lucide-react'
import { ContentIcon, clipToContent } from '../../content'

type ClipboardGridItemProps = {
  readonly clip: ClipItem & { readonly tags?: Tag[]; readonly collections?: Collection[] }
  readonly onCopy: (text: string, id: string) => void
  readonly onSelect?: (text: string, id: string) => void
  readonly onDelete: (id: string) => void
  readonly onToggleFavorite: (id: string) => void
  readonly onTogglePin: (id: string) => void
  readonly onGenerateEmbedding?: (id: string) => void
  readonly isSelected?: boolean
  readonly index?: number
}

const ClipboardGridItemComponent = ({
  clip,
  onCopy,
  onSelect,
  onDelete,
  onToggleFavorite,
  onTogglePin,
  onGenerateEmbedding,
  isSelected = false,
  index,
}: ClipboardGridItemProps) => {
  const timestamp = formatTimestamp(clip.createdAt)

  const isFavorite = Boolean(clip.isFavorite)
  const isPinned = Boolean(clip.isPinned)
  const tags = clip.tags ?? []
  const collections = clip.collections ?? []
  const hasAttributes = isPinned || isFavorite || tags.length > 0 || collections.length > 0 || Boolean(clip.hasEmbedding)

  const handleClick = () => {
    if (clip.contentText) {
      if (onSelect) {
        onSelect(clip.contentText, clip.id)
      } else {
        onCopy(clip.contentText, clip.id)
      }
    }
  }

  return (
    <div
      onClick={handleClick}
      data-clip-index={index}
      className={`group relative rounded-xl border transition-all duration-200 shadow-sm hover:shadow-md ${isSelected
        ? 'border-blue-400 dark:border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-400/50 dark:ring-blue-500/30'
        : isPinned
          ? 'border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 hover:border-gray-300 dark:hover:border-gray-700'
        }`}
    >
      {/* Pinned accent */}
      {isPinned && (
        <div className="absolute left-0 top-0 h-1 w-full rounded-t-xl bg-gradient-to-r from-violet-500 to-violet-600 dark:from-violet-400 dark:to-violet-500"></div>
      )}

      {/* Actions menu - top right */}
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="rounded-lg p-1.5 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm text-gray-400 dark:text-gray-600 transition-all duration-200 hover:bg-white dark:hover:bg-gray-900 hover:text-gray-600 dark:hover:text-gray-400 active:scale-95 shadow-sm"
              title="Actions"
            >
              <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 w-44 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 shadow-xl shadow-gray-900/10 dark:shadow-black/50 animate-in fade-in-0 zoom-in-95"
              sideOffset={6}
              align="end"
              collisionPadding={8}
            >
              <DropdownMenu.Item
                onClick={() => {
                  if (clip.contentText) {
                    onCopy(clip.contentText, clip.id)
                  }
                }}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                Copy
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onClick={() => onToggleFavorite(clip.id)}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
              >
                <Star
                  className={`h-3.5 w-3.5 ${isFavorite ? 'fill-amber-500 text-amber-500' : ''}`}
                  strokeWidth={2}
                />
                {isFavorite ? 'Remove Favorite' : 'Add Favorite'}
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onClick={() => onTogglePin(clip.id)}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
              >
                <Pin
                  className={`h-3.5 w-3.5 ${isPinned ? 'fill-blue-500 text-blue-500' : ''}`}
                  strokeWidth={2}
                />
                {isPinned ? 'Unpin' : 'Pin to Top'}
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="my-1.5 border-t border-gray-200 dark:border-gray-700" />

              <DropdownMenu.Item
                disabled
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-gray-400 dark:text-gray-600 rounded-lg mx-1"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                Fix Grammar
              </DropdownMenu.Item>

              {!clip.hasEmbedding && onGenerateEmbedding && (
                <DropdownMenu.Item
                  onClick={() => onGenerateEmbedding(clip.id)}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-indigo-600 dark:text-indigo-400 outline-none transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/20 focus:bg-indigo-50 dark:focus:bg-indigo-950/20 rounded-lg mx-1"
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                  Generate AI Embedding
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Separator className="my-1.5 border-t border-gray-200 dark:border-gray-700" />

              <DropdownMenu.Item
                onClick={() => onDelete(clip.id)}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-red-600 dark:text-red-400 outline-none transition-colors hover:bg-red-50 dark:hover:bg-red-950/20 focus:bg-red-50 dark:focus:bg-red-950/20 rounded-lg mx-1"
              >
                <Trash className="h-3.5 w-3.5" strokeWidth={2} />
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Content Preview */}
      <div className="p-2.5 pb-0 flex items-center justify-center aspect-square">
        <ContentIcon content={clipToContent(clip)} size="lg" />
      </div>

      {/* Bottom section with metadata and attributes */}
      <div className="p-2.5 pt-2 space-y-1.5">
        {/* Attributes badges - always visible */}
        {hasAttributes && (
          <div className="flex items-center gap-1 flex-wrap">
            {isPinned && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-blue-100 to-violet-100 dark:from-blue-900/30 dark:to-violet-900/30 text-blue-700 dark:text-blue-300 text-[9px] font-medium">
                <Pin className="h-2 w-2" strokeWidth={2.5} />
                Pin
              </span>
            )}

            {isFavorite && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[9px] font-medium">
                <Star className="h-2 w-2 fill-current" strokeWidth={2.5} />
              </span>
            )}

            {clip.hasEmbedding && (
              <span title="Semantic Search Indexed" className="inline-flex relative items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-100/50 dark:bg-indigo-900/20 text-[9px] font-medium border border-indigo-200/50 dark:border-indigo-500/20">
                <svg width="0" height="0" className="absolute">
                  <linearGradient id={`sparkle-grad-grid-${clip.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop stopColor="#3b82f6" offset="0%" />
                    <stop stopColor="#8b5cf6" offset="50%" />
                    <stop stopColor="#ec4899" offset="100%" />
                  </linearGradient>
                </svg>
                <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} style={{ stroke: `url(#sparkle-grad-grid-${clip.id})` }} />
              </span>
            )}

            {typeof clip.similarityScore === 'number' && clip.similarityScore > 0 && (
              <span
                title={`Semantic Match Score: ${Math.round(clip.similarityScore * 100)}%`}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold"
                style={{
                  background: 'linear-gradient(to right, rgba(139,92,246,0.1), rgba(236,72,153,0.1))',
                  borderColor: 'rgba(236,72,153,0.2)',
                  borderWidth: '1px',
                  color: '#ec4899',
                }}
              >
                {Math.round(clip.similarityScore * 100)}% Match
              </span>
            )}

            {tags.slice(0, 2).map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[9px] font-medium"
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
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[9px] font-medium">
                +{tags.length - 2}
              </span>
            )}

            {collections.slice(0, 1).map(collection => (
              <span
                key={collection.id}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[9px] font-medium"
              >
                {collection.icon ? (
                  <span className="text-[9px]">{collection.icon}</span>
                ) : (
                  <Folder className="h-2 w-2" strokeWidth={2.5} />
                )}
                {collection.name.slice(0, 8)}
              </span>
            ))}

            {collections.length > 1 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[9px] font-medium">
                +{collections.length - 1}
              </span>
            )}
          </div>
        )}

        {/* Timestamp and access count */}
        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-500">
          <span className="font-medium">{timestamp}</span>
          {clip.accessCount > 0 && <span>Used {clip.accessCount}×</span>}
        </div>
      </div>
    </div>
  )
}

export const ClipboardGridItem = memo(ClipboardGridItemComponent)
