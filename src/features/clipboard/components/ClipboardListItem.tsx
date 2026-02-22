import { useState, memo } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Toast from '@radix-ui/react-toast'
import type { ClipItem, Tag, Collection } from '../../../shared/types'
import { formatClipPreview } from '../../../shared/types'
import { Star, MoreVertical, Copy, Trash, Sparkles, Pin, Hash, Check } from 'lucide-react'
import { ContentIcon, clipToContent } from '../../content'

type ClipboardListItemProps = {
  readonly clip: ClipItem & { readonly tags?: Tag[]; readonly collections?: Collection[] }
  readonly onCopy: (text: string, id: string) => void
  readonly onSelect?: (text: string, id: string) => void
  readonly onDoubleClick?: (text: string, id: string) => void
  readonly onDelete: (id: string) => void
  readonly onToggleFavorite: (id: string) => void
  readonly onTogglePin: (id: string) => void
  readonly onGenerateEmbedding?: (id: string) => void
  readonly isSelected?: boolean
  readonly index?: number
}

const ClipboardListItemComponent = ({
  clip,
  onCopy,
  onSelect,
  onDoubleClick,
  onDelete,
  onToggleFavorite,
  onTogglePin,
  onGenerateEmbedding,
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

  const [showToast, setShowToast] = useState(false)

  const handleClick = () => {
    if (clip.contentText) {
      if (onSelect) {
        onSelect(clip.contentText, clip.id)
      } else {
        onCopy(clip.contentText, clip.id)
        setShowToast(true)
      }
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
            ? 'bg-gradient-to-r from-blue-500/20 to-violet-500/20 border-blue-200/50 dark:border-blue-500/30'
            : isPinned
              ? 'bg-violet-50/30 dark:bg-violet-500/5 border-violet-100/50 dark:border-violet-500/10'
              : 'bg-transparent border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        {/* Accent border for pinned items */}
        {isPinned && (
          <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-violet-400/50 dark:bg-violet-400/50"></div>
        )}

        {/* Type icon */}
        <div className="shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
          <ContentIcon content={clipToContent(clip)} size="sm" />
        </div>

        {/* Main content area - Horizontal Flow */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          {/* Preview text - Strictly 1 line */}
          <span
            className={`truncate text-xs ${isSelected ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}
          >
            {preview}
          </span>

          {/* Spacer */}
          <div className="flex-1"></div>

          {/* Attributes - Horizontal Row */}
          {hasAttributes && (
            <div className="flex items-center gap-1 shrink-0">
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

          {/* Metadata - Timestamp */}
          <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
            {new Date(clip.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {/* Actions menu - always visible */}
        <div className="flex items-start flex-shrink-0 ml-2" onClick={e => e.stopPropagation()}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="rounded-lg p-1.5 text-gray-400 dark:text-gray-600 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-400 active:scale-95"
                title="Actions"
              >
                <MoreVertical className="h-4 w-4" strokeWidth={2} />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-50 w-48 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 shadow-xl shadow-gray-900/10 dark:shadow-black/50 animate-in fade-in-0 zoom-in-95"
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
                  Copy to Clipboard
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  onClick={() => onToggleFavorite(clip.id)}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${isFavorite ? 'fill-amber-500 text-amber-500' : ''}`}
                    strokeWidth={2}
                  />
                  {isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
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
      </div>

      {/* Toast notification */}
      <Toast.Provider swipeDirection="down">
        <Toast.Root
          open={showToast}
          onOpenChange={setShowToast}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-1.5 shadow-xl flex items-center gap-2.5"
          duration={1500}
        >
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30">
            <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" strokeWidth={2.5} />
          </div>
          <Toast.Title className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Copied to clipboard
          </Toast.Title>
        </Toast.Root>
        <Toast.Viewport className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 m-0 list-none outline-none" />
      </Toast.Provider>
    </>
  )
} // Memoize the component to prevent re-renders when other items change
export const ClipboardListItem = memo(ClipboardListItemComponent)
