import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useClipboardStore } from '../../stores'
import { useSettingsStore } from '../../stores'
import type { ClipItem } from '../../shared/types'
import { ClipboardListView } from './views'
import type { ViewMode } from './utils'

// Re-export for backwards compatibility
// Re-export for backwards compatibility
export { ClipboardListItem } from './components'

interface ClipboardHistoryProps {
  searchQuery?: string
  className?: string
  onPreviewItem?: (clip: ClipItem | null) => void
}

export const ClipboardHistory = ({
  searchQuery = '',
  className,
  onPreviewItem,
}: ClipboardHistoryProps) => {
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
    pasteClip,
    enterSearchMode,
    exitSearchMode,
  } = useClipboardStore()

  const settings = useSettingsStore(state => state.settings)

  // const [searchQuery, setSearchQuery] = useState('') // Controlled via props now
  // Hardcoded for now as UI controls were removed
  const activeFilter = 'all'
  const viewMode: ViewMode = 'list'

  const [selectedIndex, setSelectedIndex] = useState(0)

  const loadMoreTriggerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<number | null>(null)
  // const searchInputRef = useRef<HTMLInputElement>(null) // Input is now external

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

  // Unified action handler for Click and Enter
  const handleAction = useCallback(
    async (text: string, clipId: string) => {
      // Primary Action: Paste (default)
      if (settings?.paste_on_enter) {
        await pasteClip(text, clipId)
      } else {
        // Primary Action: Copy
        await copyToClipboard(text, clipId)
        // Hide if "Hide after Copy" is enabled
        if (settings?.hide_on_copy) {
          void getCurrentWindow().hide()
        }
      }
    },
    [settings, pasteClip, copyToClipboard]
  )

  // Explicit Copy handler (always copies, never pastes)
  const handleExplicitCopy = useCallback(
    async (text: string, clipId: string) => {
      await copyToClipboard(text, clipId)
      // Optional: Hide after explicit copy? User settings might apply here too.
      // If "Hide after Copy" is ON, we should probably hide.
      if (settings?.hide_on_copy) {
        void getCurrentWindow().hide()
      }
    },
    [settings, copyToClipboard]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteClip(id)
    },
    [deleteClip]
  )

  const handleToggleFavorite = useCallback(
    (id: string) => {
      void toggleFavorite(id)
    },
    [toggleFavorite]
  )

  const handleTogglePin = useCallback(
    (id: string) => {
      void togglePin(id)
    },
    [togglePin]
  )

  const handleGenerateEmbedding = useCallback((id: string) => {
    const { generateEmbedding } = useClipboardStore.getState()
    if (generateEmbedding) {
      void generateEmbedding(id)
    }
  }, [])

  // Stable handlers for child components to avoid Promise/void lint errors and ensure memoization
  // Stable handlers for child components to avoid Promise/void lint errors and ensure memoization
  const onSelectHandler = useCallback(
    (_text: string, clipId: string) => {
      // Single Click: Just select for preview
      const index = clips.findIndex(c => c.id === clipId)
      if (index !== -1) {
        setSelectedIndex(index)
      }
    },
    [clips]
  )

  const onDoubleClickHandler = useCallback(
    (text: string, clipId: string) => {
      // Double Click: Perform primary action (Copy/Paste)
      void handleAction(text, clipId)
    },
    [handleAction]
  )

  const onCopyHandler = useCallback(
    (text: string, clipId: string) => {
      void handleExplicitCopy(text, clipId)
    },
    [handleExplicitCopy]
  )

  const onDeleteHandler = useCallback(
    (id: string) => {
      void handleDelete(id)
    },
    [handleDelete]
  )

  // Filter clips - only by activeFilter now, search is handled by backend FTS
  // NOTE: Clips array already contains search results if in search mode
  // Filter clips - only by activeFilter now, search is handled by backend FTS
  // NOTE: Clips array already contains search results if in search mode
  const filteredClips = useMemo(
    () =>
      clips.filter(clip => {
        const matchesFilter =
          activeFilter === 'all' || (activeFilter === 'favorites' && clip.isFavorite)

        return matchesFilter
      }),
    [clips, activeFilter]
  )

  // Reset selection when filtered clips change
  useEffect(() => {
    if (filteredClips.length > 0 && selectedIndex >= filteredClips.length) {
      setSelectedIndex(0) // Reset if out of bounds
    } else if (filteredClips.length > 0 && selectedIndex === -1) {
      setSelectedIndex(0)
    }
  }, [filteredClips, selectedIndex])

  // Auto-scroll selected item into view
  const scrollSelectedIntoView = useCallback((index: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    const el = container.querySelector(`[data-clip-index="${index}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focus is inside any text input EXCEPT for the main search input
      const active = document.activeElement
      const isInput = active instanceof HTMLInputElement

      if (active instanceof HTMLTextAreaElement || (active as HTMLElement)?.isContentEditable) {
        return
      }

      // If active is our search input, only allow arrows, enter, escape, and cmd+number
      if (isInput) {
        if (
          !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key) &&
          !e.metaKey &&
          !e.ctrlKey
        ) {
          return
        }
      } else {
        // Allow Escape to blur from non-input focusable elements just in case
        if (e.key === 'Escape' && active instanceof HTMLElement) {
          active.blur()
          e.preventDefault()
          return
        }
      }

      // Handle Cmd+1 to Cmd+9
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const index = parseInt(e.key, 10) - 1
        const clip = filteredClips[index]
        if (clip) {
          void handleAction(clip.contentText ?? '', clip.id)
        }
        return
      }

      const maxIndex = filteredClips.length - 1
      if (maxIndex < 0) return

      switch (e.key) {
        case 'ArrowUp':
        case 'k': {
          e.preventDefault()
          setSelectedIndex(prev => {
            const next = Math.max(0, prev - 1)
            scrollSelectedIntoView(next)
            return next
          })
          break
        }
        case 'ArrowDown':
        case 'j': {
          e.preventDefault()
          setSelectedIndex(prev => {
            const next = Math.min(maxIndex, prev + 1)
            scrollSelectedIntoView(next)
            return next
          })
          break
        }
        case 'Enter': {
          e.preventDefault()
          const clip = filteredClips[selectedIndex]
          if (clip) {
            void handleAction(clip.contentText ?? '', clip.id)
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          e.preventDefault()
          const clip = filteredClips[selectedIndex]
          if (clip) {
            void handleDelete(clip.id)
            // Adjust index if we deleted the last item
            setSelectedIndex(prev => Math.min(prev, maxIndex - 1))
          }
          break
        }
        case 'f': {
          const clip = filteredClips[selectedIndex]
          if (clip) handleToggleFavorite(clip.id)
          break
        }
        case 'p': {
          const clip = filteredClips[selectedIndex]
          if (clip) handleTogglePin(clip.id)
          break
        }
        case '/': {
          // Focus search input - Handled by global layout now
          e.preventDefault()
          // searchInputRef.current?.focus()
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    filteredClips,
    selectedIndex,
    scrollSelectedIntoView,
    handleAction,
    handleDelete,
    handleToggleFavorite,
    handleTogglePin,
  ])

  // ADDED: Notify parent of selection change for preview
  useEffect(() => {
    if (onPreviewItem) {
      if (filteredClips.length > 0 && selectedIndex >= 0) {
        const selectedClip = filteredClips[selectedIndex]
        if (selectedClip) {
          onPreviewItem(selectedClip)
        } else {
          onPreviewItem(null) // If index is out of bounds
        }
      } else {
        onPreviewItem(null)
      }
    }
  }, [selectedIndex, filteredClips, onPreviewItem])

  // Infinite scroll trigger element
  const infiniteScrollTrigger = (
    <div ref={loadMoreTriggerRef} className="flex justify-center py-4 min-h-25">
      {loading && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400"></div>
          Loading more...
        </div>
      )}
    </div>
  )

  // Render content area based on state
  const renderContent = () => {
    if (loading && clips.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400"></div>
            <p className="text-sm text-gray-400">Loading clipboard history...</p>
          </div>
        </div>
      )
    }

    if (error) {
      return (
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
      )
    }

    if (filteredClips.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-12 relative overflow-hidden">
          <div className="text-center relative z-10 flex flex-col items-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-16 h-16 mb-4 text-gray-500/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            <p className="text-sm font-medium text-gray-400">
              {mode === 'search' ? 'No matches found' : 'Clipboard is empty'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {mode === 'search'
                ? 'Try adjusting your search filters'
                : 'Items you copy will appear here'}
            </p>
          </div>
        </div>
      )
    }

    return (
      <>
        {viewMode === 'list' && (
          <ClipboardListView
            clips={filteredClips}
            onSelect={onSelectHandler}
            onDoubleClick={onDoubleClickHandler}
            onCopy={onCopyHandler}
            onDelete={onDeleteHandler}
            onToggleFavorite={handleToggleFavorite}
            onTogglePin={handleTogglePin}
            onGenerateEmbedding={handleGenerateEmbedding}
            infiniteScrollTrigger={infiniteScrollTrigger}
            scrollContainerRef={scrollContainerRef}
            selectedIndex={selectedIndex}
          />
        )}
      </>
    )
  }

  return <div className={`flex h-full max-h-screen flex-col ${className}`}>{renderContent()}</div>
}
