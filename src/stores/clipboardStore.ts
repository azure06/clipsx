import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettingsStore } from './settingsStore'
import { useUIStore } from './uiStore'
import type { ClipItem, Result, Tag } from '../shared/types'
import {
  addTagToClip,
  createTag,
  deleteTag,
  getTags,
  getTagsForClips,
  removeTagFromClip,
  updateClipNote as updateClipNoteApi,
} from '../shared/api/tags'

type ClipboardState = {
  clips: ClipItem[]
  availableTags: Tag[]
  loading: boolean
  error: string | null
  hasMore: boolean
  currentOffset: number
  // Search mode state
  mode: 'browse' | 'search' // Track whether we're browsing or searching
  searchQuery: string // Current search query (empty = browse mode)
  activeTab: 'all' | 'favorites' | 'pinned'
  tagFilter: number | null // Active tag filter (null = show all)
}

type ClipboardActions = {
  loadMoreClips: (limit?: number) => Promise<void>
  addNewClip: (clip: ClipItem) => void
  mergeClipUpdate: (clip: ClipItem) => void
  searchClips: (query: string, limit?: number) => Promise<void>
  // NEW: Search with pagination (for infinite scroll)
  enterSearchMode: (query: string) => Promise<void>
  exitSearchMode: () => void
  setActiveTab: (tab: 'all' | 'favorites' | 'pinned') => Promise<void>
  setTagFilter: (tagId: number | null) => Promise<void>
  refreshAvailableTags: () => Promise<void>
  updateClipNote: (clipId: string, note: string | null) => Promise<void>
  addClipTag: (clipId: string, tag: Tag) => Promise<void>
  removeClipTag: (clipId: string, tagId: number) => Promise<void>
  createTagAndAttach: (clipId: string, name: string) => Promise<void>
  deleteAvailableTag: (tagId: number) => Promise<void>
  deleteClip: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  togglePin: (id: string) => Promise<void>
  clearAllClips: () => Promise<void>
  copyToClipboard: (text: string, id?: string) => Promise<Result<void>>
  pasteClip: (text: string, id?: string) => Promise<Result<void>>
  /** Centralized preview/derived copy: plain-text only, no hide_on_copy side effects */
  copyDerivedText: (text: string, sourceClipId: string) => Promise<void>
  /** Centralized primary action: paste-to-app or copy-to-clipboard based on settings */
  performPrimaryAction: (text: string, id: string) => Promise<void>
  /** Centralized explicit copy: always copies, respects paste format and hide_on_copy */
  performCopy: (text: string, id: string) => Promise<void>
  resetPagination: () => void
  generateEmbedding: (id: string) => Promise<void>
}

type ClipboardStore = ClipboardState & ClipboardActions

const initialState: ClipboardState = {
  clips: [],
  availableTags: [],
  loading: false,
  error: null,
  hasMore: true,
  currentOffset: 0,
  mode: 'browse',
  searchQuery: '',
  activeTab: 'all',
  tagFilter: null,
}

const FILTER_TYPE_MAP: Record<string, string> = {
  image: 'image',
  url: 'url',
  text: 'text',
  code: 'code',
  file: 'files',
  files: 'files',
  office: 'office',
}

// Helper to parse slash commands from query
// Example: "apple /image" -> { query: "apple", filterTypes: ["image"] }
const parseSearchQuery = (input: string): { query: string; filterTypes: string[] | null } => {
  const typeRegex = /\/([a-z]+)/g
  const matches = [...input.matchAll(typeRegex)]

  if (!matches) {
    return { query: input, filterTypes: null }
  }

  const filterTypes = matches
    .map(match => match[1]?.toLowerCase() ?? '')
    .map(type => FILTER_TYPE_MAP[type] ?? type)
    .filter(Boolean)

  // Remove types from query string
  const query = input.replace(typeRegex, '').trim()

  return { query, filterTypes }
}

const hydrateClipsWithTags = async (clips: ClipItem[]): Promise<ClipItem[]> => {
  if (clips.length === 0) return []

  const tagEntries = await getTagsForClips(clips.map(clip => clip.id))
  const tagsByClipId = new Map<string, Tag[]>()

  for (const { clipId, tag } of tagEntries) {
    const list = tagsByClipId.get(clipId) ?? []
    list.push(tag)
    tagsByClipId.set(clipId, list)
  }

  return clips.map(clip => ({
    ...clip,
    tags: tagsByClipId.get(clip.id) ?? clip.tags ?? [],
  }))
}

