import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettingsStore } from './settingsStore'
import { useUIStore } from './uiStore'
import {
  copyClipboardOutput,
  copyLiteralText,
  pasteClipboardOutput,
} from '../shared/clipboardOutput'
import type {
  ClipboardOutputSource,
  ClipSummary,
  SearchMatch,
  SearchSourceOutcome,
  V2Tag,
} from '../shared/types/v2'
type V2Representation = {
  canonicalMimeType: string | null
  textValue: string | null
  fileReferences: string[]
  binaryFileId: string | null
}
type V2Detail = { clip: ClipSummary; representations: V2Representation[] }
type V2Page<T> = { items: T[]; nextCursor: string | null }
type V2SearchResult = {
  clip: ClipSummary
  snippet: string | null
  rank: number
  matches: SearchMatch[]
}
type V2SearchPage = V2Page<V2SearchResult> & {
  sourceOutcomes: SearchSourceOutcome[]
  isExhaustive: boolean
}

type ClipboardState = {
  clips: ClipSummary[]
  availableTags: V2Tag[]
  loading: boolean
  error: string | null
  hasMore: boolean
  currentOffset: number
  mode: 'browse' | 'search'
  searchQuery: string
  activeTab: 'all' | 'favorites' | 'pinned'
  tagFilter: string | null
  searchSourceOutcomes: SearchSourceOutcome[]
}
type ClipboardActions = {
  loadMoreClips: (limit?: number) => Promise<void>
  addNewClip: (clip: ClipSummary) => void
  mergeClipUpdate: (clip: ClipSummary) => void
  enterSearchMode: (query: string) => Promise<void>
  exitSearchMode: () => void
  setActiveTab: (tab: 'all' | 'favorites' | 'pinned') => Promise<void>
  setTagFilter: (tagId: string | null) => Promise<void>
  refreshAvailableTags: () => Promise<void>
  updateClipNote: (clipId: string, note: string | null) => Promise<void>
  addClipTag: (clipId: string, tag: V2Tag) => Promise<void>
  removeClipTag: (clipId: string, tagId: string) => Promise<void>
  createTagAndAttach: (clipId: string, name: string) => Promise<void>
  deleteAvailableTag: (tagId: string) => Promise<void>
  deleteClip: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  togglePin: (id: string) => Promise<void>
  clearAllClips: () => Promise<void>
  copyDerivedText: (text: string) => Promise<void>
  performPrimaryAction: (text: string, clipId: string) => Promise<void>
  performCopy: (text: string, clipId: string) => Promise<void>
  resetPagination: () => void
  refreshSearch: () => Promise<void>
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
  searchSourceOutcomes: [],
}
let nextCursor: string | null | undefined
let requestGeneration = 0
let eventListenerReady = false

const scope = (state: ClipboardState) => (state.activeTab === 'all' ? 'all' : state.activeTab)
const matchesVisibleScope = (state: ClipboardState, clip: ClipSummary) => {
  if (state.activeTab === 'favorites' && !clip.isFavorite) return false
  if (state.activeTab === 'pinned' && !clip.isPinned) return false
  if (state.tagFilter !== null && !clip.tags?.some(tag => tag.id === state.tagFilter)) return false
  return true
}
type ParsedSearch = { query: string; representationFamilies: string[]; facetIds: string[] }

const searchFilters: Record<string, { representationFamily?: string; facetId?: string }> = {
  text: { representationFamily: 'text' },
  image: { representationFamily: 'image' },
  file: { representationFamily: 'files' },
  files: { representationFamily: 'files' },
  html: { representationFamily: 'html' },
  rtf: { representationFamily: 'rtf' },
  office: { representationFamily: 'office' },
  document: { representationFamily: 'document' },
  pdf: { representationFamily: 'document' },
  json: { facetId: 'core.data.json' },
  csv: { facetId: 'core.data.table' },
  table: { facetId: 'core.data.table' },
  url: { facetId: 'core.link.url' },
  markdown: { facetId: 'core.text.markdown' },
  code: { facetId: 'core.text.code' },
  email: { facetId: 'core.contact.email' },
  color: { facetId: 'core.value.color' },
  math: { facetId: 'core.math.expression' },
  phone: { facetId: 'core.contact.phone' },
  path: { facetId: 'core.file.path' },
  jwt: { facetId: 'core.token.jwt' },
  secret: { facetId: 'core.security.secret' },
  date: { facetId: 'core.time.date' },
  timestamp: { facetId: 'core.time.date' },
}

const parseSearch = (input: string): ParsedSearch => {
  const representationFamilies = new Set<string>()
  const facetIds = new Set<string>()
  const query = input
    .replace(/\/(\w+)/g, (token, name: string) => {
      const filter = searchFilters[name.toLowerCase()]
      if (!filter) return token
      if (filter.representationFamily) representationFamilies.add(filter.representationFamily)
      if (filter.facetId) facetIds.add(filter.facetId)
      return ''
    })
    .trim()
  return { query, representationFamilies: [...representationFamilies], facetIds: [...facetIds] }
}

