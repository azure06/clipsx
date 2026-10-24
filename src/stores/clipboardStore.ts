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
import { parseSearch } from '../features/search/searchQuery'
import { KEYWORD_DELAY_MS, SEMANTIC_DELAY_MS } from '../features/search/progressive'
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
  // Query/filter state describes the desired page; clips remain the last
  // committed page until a replacement succeeds.
  resultsStale: boolean
  // A prepared query is waiting for the input controller's idle timer/IME.
  searchScheduled: boolean
  semanticPending: boolean
  privacyChecksPending: number
  decisionPhase: 'privacy' | 'organizing'
  captureNotice:
    'inputLimit' | 'unreviewed' | 'sizeLimit' | 'excluded' | 'checkFailed' | 'notSaved' | null
  relatedClipIds: string[]
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
  prepareSearch: (query: string, force?: boolean) => void
  commitSearch: () => Promise<void>
  retryResults: () => Promise<void>
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
  cancelSearch: () => void
  resetPagination: () => void
  refreshSearch: () => Promise<void>
}
type ClipboardStore = ClipboardState & ClipboardActions

const initialState: ClipboardState = {
  clips: [],
  availableTags: [],
  loading: false,
  resultsStale: false,
  searchScheduled: false,
  semanticPending: false,
  privacyChecksPending: 0,
  decisionPhase: 'privacy',
  captureNotice: null,
  relatedClipIds: [],
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
let semanticTimer: ReturnType<typeof setTimeout> | undefined
const cancelSemantic = () => {
  clearTimeout(semanticTimer)
  semanticTimer = undefined
}

const scope = (state: ClipboardState) => (state.activeTab === 'all' ? 'all' : state.activeTab)
const matchesVisibleScope = (state: ClipboardState, clip: ClipSummary) => {
  if (state.activeTab === 'favorites' && !clip.isFavorite) return false
  if (state.activeTab === 'pinned' && !clip.isPinned) return false
  if (state.tagFilter !== null && !clip.tags?.some(tag => tag.id === state.tagFilter)) return false
  return true
}
type ArtifactUpdate = { clipId: string; sourceId: string }

const refreshVisibleClip = async (id: string) => {
  const state = useClipboardStore.getState()
  if (!state.clips.some(clip => clip.id === id)) return
  const detail = await invoke<V2Detail>('get_clip_detail', { clipId: id })
  state.mergeClipUpdate(detail.clip)
}
type ClipFacetsUpdated = { clipId: string | null }
type CapturePrivacyStatus = { pending: number }
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
    listen<ClipFacetsUpdated>('clip-facets-updated', event => {
      if (event.payload.clipId) {
        void refreshVisibleClip(event.payload.clipId).catch(() => undefined)
        return
      }
      const ids = useClipboardStore.getState().clips.map(clip => clip.id)
      void Promise.all(ids.map(id => refreshVisibleClip(id))).catch(() => undefined)
    }),
    listen<ArtifactUpdate>('clip-artifacts-updated', event => {
      void refreshVisibleClip(event.payload.clipId).catch(() => undefined)
    }),
    listen<CapturePrivacyStatus>('capture-privacy-status', event => {
      useClipboardStore.setState({
        privacyChecksPending: Math.max(0, Number(event.payload.pending) || 0),
      })
    }),
    listen<'privacy' | 'organizing'>('capture-decision-phase', event => {
      useClipboardStore.setState({ decisionPhase: event.payload })
    }),
    listen<string>('capture-notice', event => {
      useClipboardStore.setState({
        captureNotice: event.payload === 'input_limit' ? 'inputLimit' : 'unreviewed',
      })
    }),
    listen<string>('capture-rejected', event => {
      const reason = event.payload
      useClipboardStore.setState({
        captureNotice: reason.includes('configured limit')
          ? 'sizeLimit'
          : reason.includes('privacy_secret_not_saved') || reason.includes('privacy_rule_not_saved')
            ? 'excluded'
            : reason.includes('privacy_check_unavailable_not_saved')
              ? 'checkFailed'
              : 'notSaved',
      })
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
    if (state.loading || !state.hasMore || state.searchScheduled) return
    const generation = requestGeneration
    const replace = state.resultsStale
    const firstPage = replace || nextCursor === undefined
    const started = Date.now()
    ensureEvents()
    set({ loading: true, error: null })
    try {
      const tagId = state.tagFilter
      let summaries: ClipSummary[]
      let cursor: string | null
      let sourceOutcomes: SearchSourceOutcome[] = []
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
            enabledSourceIds: ['builtin.search.fts'],
          },
        })
        if (generation !== requestGeneration) return
        summaries = result.items.map(item => ({
          ...item.clip,
          similarityScore: item.rank,
          searchMatches: item.matches,
        }))
        sourceOutcomes = result.sourceOutcomes
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
      set(current => {
        const relatedIds = new Set(current.relatedClipIds)
        const keywordIds = new Set(
          current.clips.filter(clip => !relatedIds.has(clip.id)).map(clip => clip.id)
        )
        const incomingIds = new Set(clips.map(clip => clip.id))
        return {
          clips: replace
            ? clips
            : [
                ...current.clips.filter(clip => !relatedIds.has(clip.id)),
                ...clips.filter(clip => !keywordIds.has(clip.id)),
                ...current.clips.filter(
                  clip => relatedIds.has(clip.id) && !incomingIds.has(clip.id)
                ),
              ],
          relatedClipIds: replace ? [] : current.relatedClipIds.filter(id => !incomingIds.has(id)),
          loading: false,
          resultsStale: false,
          searchSourceOutcomes: firstPage
            ? sourceOutcomes
            : [
                ...sourceOutcomes,
                ...current.searchSourceOutcomes.filter(
                  outcome => outcome.sourceId === 'builtin.search.semantic_text'
                ),
              ],
          hasMore: cursor !== null,
          currentOffset: (replace ? 0 : current.currentOffset) + clips.length,
        }
      })
      if (state.mode === 'search' && firstPage && useUIStore.getState().isSemanticActive) {
        set({ semanticPending: true })
        cancelSemantic()
        const parsed = parseSearch(state.searchQuery)
        semanticTimer = setTimeout(
          () => {
            semanticTimer = undefined
            void invoke<V2SearchPage>('search_clips', {
              request: {
                query: parsed.query,
                representationFamilies: parsed.representationFamilies,
                facetIds: parsed.facetIds,
                scope: scope(state),
                tagId: state.tagFilter,
                limit: 50,
                cursor: null,
                enabledSourceIds: ['builtin.search.fts', 'builtin.search.semantic_text'],
              },
            })
              .then(result => {
                if (generation !== requestGeneration) return
                set(current => {
                  const existing = new Set(current.clips.map(clip => clip.id))
                  const related = result.items
                    .filter(
                      item =>
                        !existing.has(item.clip.id) &&
                        item.matches.some(
                          match => match.sourceId === 'builtin.search.semantic_text'
                        )
                    )
                    .map(item => ({
                      ...item.clip,
                      similarityScore: item.rank,
                      searchMatches: item.matches,
                    }))
                  return {
                    clips: [...current.clips, ...related],
                    relatedClipIds: [...current.relatedClipIds, ...related.map(clip => clip.id)],
                    semanticPending: false,
                    searchSourceOutcomes: [
                      ...current.searchSourceOutcomes.filter(
                        outcome => outcome.sourceId !== 'builtin.search.semantic_text'
                      ),
                      ...result.sourceOutcomes.filter(
                        outcome => outcome.sourceId === 'builtin.search.semantic_text'
                      ),
                    ],
                  }
                })
              })
              .catch(() => {
                if (generation !== requestGeneration) return
                set(current => ({
                  semanticPending: false,
                  searchSourceOutcomes: [
                    ...current.searchSourceOutcomes.filter(
                      outcome => outcome.sourceId !== 'builtin.search.semantic_text'
                    ),
                    {
                      sourceId: 'builtin.search.semantic_text',
                      status: 'unavailable',
                      diagnostic: null,
                    },
                  ],
                }))
              })
          },
          Math.max(0, SEMANTIC_DELAY_MS - KEYWORD_DELAY_MS - (Date.now() - started))
        )
      }
    } catch (error) {
      if (generation !== requestGeneration) return
      set({ loading: false, error: String(error) })
    }
  },
  addNewClip: clip =>
    set(state => ({
      clips:
        !state.resultsStale && state.mode === 'browse' && matchesVisibleScope(state, clip)
          ? [clip, ...state.clips.filter(item => item.id !== clip.id)]
          : state.clips,
    })),
  mergeClipUpdate: clip =>
    set(state => ({
      clips: state.clips
        .map(item => (item.id === clip.id ? { ...item, ...clip } : item))
        .filter(item => state.resultsStale || matchesVisibleScope(state, item)),
    })),
  cancelSearch: () => {
    requestGeneration += 1
    cancelSemantic()
    set({ loading: false, semanticPending: false })
  },
  resetPagination: () => {
    requestGeneration += 1
    cancelSemantic()
    nextCursor = undefined
    set({
      currentOffset: 0,
      hasMore: true,
      loading: false,
      semanticPending: false,
      resultsStale: true,
      searchScheduled: false,
      error: null,
    })
  },
  prepareSearch: (raw, force = false) => {
    const query = raw.trim()
    const state = useClipboardStore.getState()
    const mode = query ? 'search' : 'browse'
    if (!force && state.searchQuery === query && state.mode === mode) return
    requestGeneration += 1
    cancelSemantic()
    nextCursor = undefined
    set({
      mode,
      searchQuery: query,
      resultsStale: true,
      searchScheduled: true,
      semanticPending: false,
      loading: false,
      error: null,
      currentOffset: 0,
      hasMore: true,
    })
  },
  commitSearch: async () => {
    if (!useClipboardStore.getState().searchScheduled) return
    set({ searchScheduled: false })
    await useClipboardStore.getState().loadMoreClips()
  },
  retryResults: async () => {
    useClipboardStore.getState().resetPagination()
    await useClipboardStore.getState().loadMoreClips()
  },
  refreshSearch: async () => {
    const state = useClipboardStore.getState()
    if (state.mode !== 'search') return
    await state.retryResults()
  },
  setActiveTab: async tab => {
    if (useClipboardStore.getState().activeTab === tab) return
    set({ activeTab: tab })
    await useClipboardStore.getState().retryResults()
  },
  enterSearchMode: async query => {
    useClipboardStore.getState().prepareSearch(query)
    await useClipboardStore.getState().commitSearch()
  },
  exitSearchMode: () => {
    useClipboardStore.getState().prepareSearch('')
    void useClipboardStore.getState().commitSearch()
  },
  setTagFilter: async tagFilter => {
    if (useClipboardStore.getState().tagFilter === tagFilter) return
    set({ tagFilter })
    await useClipboardStore.getState().retryResults()
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
    if (useClipboardStore.getState().resultsStale) return
    await invoke('add_clip_tag', { clipId, tagId: tag.id })
    await refreshVisibleClip(clipId)
  },
  removeClipTag: async (clipId, tagId) => {
    if (useClipboardStore.getState().resultsStale) return
    await invoke('remove_clip_tag', { clipId, tagId })
    await refreshVisibleClip(clipId)
  },
  createTagAndAttach: async (clipId, name) => {
    if (useClipboardStore.getState().resultsStale) return
    const result = await invoke<V2Tag>('create_tag', { name: name.trim(), color: '#3b82f6' })
    set(state => ({ availableTags: [...state.availableTags, result] }))
    // Finish the operation already started, even if typing made results stale.
    await invoke('add_clip_tag', { clipId, tagId: result.id })
    await refreshVisibleClip(clipId)
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
    if (useClipboardStore.getState().resultsStale) return
    await invoke('delete_clip', { clipId: id })
    set(state => ({ clips: state.clips.filter(clip => clip.id !== id) }))
  },
  toggleFavorite: async id => {
    if (useClipboardStore.getState().resultsStale) return
    const generation = requestGeneration
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
      if (generation === requestGeneration) set({ clips: before.clips, error: String(error) })
      throw error
    }
  },
  togglePin: async id => {
    if (useClipboardStore.getState().resultsStale) return
    const generation = requestGeneration
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
      if (generation === requestGeneration) set({ clips: before.clips, error: String(error) })
      throw error
    }
  },
  clearAllClips: async () => {
    await invoke('clear_history')
    requestGeneration += 1
    cancelSemantic()
    nextCursor = undefined
    set({
      clips: [],
      relatedClipIds: [],
      semanticPending: false,
      currentOffset: 0,
      hasMore: false,
      loading: false,
      resultsStale: false,
      searchScheduled: false,
      searchSourceOutcomes: [],
      error: null,
    })
  },
  copyDerivedText: async text => {
    await copyLiteralText(text)
  },
  performPrimaryAction: async (_text, clipId) => {
    if (useClipboardStore.getState().resultsStale) return
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
    if (useClipboardStore.getState().resultsStale) return
    const settings = useSettingsStore.getState().settings
    const source: ClipboardOutputSource =
      settings?.default_paste_format === 'plain'
        ? { kind: 'plain_text', clipId }
        : { kind: 'original', clipId }
    await copyClipboardOutput(source)
    if (settings?.hide_on_copy) void getCurrentWindow().hide()
  },
}))