const mergeClipState = (existing: ClipItem | undefined, incoming: ClipItem): ClipItem => ({
  ...existing,
  ...incoming,
  note: incoming.note ?? existing?.note ?? null,
  tags: incoming.tags ?? existing?.tags ?? [],
})

const replaceClipInList = (clips: ClipItem[], updatedClip: ClipItem): ClipItem[] =>
  clips.map(clip => (clip.id === updatedClip.id ? mergeClipState(clip, updatedClip) : clip))

export const useClipboardStore = create<ClipboardStore>(set => ({
  ...initialState,

  // Universal pagination - works for both browse and search modes
  loadMoreClips: async (limit = 50) => {
    const { currentOffset, hasMore, loading, mode, searchQuery, activeTab, tagFilter } =
      useClipboardStore.getState()
    if (!hasMore || loading) return

    set({ loading: true, error: null })
    try {
      let newClips: ClipItem[]
      const favoritesOnly = activeTab === 'favorites'
      const pinnedOnly = activeTab === 'pinned'

      if (mode === 'search' && searchQuery) {
        // Search mode: Use FTS paginated search with parsing
        const { query, filterTypes } = parseSearchQuery(searchQuery)

        const isSemanticActive = useUIStore.getState().isSemanticActive
        newClips = await invoke<ClipItem[]>('search_clips_paginated', {
          query,
          filterTypes,
          limit,
          offset: currentOffset,
          favoritesOnly,
          pinnedOnly,
          tagFilter,
          useSemanticSearch: isSemanticActive,
        })
      } else {
        // Browse mode: Standard chronological pagination
        newClips = await invoke<ClipItem[]>('get_recent_clips_paginated', {
          limit,
          offset: currentOffset,
          favoritesOnly,
          pinnedOnly,
          tagFilter,
        })
      }

      const clipsWithTags = await hydrateClipsWithTags(newClips)

      set(state => ({
        clips: [...state.clips, ...clipsWithTags],
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
      const existingIndex = state.clips.findIndex(c => c.id === clip.id)
      const mergedClip = mergeClipState(state.clips[existingIndex], {
        ...clip,
        tags: clip.tags ?? [],
      })

      if (existingIndex !== -1) {
        return {
          clips: state.clips.map((c, i) => (i === existingIndex ? mergedClip : c)),
        }
      } else {
        return {
          clips: [mergedClip, ...state.clips],
          currentOffset: state.currentOffset + 1,
        }
      }
    })
  },

  mergeClipUpdate: (clip: ClipItem) => {
    set(state => {
      const existingIndex = state.clips.findIndex(c => c.id === clip.id)
      if (existingIndex === -1) {
        return state
      }

      return {
        clips: state.clips.map((currentClip, index) =>
          index === existingIndex ? mergeClipState(currentClip, clip) : currentClip
        ),
      }
    })
  },

  resetPagination: () => {
    set({ currentOffset: 0, hasMore: true })
  },

  setActiveTab: async (tab: 'all' | 'favorites' | 'pinned') => {
    const { activeTab } = useClipboardStore.getState()
    if (activeTab === tab) return

    set({
      activeTab: tab,
      clips: [],
      currentOffset: 0,
      hasMore: true,
    })

    // Automatically load first page of the new tab
    await useClipboardStore.getState().loadMoreClips(50)
  },

  // Enter search mode with a new query
  // Resets pagination and loads first page of search results
  enterSearchMode: async (rawQuery: string) => {
    set({
      mode: 'search',
      searchQuery: rawQuery,
      clips: [],
      currentOffset: 0,
      hasMore: true,
      loading: true,
      error: null,
    })

    try {
      const { query, filterTypes } = parseSearchQuery(rawQuery)

      const isSemanticActive = useUIStore.getState().isSemanticActive
      const { activeTab, tagFilter } = useClipboardStore.getState()
      const favoritesOnly = activeTab === 'favorites'
      const pinnedOnly = activeTab === 'pinned'

      const clips = await invoke<ClipItem[]>('search_clips_paginated', {
        query,
        filterTypes,
        limit: 50,
        offset: 0,
        favoritesOnly,
        pinnedOnly,
        tagFilter,
        useSemanticSearch: isSemanticActive,
        similarityThreshold: 0.3,
      })
      const hydratedClips = await hydrateClipsWithTags(clips)
      set({
        clips: hydratedClips,
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

  searchClips: async (rawQuery: string, limit = 50) => {
    set({ loading: true, error: null })
    try {
      const { query, filterTypes } = parseSearchQuery(rawQuery)
      const isSemanticActive = useUIStore.getState().isSemanticActive

      const { activeTab, tagFilter } = useClipboardStore.getState()
      const favoritesOnly = activeTab === 'favorites'
      const pinnedOnly = activeTab === 'pinned'

      const clips = await invoke<ClipItem[]>('search_clips', {
        query,
        filterTypes,
        limit,
        favoritesOnly,
        pinnedOnly,
        tagFilter,
        useSemanticSearch: isSemanticActive,
        similarityThreshold: 0.3, // Provide a default or read from settings if you add it later
      })
      const hydratedClips = await hydrateClipsWithTags(clips)
      set({ clips: hydratedClips, loading: false })
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

  pasteClip: async (text: string, id?: string): Promise<Result<void>> => {
    try {
      await invoke('paste_clip', { text, id })
      return { ok: true, value: undefined }
    } catch (error) {
      console.error('Failed to paste:', error)
      return { ok: false, error: String(error) }
    }
  },

  // ── Centralized Action Handlers ──────────────────────────────────────

  copyDerivedText: async (text: string, sourceClipId: string) => {
    await invoke('copy_to_clipboard', { text, id: sourceClipId, plain: true })
  },

  performPrimaryAction: async (text: string, id: string) => {
    const settings = useSettingsStore.getState().settings
    const plain = settings?.default_paste_format === 'plain' ? true : undefined

    if (settings?.paste_on_enter) {
      // Paste to App: copy → hide → Ctrl+V (Rust handles hide + keystroke)
      await invoke('paste_clip', { text, id, plain })
    } else {
      // Copy to Clipboard only
      await invoke('copy_to_clipboard', { text, id, plain })
      if (settings?.hide_on_copy) {
        void getCurrentWindow().hide()
      }
    }
  },

  performCopy: async (text: string, id: string) => {
    const settings = useSettingsStore.getState().settings
    const plain = settings?.default_paste_format === 'plain' ? true : undefined

    await invoke('copy_to_clipboard', { text, id, plain })
    if (settings?.hide_on_copy) {
      void getCurrentWindow().hide()
    }
  },

  setTagFilter: async (tagId: number | null) => {
    set({ tagFilter: tagId, clips: [], currentOffset: 0, hasMore: true })
    await useClipboardStore.getState().loadMoreClips(50)
  },

  refreshAvailableTags: async () => {
    try {
      const availableTags = await getTags()
      set({ availableTags })
    } catch (error) {
      console.error('[refreshAvailableTags] failed:', error)
    }
  },

  updateClipNote: async (clipId: string, note: string | null) => {
    try {
      const normalizedNote = note?.trim() ? note.trim() : null
      const existingClip = useClipboardStore.getState().clips.find(clip => clip.id === clipId)
      console.log('[NOTE_DEBUG][clipboardStore] updateClipNote called', {
        clipId,
        incomingNote: note,
        normalizedNote,
        existingNote: existingClip?.note ?? null,
        expected: 'existing clip should be found and backend should return the updated clip row',
      })
      if (!existingClip) {
        console.warn('[NOTE_DEBUG][clipboardStore] clip not found in store', {
          clipId,
          expected: 'selected clip should exist in clipboardStore before save',
        })
        return
      }
      if ((existingClip.note ?? null) === normalizedNote) {
        console.log('[NOTE_DEBUG][clipboardStore] update skipped', {
          clipId,
          normalizedNote,
          expected: 'skip backend call because note already matches store value',
        })
        return
      }

      const updatedClip = await updateClipNoteApi(clipId, normalizedNote)
      console.log('[NOTE_DEBUG][clipboardStore] backend returned updated clip', {
        clipId,
        returnedNote: updatedClip.note ?? null,
        returnedUpdatedAt: updatedClip.updatedAt,
        expected: 'returned clip note should equal normalizedNote',
      })
      set(state => ({
        clips: replaceClipInList(state.clips, updatedClip),
      }))
      console.log('[NOTE_DEBUG][clipboardStore] store replaced clip after note save', {
        clipId,
        expected: 'all UI surfaces should now read the updated note from clipboardStore',
      })
    } catch (e) {
      console.error('[updateClipNote] failed:', e)
      console.error('[NOTE_DEBUG][clipboardStore] note save failed', {
        clipId,
        note,
        expected: 'no error here; if there is one, the backend or bridge is failing',
      })
      set({ error: String(e) })
      throw e
    }
  },

  addClipTag: async (clipId: string, tag: Tag) => {
    const previousClips = useClipboardStore.getState().clips

    set(state => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        if ((clip.tags ?? []).some(existingTag => existingTag.id === tag.id)) return clip
        return { ...clip, tags: [...(clip.tags ?? []), tag] }
      }),
    }))

    try {
      await addTagToClip(clipId, tag.id)
    } catch (error) {
      set(state => ({
        clips: state.clips.map(
          clip => previousClips.find(previous => previous.id === clip.id) ?? clip
        ),
      }))
      console.error('[addClipTag] failed:', error)
    }
  },

  removeClipTag: async (clipId: string, tagId: number) => {
    const previousClips = useClipboardStore.getState().clips

    set(state => ({
      clips: state.clips.map(clip =>
        clip.id === clipId
          ? { ...clip, tags: (clip.tags ?? []).filter(tag => tag.id !== tagId) }
          : clip
      ),
    }))

    try {
      await removeTagFromClip(clipId, tagId)
    } catch (error) {
      set(state => ({
        clips: state.clips.map(
          clip => previousClips.find(previous => previous.id === clip.id) ?? clip
        ),
      }))
      console.error('[removeClipTag] failed:', error)
    }
  },

  createTagAndAttach: async (clipId: string, name: string) => {
    const normalizedName = name.trim().toLowerCase()
    if (!normalizedName) return

    const existingTag = useClipboardStore
      .getState()
      .availableTags.find(tag => tag.name.toLowerCase() === normalizedName)

    if (existingTag) {
      await useClipboardStore.getState().addClipTag(clipId, existingTag)
      return
    }

    const tagPalette = [
      '#ef4444',
      '#f97316',
      '#eab308',
      '#22c55e',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#6b7280',
    ]
    const color = tagPalette[Math.floor(Math.random() * tagPalette.length)] ?? '#6b7280'

    try {
      const newTag = await createTag(normalizedName, color)
      set(state => ({
        availableTags: [...state.availableTags, newTag].sort((left, right) =>
          left.name.localeCompare(right.name)
        ),
      }))
      await useClipboardStore.getState().addClipTag(clipId, newTag)
    } catch (error) {
      console.error('[createTagAndAttach] failed:', error)
      await useClipboardStore.getState().refreshAvailableTags()
    }
  },

  deleteAvailableTag: async (tagId: number) => {
    const previousState = useClipboardStore.getState()
    const wasActiveFilter = previousState.tagFilter === tagId

    set(state => ({
      availableTags: state.availableTags.filter(tag => tag.id !== tagId),
      clips: wasActiveFilter
        ? []
        : state.clips.map(clip => ({
            ...clip,
            tags: (clip.tags ?? []).filter(tag => tag.id !== tagId),
          })),
      currentOffset: wasActiveFilter ? 0 : state.currentOffset,
      hasMore: wasActiveFilter ? true : state.hasMore,
      tagFilter: wasActiveFilter ? null : state.tagFilter,
    }))

    try {
      await deleteTag(tagId)
      if (wasActiveFilter) {
        await useClipboardStore.getState().loadMoreClips(50)
      }
    } catch (error) {
      set({
        availableTags: previousState.availableTags,
        clips: previousState.clips,
        tagFilter: previousState.tagFilter,
        currentOffset: previousState.currentOffset,
        hasMore: previousState.hasMore,
      })
      console.error('[deleteAvailableTag] failed:', error)
    }
  },

  generateEmbedding: async (id: string) => {
    try {
      await invoke('generate_embedding', { id })
    } catch (error) {
      console.error('Failed to generate embedding:', error)
    }
  },
}))