type ArtifactUpdate = { clipId: string; sourceId: string }

const refreshVisibleClip = async (id: string) => {
  const state = useClipboardStore.getState()
  if (!state.clips.some(clip => clip.id === id)) return
  const detail = await invoke<V2Detail>('get_clip_detail', { clipId: id })
  state.mergeClipUpdate(detail.clip)
}
const ensureEvents = () => {
  if (eventListenerReady || typeof window === 'undefined') return
  eventListenerReady = true
  void Promise.all([
    listen<string>('clip-captured', event => {
      const id = event.payload
      void invoke<V2Detail>('get_clip_detail', { clipId: id })
        .then(detail => useClipboardStore.getState().addNewClip(detail.clip))
        .catch(() => undefined)
    }),
    listen<string>('clip-updated', event => {
      void refreshVisibleClip(event.payload).catch(() => undefined)
    }),
    listen<string>('clip-facets-updated', event => {
      if (event.payload) void refreshVisibleClip(event.payload).catch(() => undefined)
    }),
    listen<ArtifactUpdate>('clip-artifacts-updated', event => {
      void refreshVisibleClip(event.payload.clipId).catch(() => undefined)
    }),
    listen<string>('clip-deleted', event =>
      useClipboardStore.setState(state => ({
        clips: state.clips.filter(clip => clip.id !== event.payload),
      }))
    ),
  ]).catch(() => {
    eventListenerReady = false
  })
}

