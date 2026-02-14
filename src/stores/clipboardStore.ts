import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { ClipItem, Result } from '../shared/types'

type ClipboardState = {
  clips: ClipItem[]
  loading: boolean
  error: string | null
  hasMore: boolean
  currentOffset: number
  // Search mode state
  mode: 'browse' | 'search' // Track whether we're browsing or searching
  searchQuery: string // Current search query (empty = browse mode)
}

type ClipboardActions = {
  loadMoreClips: (limit?: number) => Promise<void>
  addNewClip: (clip: ClipItem) => void
  searchClips: (query: string, limit?: number) => Promise<void>
  // NEW: Search with pagination (for infinite scroll)
  enterSearchMode: (query: string) => Promise<void>
  exitSearchMode: () => void
  deleteClip: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  togglePin: (id: string) => Promise<void>
  clearAllClips: () => Promise<void>
  copyToClipboard: (text: string, id?: string) => Promise<Result<void>>
  resetPagination: () => void
}

type ClipboardStore = ClipboardState & ClipboardActions

const initialState: ClipboardState = {
  clips: [],
  loading: false,
  error: null,
  hasMore: true,
  currentOffset: 0,
  mode: 'browse',
  searchQuery: '',
}

export const useClipboardStore = create<ClipboardStore>(set => ({
  ...initialState,

  // Universal pagination - works for both browse and search modes
  // NOTE: When semantic search is added, check mode and query to decide:
  // - if searchQuery starts with "semantic:" -> use semantic_search_paginated
  // - otherwise -> use FTS search_clips_paginated
  loadMoreClips: async (limit = 50) => {
    const { currentOffset, hasMore, loading, mode, searchQuery } = useClipboardStore.getState()
    if (!hasMore || loading) return

    set({ loading: true, error: null })
    try {
      let newClips: ClipItem[]

      if (mode === 'search' && searchQuery) {
        // Search mode: Use FTS paginated search
        newClips = await invoke<ClipItem[]>('search_clips_paginated', {
          query: searchQuery,
          limit,
          offset: currentOffset,
        })
      } else {
        // Browse mode: Standard chronological pagination
        newClips = await invoke<ClipItem[]>('get_recent_clips_paginated', {
          limit,
          offset: currentOffset,
        })
      }

      set(state => ({
        clips: [...state.clips, ...newClips],
        loading: false,
        hasMore: newClips.length === limit,
        currentOffset: state.currentOffset + newClips.length,
      }))
    } catch (error) {
      console.error('Failed to load more clips:', error)
      set({ error: String(error), loading: false })
    }
  },

  // Prepend new clip from clipboard_changed event
  addNewClip: (clip: ClipItem) => {
    set(state => {
      // Check if clip already exists by ID
      const existingIndex = state.clips.findIndex(c => c.id === clip.id)

      if (existingIndex !== -1) {
        // Duplicate - remove from old position and add at top with updated timestamp
        const newClips = state.clips.filter((_, i) => i !== existingIndex)
        return {
          clips: [clip, ...newClips],
          // Don't increment offset - total count unchanged
        }
      } else {
        // New clip - prepend and increment offset
        return {
          clips: [clip, ...state.clips],
          currentOffset: state.currentOffset + 1,
        }
      }
    })
  },

  resetPagination: () => {
    set({ currentOffset: 0, hasMore: true })
  },

  // Enter search mode with a new query
  // Resets pagination and loads first page of search results
  enterSearchMode: async (query: string) => {
    set({
      mode: 'search',
      searchQuery: query,
      clips: [],
      currentOffset: 0,
      hasMore: true,
      loading: true,
      error: null,
    })

    try {
      const clips = await invoke<ClipItem[]>('search_clips_paginated', {
        query,
        limit: 50,
        offset: 0,
      })
      set({
        clips,
        loading: false,
        hasMore: clips.length === 50,
        currentOffset: clips.length,
      })
    } catch (error) {
      console.error('Failed to search clips:', error)
      set({ error: String(error), loading: false })
    }
  },

  // Exit search mode and return to browse mode
  exitSearchMode: () => {
    set({
      mode: 'browse',
      searchQuery: '',
      clips: [],
      currentOffset: 0,
      hasMore: true,
    })
    // Automatically load first page of browse results
    void useClipboardStore.getState().loadMoreClips(50)
  },

  searchClips: async (query: string, limit = 50) => {
    set({ loading: true, error: null })
    try {
      const clips = await invoke<ClipItem[]>('search_clips', { query, limit })
      set({ clips, loading: false })
    } catch (error) {
      set({ error: String(error), loading: false })
    }
  },

  deleteClip: async (id: string) => {
    try {
      await invoke('delete_clip', { id })
      set(state => ({
        clips: state.clips.filter(clip => clip.id !== id),
        currentOffset: state.currentOffset - 1,
      }))
    } catch (error) {
      console.error('Failed to delete clip:', error)
      set({ error: String(error) })
    }
  },

  toggleFavorite: async (id: string) => {
    try {
      const isFavorite = await invoke<boolean>('toggle_favorite', { id })
      set(state => ({
        clips: state.clips.map(clip => (clip.id === id ? { ...clip, isFavorite } : clip)),
      }))
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
      set({ error: String(error) })
    }
  },

  togglePin: async (id: string) => {
    try {
      const isPinned = await invoke<boolean>('toggle_pin', { id })
      set(state => ({
        clips: state.clips.map(clip => (clip.id === id ? { ...clip, isPinned } : clip)),
      }))
    } catch (error) {
      console.error('Failed to toggle pin:', error)
      set({ error: String(error) })
    }
  },

  clearAllClips: async () => {
    set({ loading: true, error: null })
    try {
      await invoke('clear_all_clips')
      set({ clips: [], loading: false })
    } catch (error) {
      set({ error: String(error), loading: false })
    }
  },

  copyToClipboard: async (text: string, id?: string): Promise<Result<void>> => {
    try {
      await invoke('copy_to_clipboard', { text, id })
      return { ok: true, value: undefined }
    } catch (error) {
      console.error('Failed to copy:', error)
      return { ok: false, error: String(error) }
    }
  },
}))
