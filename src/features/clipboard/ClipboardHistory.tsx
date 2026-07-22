import { useEffect, useRef, useState, useCallback } from 'react'
import { useClipboardStore, useSettingsStore } from '../../stores'
import { ClipboardListView } from './views'
import { TagFilter } from './components'
import { useToast } from '../../shared/contexts/ToastContext'
import { clipToContent, useActionRegistry } from '../content'
import { getDeleteShortcut, getPlatform, matchShortcut } from '../../shared/keyboard/shortcuts'
import { useTranslation } from 'react-i18next'

// Re-export for backwards compatibility
export { ClipboardListItem } from './components'

interface ClipboardHistoryProps {
  searchQuery?: string
  className?: string
  onPreviewItem?: (clipId: string | null) => void
}

const hasNativeCopySelection = (): boolean => {
  const activeElement = document.activeElement

  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    return (
      activeElement.selectionStart !== null &&
      activeElement.selectionEnd !== null &&
      activeElement.selectionStart !== activeElement.selectionEnd
    )
  }

  const selection = window.getSelection()
  return selection != null && !selection.isCollapsed && selection.toString().length > 0
}

export const ClipboardHistory = ({
  searchQuery = '',
  className,
  onPreviewItem,
}: ClipboardHistoryProps) => {
  const { t } = useTranslation()
  const {
    clips,
    loading,
    error,
    mode,
    loadMoreClips,
    deleteClip,
    toggleFavorite,
    togglePin,
    performPrimaryAction,
    performCopy,
    enterSearchMode,
    exitSearchMode,
  } = useClipboardStore()

  const activeTab = useClipboardStore(state => state.activeTab)
  const setActiveTab = useClipboardStore(state => state.setActiveTab)
  const settings = useSettingsStore(state => state.settings)
  const { toast } = useToast()
  const { getActionsForContent } = useActionRegistry({
    onDelete: id => {
      void deleteClip(id)
    },
    onToggleFavorite: id => {
      void toggleFavorite(id)
    },
    onTogglePin: id => {
      void togglePin(id)
    },
  })

  const [selectedIndex, setSelectedIndex] = useState(0)

  const loadMoreTriggerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // macOS IME fix: we cannot use e.isComposing because on macOS WebKit,
  // compositionend fires *before* the confirming Enter keydown, making
  // e.isComposing already false by the time our handler runs.
  //
  // We also cannot use a simple setTimeout(0) because macOS Japanese IME fires
  // rapid compositionend → compositionstart pairs for each conversion segment
  // (e.g. while the underline is still visible). A naive reset would clear the
  // flag between those pairs and let an intermediate Enter through.
  //
  // Solution: debounce the reset with 100ms. If a new compositionstart arrives
  // within 100ms of compositionend we cancel the reset, keeping isComposingRef
  // true for the entire user-visible IME session (all underlines gone).
  const isComposingRef = useRef(false)
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track IME composition state (see isComposingRef above)
  useEffect(() => {
    const onCompositionStart = () => {
      // Cancel any pending reset — a new segment is being composed.
      if (compositionEndTimerRef.current !== null) {
        clearTimeout(compositionEndTimerRef.current)
        compositionEndTimerRef.current = null
      }
      isComposingRef.current = true
    }
    const onCompositionEnd = () => {
      // Delay the reset so that:
      // 1. The Enter keydown that immediately follows compositionend still
      //    sees isComposingRef.current === true.
      // 2. If macOS fires another compositionstart within 100ms (next segment),
      //    onCompositionStart cancels this timer and keeps the flag true.
      compositionEndTimerRef.current = setTimeout(() => {
        isComposingRef.current = false
        compositionEndTimerRef.current = null
      }, 100)
    }
    window.addEventListener('compositionstart', onCompositionStart)
    window.addEventListener('compositionend', onCompositionEnd)
    return () => {
      window.removeEventListener('compositionstart', onCompositionStart)
      window.removeEventListener('compositionend', onCompositionEnd)
      if (compositionEndTimerRef.current !== null) clearTimeout(compositionEndTimerRef.current)
    }
  }, [])

  // Load initial batch on mount
  useEffect(() => {
    void loadMoreClips(50)
  }, [loadMoreClips])

  // Handle search with debounce
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
  }, [loadMoreClips, clips.length])

  // Unified action handler for Click and Enter — delegates to centralized store
  const handleAction = useCallback(
    async (text: string, clipId: string) => {
      await performPrimaryAction(text, clipId)
      if (settings?.show_copy_toast) {
        toast({ title: t('clipboard.readyToPaste'), type: 'success' })
      }
    },
    [performPrimaryAction, settings?.show_copy_toast, t, toast]
  )

  // Explicit Copy handler (copy icon) — delegates to centralized store
  const handleExplicitCopy = useCallback(
    async (text: string, clipId: string) => {
      await performCopy(text, clipId)
      if (settings?.show_copy_toast) {
        toast({ title: t('clipboard.copiedToClipboard'), type: 'success' })
      }
    },
    [performCopy, settings?.show_copy_toast, t, toast]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteClip(id)
    },
    [deleteClip]
  )

  const itemActivationMode = settings?.item_activation_mode ?? 'single_click_copy'

  // Stable handlers for child components to avoid Promise/void lint errors and ensure memoization
  const onSelectHandler = useCallback(
    (text: string, clipId: string) => {
      const index = clips.findIndex(c => c.id === clipId)
      if (index !== -1) {
        setSelectedIndex(index)
      }

      if (itemActivationMode === 'single_click_copy') {
        void handleAction(text, clipId)
      }
    },
    [clips, handleAction, itemActivationMode]
  )

  const onDoubleClickHandler = useCallback(
    (text: string, clipId: string) => {
      if (itemActivationMode !== 'double_click_primary') return
      void handleAction(text, clipId)
    },
    [handleAction, itemActivationMode]
  )

  const onCopyHandler = useCallback(
    (text: string, clipId: string) => {
      void handleExplicitCopy(text, clipId)
    },
    [handleExplicitCopy]
  )

  // Reset selection when clips change
  useEffect(() => {
    if (clips.length > 0 && selectedIndex >= clips.length) {
      setTimeout(() => setSelectedIndex(0), 0) // Reset if out of bounds
    } else if (clips.length > 0 && selectedIndex === -1) {
      setTimeout(() => setSelectedIndex(0), 0)
    }
  }, [clips.length, selectedIndex])

  // Auto-scroll selected item into view
  const scrollSelectedIntoView = useCallback((index: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    const el = container.querySelector(`[data-clip-index="${index}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [])

  const selectBoundaryClip = useCallback(
    async (boundary: 'newest' | 'oldest') => {
      if (boundary === 'oldest') {
        let state = useClipboardStore.getState()

        // History is loaded newest-first in pages. Continue until the repository
        // reports the end, so End reaches the true oldest result rather than the
        // oldest item in the currently rendered page.
        while (state.hasMore && !state.loading) {
          const previousOffset = state.currentOffset
          await state.loadMoreClips(50)
          state = useClipboardStore.getState()

          // Stop if a failed or mocked load made no progress; otherwise an error
          // could leave this keyboard command in an infinite loop.
          if (state.currentOffset <= previousOffset) break
        }
      }

      const boundaryIndex =
        boundary === 'newest' ? 0 : useClipboardStore.getState().clips.length - 1
      if (boundaryIndex < 0) return

      setSelectedIndex(boundaryIndex)
      requestAnimationFrame(() => scrollSelectedIntoView(boundaryIndex))
    },
    [scrollSelectedIntoView]
  )

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If another component (like SearchBar) already handled and prevented this event, ignore it.
      if (e.defaultPrevented) return

      // Ignore events fired during IME composition (e.g. Japanese 変換 confirmation).
      // Uses a ref instead of e.isComposing because on macOS WebKit, compositionend
      // fires before the final keydown, making e.isComposing already false on Enter.
      if (isComposingRef.current) return

      // Skip if focus is inside any text input EXCEPT for the main search input
      const active = document.activeElement
      const isInput = active instanceof HTMLInputElement
      const platform = getPlatform()

      if (active instanceof HTMLTextAreaElement || (active as HTMLElement)?.isContentEditable) {
        return
      }

      // If active is our search input, only allow navigation, activation, and shortcuts.
      if (isInput) {
        if (
          !['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Escape'].includes(e.key) &&
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

      const selectedClip = clips[selectedIndex]
      const selectedContent = selectedClip ? clipToContent(selectedClip) : null

      // Handle primary+1 to primary+9
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const index = parseInt(e.key, 10) - 1
        const clip = clips[index]
        if (clip) {
          void handleAction(clip.contentText ?? '', clip.id)
        }
        return
      }

      if (selectedContent) {
        const shortcutAction = getActionsForContent(selectedContent).find(action => {
          if (!action.shortcut || action.id === 'delete') return false
          if (action.shortcut.modifiers.length === 0) return false
          return matchShortcut(e, action.shortcut, platform)
        })

        if (shortcutAction) {
          if (shortcutAction.id === 'copy' && hasNativeCopySelection()) {
            return
          }
          e.preventDefault()
          void shortcutAction.execute(selectedContent)
          return
        }
      }

      const maxIndex = clips.length - 1
      if (maxIndex < 0) return

      switch (e.key) {
        case 'Home': {
          e.preventDefault()
          void selectBoundaryClip('newest')
          break
        }
        case 'End': {
          e.preventDefault()
          void selectBoundaryClip('oldest')
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          setSelectedIndex(prev => {
            const next = Math.max(0, prev - 1)
            scrollSelectedIntoView(next)
            return next
          })
          break
        }
        case 'ArrowDown': {
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
          const clip = clips[selectedIndex]
          if (clip) {
            void handleAction(clip.contentText ?? '', clip.id)
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          const isMacInputDelete = isInput && platform === 'macos'

          if (isInput && !isMacInputDelete) break
          if (!matchShortcut(e, getDeleteShortcut(platform), platform)) {
            break
          }
          e.preventDefault()
          const clip = clips[selectedIndex]
          if (clip) {
            void handleDelete(clip.id)
            // Adjust index if we deleted the last item
            setSelectedIndex(prev => Math.min(prev, maxIndex - 1))
          }
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
  }, [
    clips,
    selectedIndex,
    scrollSelectedIntoView,
    handleAction,
    handleDelete,
    getActionsForContent,
    selectBoundaryClip,
  ])

  // ADDED: Notify parent of selection change for preview
  useEffect(() => {
    if (onPreviewItem) {
      if (clips.length > 0 && selectedIndex >= 0) {
        const selectedClip = clips[selectedIndex]
        if (selectedClip) {
          onPreviewItem(selectedClip.id)
        } else {
          onPreviewItem(null) // If index is out of bounds
        }
      } else {
        onPreviewItem(null)
      }
    }
  }, [selectedIndex, clips, onPreviewItem])

  // Infinite scroll trigger element
  const infiniteScrollTrigger = (
    <div ref={loadMoreTriggerRef} className="flex justify-center py-4 min-h-25">
      {loading && (
        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-400"></div>
          {t('clipboard.loadingMore')}
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
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-400"></div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('clipboard.loadingHistory')}
            </p>
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100/60 dark:bg-red-950">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-6 w-6 text-red-600 dark:text-red-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              {t('clipboard.loadError')}
            </p>
          </div>
        </div>
      )
    }

    if (clips.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-12 relative overflow-hidden">
          <div className="text-center relative z-10 flex flex-col items-center">
            <div
              className="w-32 h-32 mb-4 opacity-30 bg-center bg-no-repeat bg-contain"
              style={{
                backgroundImage: 'url(/monochromatic.svg)',
                filter: 'sepia(1) saturate(1) hue-rotate(180deg) brightness(0.5)',
              }}
            />
            <p className="-mt-4 text-xs text-gray-500 dark:text-gray-400">
              {mode === 'search' ? t('clipboard.noSearchResults') : t('clipboard.empty')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {mode === 'search' ? t('clipboard.tryDifferentQuery') : t('clipboard.startCopying')}
            </p>
          </div>
        </div>
      )
    }

    return (
      <>
        <ClipboardListView
          clips={clips}
          onSelect={onSelectHandler}
          onDoubleClick={onDoubleClickHandler}
          onCopy={onCopyHandler}
          infiniteScrollTrigger={infiniteScrollTrigger}
          scrollContainerRef={scrollContainerRef}
          selectedIndex={selectedIndex}
        />
      </>
    )
  }
  return (
    <div className={`flex h-full max-h-screen flex-col ${className}`}>
      {/* Quick Filters - always visible above the list */}
      <div className="flex gap-2 px-3 pt-2 pb-2 shrink-0 relative z-20">
        {(['all', 'favorites', 'pinned'] as const).map(filter => (
          <button
            key={filter}
            type="button"
            onClick={() => void setActiveTab(filter)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === filter
                ? 'bg-blue-100/60 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-500/30'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-black/5 dark:hover:bg-slate-100/5 border border-transparent'
            }`}
          >
            {t(`clipboard.${filter}`)}
          </button>
        ))}
      </div>
      {/* Tag filter row — only visible when tags exist */}
      <TagFilter />
      {renderContent()}
    </div>
  )
}