export const useClipboardStore = create<ClipboardStore>(set => ({
  ...initialState,
  loadMoreClips: async (limit = 50) => {
    const state = useClipboardStore.getState()
    if (state.loading || !state.hasMore) return
    const generation = requestGeneration
    ensureEvents()
    set({ loading: true, error: null })
    try {
      const tagId = state.tagFilter
      let summaries: ClipSummary[]
      let cursor: string | null
      if (state.mode === 'search') {
        const parsedSearch = parseSearch(state.searchQuery)
        const result = await invoke<V2SearchPage>('search_clips', {
          request: {
            query: parsedSearch.query,
            representationFamilies: parsedSearch.representationFamilies,
            facetIds: parsedSearch.facetIds,
            scope: scope(state),
            tagId,
            limit,
            cursor: nextCursor ?? null,
            enabledSourceIds: useUIStore.getState().isSemanticActive
              ? ['builtin.search.fts', 'builtin.search.semantic_text']
              : ['builtin.search.fts'],
          },
        })
        summaries = result.items.map(item => ({
          ...item.clip,
          similarityScore: item.rank,
          searchMatches: item.matches,
        }))
        set({ searchSourceOutcomes: result.sourceOutcomes })
        cursor = result.nextCursor
      } else {
        const result = await invoke<V2Page<ClipSummary>>('list_clips', {
          request: { scope: scope(state), tagId, limit, cursor: nextCursor ?? null },
        })
        summaries = result.items
        cursor = result.nextCursor
      }
      const clips = summaries
      if (generation !== requestGeneration) return
      nextCursor = cursor
      set(current => ({
        clips: [...current.clips, ...clips],
        loading: false,
        hasMore: cursor !== null,
        currentOffset: current.currentOffset + clips.length,
      }))
    } catch (error) {
      if (generation !== requestGeneration) return
      set({ loading: false, error: String(error) })
    }
  },
  addNewClip: clip =>
    set(state => ({
      clips:
        state.mode === 'browse' && matchesVisibleScope(state, clip)
          ? [clip, ...state.clips.filter(item => item.id !== clip.id)]
          : state.clips,
    })),
  mergeClipUpdate: clip =>
    set(state => ({
      clips: state.clips
        .map(item => (item.id === clip.id ? { ...item, ...clip } : item))
        .filter(item => matchesVisibleScope(state, item)),
    })),
  resetPagination: () => {
    requestGeneration += 1
    nextCursor = undefined
    set({ currentOffset: 0, hasMore: true, loading: false })
  },
  refreshSearch: async () => {
    const state = useClipboardStore.getState()
    if (state.mode !== 'search') return
    requestGeneration += 1
    nextCursor = undefined
    set({ clips: [], currentOffset: 0, hasMore: true, loading: false })
    await useClipboardStore.getState().loadMoreClips()
  },
  setActiveTab: async tab => {
    requestGeneration += 1
    nextCursor = undefined
    set({ activeTab: tab, clips: [], currentOffset: 0, hasMore: true, loading: false })
    await useClipboardStore.getState().loadMoreClips()
  },
  enterSearchMode: async query => {
    const current = useClipboardStore.getState()
    if (current.mode === 'search' && current.searchQuery === query) return
    requestGeneration += 1
    nextCursor = undefined
    set({
      mode: 'search',
      searchQuery: query,
      clips: [],
      currentOffset: 0,
      hasMore: true,
      loading: false,
    })
    await useClipboardStore.getState().loadMoreClips()
  },
  exitSearchMode: () => {
    requestGeneration += 1
    nextCursor = undefined
    set({
      mode: 'browse',
      searchQuery: '',
      clips: [],
      currentOffset: 0,
      hasMore: true,
      loading: false,
    })
    void useClipboardStore.getState().loadMoreClips()
  },
  setTagFilter: async tagFilter => {
    requestGeneration += 1
    nextCursor = undefined
    set({ tagFilter, clips: [], currentOffset: 0, hasMore: true, loading: false })
    await useClipboardStore.getState().loadMoreClips()
  },
  refreshAvailableTags: async () => {
    try {
      set({ availableTags: await invoke<V2Tag[]>('list_tags') })
    } catch (error) {
      set({ error: String(error) })
    }
  },
  updateClipNote: async (clipId, note) => {
    await invoke('update_clip_note', { clipId, note: note?.trim() || null })
    await refreshVisibleClip(clipId)
  },
  addClipTag: async (clipId, tag) => {
    await invoke('add_clip_tag', { clipId, tagId: tag.id })
    await refreshVisibleClip(clipId)
  },
  removeClipTag: async (clipId, tagId) => {
    await invoke('remove_clip_tag', { clipId, tagId })
    await refreshVisibleClip(clipId)
  },
  createTagAndAttach: async (clipId, name) => {
    const result = await invoke<V2Tag>('create_tag', { name: name.trim(), color: '#3b82f6' })
    set(state => ({ availableTags: [...state.availableTags, result] }))
    await useClipboardStore.getState().addClipTag(clipId, result)
  },
  deleteAvailableTag: async tagId => {
    await invoke('delete_tag', { tagId })
    set(state => ({
      availableTags: state.availableTags.filter(tag => tag.id !== tagId),
      clips: state.clips.map(clip => ({
        ...clip,
        tags: clip.tags?.filter(tag => tag.id !== tagId),
      })),
    }))
  },
  deleteClip: async id => {
    await invoke('delete_clip', { clipId: id })
    set(state => ({ clips: state.clips.filter(clip => clip.id !== id) }))
  },
  toggleFavorite: async id => {
    const before = useClipboardStore.getState()
    const clip = before.clips.find(item => item.id === id)
    if (!clip) return
    const value = !clip.isFavorite
    set(state => ({
      clips: state.clips
        .map(item => (item.id === id ? { ...item, isFavorite: value } : item))
        .filter(item => matchesVisibleScope(state, item)),
      currentOffset:
        state.activeTab === 'favorites' && !value
          ? Math.max(0, state.currentOffset - 1)
          : state.currentOffset,
    }))
    try {
      await invoke('set_clip_favorite', { clipId: id, value })
      await refreshVisibleClip(id)
    } catch (error) {
      set({ clips: before.clips, error: String(error) })
      throw error
    }
  },
  togglePin: async id => {
    const before = useClipboardStore.getState()
    const clip = before.clips.find(item => item.id === id)
    if (!clip) return
    const value = !clip.isPinned
    set(state => ({
      clips: state.clips
        .map(item => (item.id === id ? { ...item, isPinned: value } : item))
        .filter(item => matchesVisibleScope(state, item)),
      currentOffset:
        state.activeTab === 'pinned' && !value
          ? Math.max(0, state.currentOffset - 1)
          : state.currentOffset,
    }))
    try {
      await invoke('set_clip_pinned', { clipId: id, value })
      await refreshVisibleClip(id)
    } catch (error) {
      set({ clips: before.clips, error: String(error) })
      throw error
    }
  },
  clearAllClips: async () => {
    await invoke('clear_history')
    set({ clips: [], currentOffset: 0, hasMore: false })
  },
  copyDerivedText: async text => {
    await copyLiteralText(text)
  },
  performPrimaryAction: async (_text, clipId) => {
    const settings = useSettingsStore.getState().settings
    const source: ClipboardOutputSource =
      settings?.default_paste_format === 'plain'
        ? { kind: 'plain_text', clipId }
        : { kind: 'original', clipId }
    if (settings?.paste_on_enter) await pasteClipboardOutput(source)
    else {
      await copyClipboardOutput(source)
      if (settings?.hide_on_copy) void getCurrentWindow().hide()
    }
  },
  performCopy: async (_text, clipId) => {
    const settings = useSettingsStore.getState().settings
    const source: ClipboardOutputSource =
      settings?.default_paste_format === 'plain'
        ? { kind: 'plain_text', clipId }
        : { kind: 'original', clipId }
    await copyClipboardOutput(source)
    if (settings?.hide_on_copy) void getCurrentWindow().hide()
  },
}))
