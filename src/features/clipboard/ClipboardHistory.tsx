import { useEffect, useState, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useClipboardStore } from '../../stores'
import type { ClipItem } from '../../shared/types'
import { Star, Search, RefreshCw, Trash, MoreVertical } from 'lucide-react'
import { Button } from '../../shared/components/ui'
import { ClipboardListView, ClipboardGridView } from './views'
import { ClipboardViewModeSelector } from './components'
import type { ViewMode } from './utils'

// Re-export for backwards compatibility
export { ClipboardListItem } from './components'

export const ClipboardHistory = () => {
  const {
    clips,
    loading,
    error,
    mode,
    loadMoreClips,
    addNewClip,
    deleteClip,
    toggleFavorite,
    togglePin,
    copyToClipboard,
    enterSearchMode,
    exitSearchMode,
  } = useClipboardStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'favorites' | 'code' | 'images'>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('list')

  const loadMoreTriggerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Load initial batch on mount
  useEffect(() => {
    void loadMoreClips(50)
  }, [loadMoreClips])

  // Handle search with debounce
  // NOTE: When semantic search is added, detect queries like "semantic:find code examples"
  // and route to semantic search endpoint instead of FTS
  useEffect(() => {
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Debounce search input (300ms)
    searchTimeoutRef.current = setTimeout(() => {
      if (searchQuery.trim() === '') {
        // Empty query - exit search mode and return to browse
        if (mode === 'search') {
          exitSearchMode()
        }
      } else {
        // Non-empty query - enter search mode with FTS
        void enterSearchMode(searchQuery.trim())
      }
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery, mode, enterSearchMode, exitSearchMode])

  // Listen for new clips from Rust
  useEffect(() => {
    let unlistenFn: (() => void) | undefined

    const setup = async () => {
      unlistenFn = await listen('clipboard_changed', event => {
        addNewClip(event.payload as ClipItem)
      })
    }

    void setup()
    return () => unlistenFn?.()
  }, [addNewClip])

  // Infinite scroll observer
  useEffect(() => {
    const trigger = loadMoreTriggerRef.current
    const scrollContainer = scrollContainerRef.current

    if (!trigger || !scrollContainer) return

    const observer = new IntersectionObserver(
      entries => {
        const isIntersecting = entries[0]?.isIntersecting
        const { loading, hasMore } = useClipboardStore.getState()

        if (!isIntersecting) return
        if (!loading && hasMore) {
          void loadMoreClips(50)
        }
      },
      {
        root: scrollContainer,
        rootMargin: '0px',
        threshold: 0.1,
      }
    )

    observer.observe(trigger)

    return () => observer.disconnect()
  }, [loadMoreClips, viewMode, clips.length])

  const handleCopy = async (text: string, clipId: string) => {
    const result = await copyToClipboard(text, clipId)
    if (!result.ok) {
      console.error('Copy failed:', result.error)
    }
    // Don't refetch - clipboard_changed event will handle it
  }

  const handleDelete = async (id: string) => {
    await deleteClip(id)
  }

  const handleToggleFavorite = (id: string) => {
    void toggleFavorite(id)
  }

  const handleTogglePin = (id: string) => {
    void togglePin(id)
  }

  const handleRefresh = () => {
    // TODO: Implement refresh - reset pagination and reload
    window.location.reload()
  }

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to delete all clipboard items?')) {
      for (const clip of clips) {
        await deleteClip(clip.id)
      }
    }
  }

  // Filter clips - only by activeFilter now, search is handled by backend FTS
  // NOTE: Clips array already contains search results if in search mode
  const filteredClips = clips.filter(clip => {
    const matchesFilter =
      activeFilter === 'all' || (activeFilter === 'favorites' && clip.isFavorite)

    return matchesFilter
  })

  // Render toolbar function for reuse
  const renderToolbar = () => (
    <div className="flex flex-shrink-0 items-center gap-1.5 rounded-br-xl border-t border-gray-800/50 px-2.5 py-2 bg-transparent">
      {/* Search Input */}
      <div className="relative flex-1">
        <Search
          className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500"
          strokeWidth={1.5}
        />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search clips..."
          autoFocus
          className="w-full rounded border border-gray-700 bg-gray-900 py-1 pl-7 pr-2 text-xs text-gray-100 placeholder-gray-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      {/* View Mode Selector */}
      <ClipboardViewModeSelector mode={viewMode} onChange={setViewMode} />

      <div className="h-4 w-px bg-gray-700"></div>

      {/* Filter Types - Grouped */}
      <div className="flex items-center gap-0.5 rounded border border-gray-700 bg-gray-900 p-0.5">
        <Button
          variant={activeFilter === 'all' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setActiveFilter('all')}
          className="!px-1.5 !py-1 !text-[11px]"
        >
          All
        </Button>
        <Button
          variant={activeFilter === 'favorites' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setActiveFilter('favorites')}
          leftIcon={<Star className="h-3 w-3" strokeWidth={1.5} />}
          className="!px-1 !py-1 !text-[11px] !gap-0"
        />
      </div>

      <div className="h-4 w-px bg-gray-700"></div>

      {/* Trash */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void handleClearAll()}
        leftIcon={<Trash className="h-3.5 w-3.5" strokeWidth={1.5} />}
        className="!p-1 text-gray-500 hover:!bg-red-950/20 hover:!text-red-400"
      />

      {/* Sync */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRefresh}
        leftIcon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />}
        className="!p-1 text-gray-500 hover:!text-gray-400"
      />

      {/* Menu */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => alert('Menu coming soon!')}
        leftIcon={<MoreVertical className="h-3.5 w-3.5" strokeWidth={1.5} />}
        className="!p-1 text-gray-500 hover:!text-gray-400"
      />
    </div>
  )

  if (loading && clips.length === 0) {
    return (
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400"></div>
            <p className="text-sm text-gray-400">Loading clipboard history...</p>
          </div>
        </div>
        {renderToolbar()}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-950">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-6 w-6 text-red-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-red-400">Error: {error}</p>
          </div>
        </div>
        {renderToolbar()}
      </div>
    )
  }

  if (clips.length === 0) {
    return (
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center p-12 relative overflow-hidden">
          {/* Content */}
          <div className="text-center relative z-10 flex flex-col items-center">
            {/* Icon */}
            <div
              className="w-32 h-32 mb-4 opacity-30 bg-center bg-no-repeat bg-contain"
              style={{
                backgroundImage: 'url(/monochromatic.svg)',
                filter: 'sepia(1) saturate(1) hue-rotate(180deg) brightness(0.5)',
              }}
            />

            {/* Text */}
            <p className="-mt-4 text-xs text-gray-500">Your clipboard is empty</p>
            <p className="text-xs text-gray-500">Start copying to build your history</p>
          </div>
        </div>
        {renderToolbar()}
      </div>
    )
  }

  // Infinite scroll trigger element
  const infiniteScrollTrigger = (
    <div ref={loadMoreTriggerRef} className="flex justify-center py-4 min-h-[100px]">
      {loading && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400"></div>
          Loading more...
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Main Content - Switch between view modes */}
      {viewMode === 'list' && (
        <ClipboardListView
          clips={filteredClips}
          onCopy={(text, clipId) => void handleCopy(text, clipId)}
          onDelete={id => void handleDelete(id)}
          onToggleFavorite={handleToggleFavorite}
          onTogglePin={handleTogglePin}
          infiniteScrollTrigger={infiniteScrollTrigger}
          scrollContainerRef={scrollContainerRef}
        />
      )}
      {viewMode === 'grid' && (
        <ClipboardGridView
          clips={filteredClips}
          onCopy={(text, clipId) => void handleCopy(text, clipId)}
          onDelete={id => void handleDelete(id)}
          onToggleFavorite={handleToggleFavorite}
          onTogglePin={handleTogglePin}
          infiniteScrollTrigger={infiniteScrollTrigger}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Bottom Toolbar */}
      {renderToolbar()}
    </>
  )
}
