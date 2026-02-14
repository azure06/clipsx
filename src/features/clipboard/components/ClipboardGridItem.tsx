import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ClipItem, Tag, Collection } from '../../../shared/types'
import { formatTimestamp } from '../../../shared/types'
import { Star, Copy, Trash, MoreVertical, Sparkles, Pin, Folder, Hash } from 'lucide-react'
import { getThumbnailPath, getAssetUrl } from '../utils'

type ClipboardGridItemProps = {
  readonly clip: ClipItem & { readonly tags?: Tag[]; readonly collections?: Collection[] }
  readonly onCopy: (text: string) => void
  readonly onDelete: (id: string) => void
  readonly onToggleFavorite: () => void
  readonly onTogglePin: () => void
}

export const ClipboardGridItem = ({
  clip,
  onCopy,
  onDelete,
  onToggleFavorite,
  onTogglePin,
}: ClipboardGridItemProps) => {
  const timestamp = formatTimestamp(clip.createdAt)
  const thumbnailPath = getThumbnailPath(clip)
  const isFavorite = Boolean(clip.isFavorite)
  const isPinned = Boolean(clip.isPinned)
  const tags = clip.tags ?? []
  const collections = clip.collections ?? []
  const hasAttributes = isPinned || isFavorite || tags.length > 0 || collections.length > 0

  const getContentPreview = () => {
    if (clip.contentType === 'image') {
      return thumbnailPath ? (
        <div className="relative aspect-square overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700/50">
          <img
            src={getAssetUrl(thumbnailPath)}
            alt="Clipboard image"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700/50">
          <span className="text-4xl">🖼️</span>
        </div>
      )
    }

    if (clip.contentType === 'files') {
      return (
        <div className="flex aspect-square items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700/50">
          <span className="text-4xl">📁</span>
        </div>
      )
    }

    // Text content - show preview
    const preview = clip.contentText?.slice(0, 120) || '(empty)'
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 p-4 ring-1 ring-gray-200 dark:ring-gray-700/50">
        <p className="line-clamp-5 text-center text-xs font-medium text-gray-700 dark:text-gray-300 leading-relaxed">
          {preview}
        </p>
      </div>
    )
  }

  return (
    <div
      className={`group relative rounded-xl border transition-all duration-200 shadow-sm hover:shadow-md ${
        isPinned
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
                    onCopy(clip.contentText)
                  }
                }}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                Copy
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onClick={onToggleFavorite}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
              >
                <Star
                  className={`h-3.5 w-3.5 ${isFavorite ? 'fill-amber-500 text-amber-500' : ''}`}
                  strokeWidth={2}
                />
                {isFavorite ? 'Remove Favorite' : 'Add Favorite'}
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onClick={onTogglePin}
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
      <div className="p-2.5 pb-0">{getContentPreview()}</div>

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
