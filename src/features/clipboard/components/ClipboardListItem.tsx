import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Toast from '@radix-ui/react-toast'
import type { ClipItem, Tag, Collection } from '../../../shared/types'
import { formatClipPreview, formatTimestamp } from '../../../shared/types'
import { Star, MoreVertical, Copy, Trash, Sparkles, Pin, Folder, Hash, Check } from 'lucide-react'
import { getThumbnailPath, getAssetUrl } from '../utils'

type ClipboardListItemProps = {
  readonly clip: ClipItem & { readonly tags?: Tag[]; readonly collections?: Collection[] }
  readonly onCopy: (text: string) => void
  readonly onDelete: (id: string) => void
  readonly onToggleFavorite: () => void
  readonly onTogglePin: () => void
}

export const ClipboardListItem = ({
  clip,
  onCopy,
  onDelete,
  onToggleFavorite,
  onTogglePin,
}: ClipboardListItemProps) => {
  const preview = formatClipPreview(clip, 100)
  const timestamp = formatTimestamp(clip.createdAt)
  const thumbnailPath = getThumbnailPath(clip)

  const isPinned = Boolean(clip.isPinned)
  const isFavorite = Boolean(clip.isFavorite)
  const tags = clip.tags ?? []
  const collections = clip.collections ?? []
  const hasAttributes = isPinned || isFavorite || tags.length > 0 || collections.length > 0

  const [showToast, setShowToast] = useState(false)

  const handleClick = () => {
    if (clip.contentText) {
      onCopy(clip.contentText)
      setShowToast(true)
    }
  }

  return (
    <>
      <div
        onClick={handleClick}
        className={`group relative flex items-start gap-2.5 border-b border-gray-200 dark:border-gray-800/50 py-2 px-3.5 transition-all duration-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 active:scale-[0.99] overflow-hidden before:absolute before:inset-0 before:bg-gray-300/20 dark:before:bg-gray-700/20 before:rounded-full before:scale-0 before:opacity-0 active:before:scale-[2.5] active:before:opacity-100 before:transition-all before:duration-500 ${
          isPinned ? 'bg-blue-50/50 dark:bg-blue-950/10' : 'bg-white dark:bg-transparent'
        }`}
      >
        {/* Accent border for pinned items */}
        {isPinned && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-violet-500 to-violet-600 dark:from-violet-400 dark:to-violet-500"></div>
        )}

        {/* Thumbnail */}
        {thumbnailPath && (
          <div className="flex-shrink-0 mt-0.5">
            <div className="h-10 w-10 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700/50 shadow-sm">
              <img
                src={getAssetUrl(thumbnailPath)}
                alt="Thumbnail"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 min-w-0">
          {/* Preview text */}
          <div className="mb-1 break-words text-xs leading-normal text-gray-900 dark:text-gray-300 font-medium">
            {preview}
          </div>

          {/* Attributes row - always visible */}
          {hasAttributes && (
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              {isPinned && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-blue-100 to-violet-100 dark:from-blue-900/30 dark:to-violet-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-medium transition-colors">
                  <Pin className="h-2.5 w-2.5" strokeWidth={2.5} />
                  Pinned
                </span>
              )}

              {isFavorite && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium transition-colors">
                  <Star className="h-2.5 w-2.5 fill-current" strokeWidth={2.5} />
                  Favorite
                </span>
              )}

              {tags.slice(0, 3).map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: tag.color ? `${tag.color}15` : undefined,
                    color: tag.color ?? undefined,
                  }}
                >
                  <Hash className="h-2.5 w-2.5" strokeWidth={2.5} />
                  {tag.name}
                </span>
              ))}

              {tags.length > 3 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] font-medium">
                  +{tags.length - 3}
                </span>
              )}

              {collections.slice(0, 2).map(collection => (
                <span
                  key={collection.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[10px] font-medium transition-colors"
                >
                  {collection.icon ? (
                    <span className="text-[10px]">{collection.icon}</span>
                  ) : (
                    <Folder className="h-2.5 w-2.5" strokeWidth={2.5} />
                  )}
                  {collection.name}
                </span>
              ))}

              {collections.length > 2 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] font-medium">
                  +{collections.length - 2}
                </span>
              )}
            </div>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-500">
            <span className="font-medium">{timestamp}</span>
            {clip.accessCount > 0 && (
              <>
                <span className="text-gray-300 dark:text-gray-700">•</span>
                <span>Used {clip.accessCount}×</span>
              </>
            )}
            {clip.appName && (
              <>
                <span className="text-gray-300 dark:text-gray-700">•</span>
                <span className="truncate max-w-[120px]">{clip.appName}</span>
              </>
            )}
          </div>
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
                      onCopy(clip.contentText)
                    }
                  }}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                  Copy to Clipboard
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  onClick={onToggleFavorite}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 outline-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg mx-1"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${isFavorite ? 'fill-amber-500 text-amber-500' : ''}`}
                    strokeWidth={2}
                  />
                  {isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
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
}
