import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettingsStore } from './settingsStore'
import { useUIStore } from './uiStore'
import type { ClipItem, Tag } from '../shared/types'

type V2Tag = { id: string; name: string; color: string | null }
type V2Summary = {
  id: string; sourceAppName: string | null; capturedAt: number; updatedAt: number
  isPinned: boolean; isFavorite: boolean; note: string | null; tags: V2Tag[]; safeSummary: string
}
type V2Representation = {
  canonicalMimeType: string | null; textValue: string | null; fileReferences: string[]
  binaryFileId: string | null
}
type V2Detail = { clip: V2Summary; representations: V2Representation[] }
type V2Page<T> = { items: T[]; nextCursor: string | null }
type V2SearchResult = { clip: V2Summary; snippet: string | null }

type ClipboardState = {
  clips: ClipItem[]; availableTags: Tag[]; loading: boolean; error: string | null
  hasMore: boolean; currentOffset: number; mode: 'browse' | 'search'; searchQuery: string
  activeTab: 'all' | 'favorites' | 'pinned'; tagFilter: number | null
}
type ClipboardActions = {
  loadMoreClips: (limit?: number) => Promise<void>; addNewClip: (clip: ClipItem) => void
  mergeClipUpdate: (clip: ClipItem) => void; enterSearchMode: (query: string) => Promise<void>
  exitSearchMode: () => void; setActiveTab: (tab: 'all' | 'favorites' | 'pinned') => Promise<void>
  setTagFilter: (tagId: number | null) => Promise<void>; refreshAvailableTags: () => Promise<void>
  updateClipNote: (clipId: string, note: string | null) => Promise<void>; addClipTag: (clipId: string, tag: Tag) => Promise<void>
  removeClipTag: (clipId: string, tagId: number) => Promise<void>; createTagAndAttach: (clipId: string, name: string) => Promise<void>
  deleteAvailableTag: (tagId: number) => Promise<void>; deleteClip: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>; togglePin: (id: string) => Promise<void>; clearAllClips: () => Promise<void>
  copyDerivedText: (text: string) => Promise<void>; performPrimaryAction: (text: string, clipId: string) => Promise<void>
  performCopy: (text: string, clipId: string) => Promise<void>; resetPagination: () => void
}
type ClipboardStore = ClipboardState & ClipboardActions

const initialState: ClipboardState = { clips: [], availableTags: [], loading: false, error: null, hasMore: true, currentOffset: 0, mode: 'browse', searchQuery: '', activeTab: 'all', tagFilter: null }
const tagIds = new Map<number, string>()
let nextCursor: string | null | undefined
let eventListenerReady = false

const tagNumber = (id: string): number => {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  const number = Math.abs(hash) || 1
  tagIds.set(number, id)
  return number
}
const toTag = (tag: V2Tag): Tag => ({ id: tagNumber(tag.id), name: tag.name, color: tag.color, createdAt: 0 })
const v2TagId = (id: number): string => tagIds.get(id) ?? String(id)

const detectedType = (representations: V2Representation[]): ClipItem['detectedType'] => {
  const mimes = representations.map(rep => rep.canonicalMimeType ?? '')
  if (mimes.some(mime => mime.startsWith('image/'))) return 'image'
  if (mimes.some(mime => mime === 'text/html')) return 'html'
  if (mimes.some(mime => mime.includes('rtf'))) return 'rtf'
  if (mimes.some(mime => mime === 'application/json')) return 'json'
  if (mimes.some(mime => mime === 'text/csv')) return 'csv'
  if (representations.some(rep => rep.fileReferences.length > 0)) return 'files'
  return 'text'
}
const toClip = (detail: V2Detail): ClipItem => {
  const { clip, representations } = detail
  const text = representations.find(rep => rep.canonicalMimeType === 'text/plain')?.textValue
    ?? representations.find(rep => rep.textValue != null)?.textValue ?? clip.safeSummary
  const html = representations.find(rep => rep.canonicalMimeType === 'text/html')?.textValue ?? null
  const rtf = representations.find(rep => (rep.canonicalMimeType ?? '').includes('rtf'))?.textValue ?? null
  const image = representations.find(rep => (rep.canonicalMimeType ?? '').startsWith('image/'))
  const files = representations.find(rep => rep.fileReferences.length > 0)?.fileReferences ?? []
  return {
    id: clip.id, contentType: image ? 'image' : files.length ? 'files' : html ? 'html' : rtf ? 'rtf' : 'text',
    detectedType: detectedType(representations), contentText: text, contentHtml: html, contentRtf: rtf,
    svgPath: null, pdfPath: null, imagePath: image?.binaryFileId ? `clipsx-asset://localhost/${image.binaryFileId}` : null,
    attachmentPath: null, attachmentType: null, filePaths: files.length ? JSON.stringify(files) : null,
    ocrText: null, indexText: text, primaryTextSource: text ? 'clipboard' : 'none', ocrStatus: 'not_needed', metadata: null,
    note: clip.note, createdAt: Math.floor(clip.capturedAt / 1000), updatedAt: Math.floor(clip.updatedAt / 1000),
    appName: clip.sourceAppName, isPinned: clip.isPinned, isFavorite: clip.isFavorite, accessCount: 0,
    contentHash: null, tags: clip.tags.map(toTag),
  }
}
// List rows deliberately use summaries only. Representation/facet detail is loaded by V2ViewPanel for the selected clip.
const toSummaryClip = (clip: V2Summary): ClipItem => ({
  id: clip.id, contentType: 'text', detectedType: 'text', contentText: clip.safeSummary, contentHtml: null, contentRtf: null,
  svgPath: null, pdfPath: null, imagePath: null, attachmentPath: null, attachmentType: null, filePaths: null,
  ocrText: null, indexText: clip.safeSummary, primaryTextSource: 'clipboard', ocrStatus: 'not_needed', metadata: null,
  note: clip.note, createdAt: Math.floor(clip.capturedAt / 1000), updatedAt: Math.floor(clip.updatedAt / 1000),
  appName: clip.sourceAppName, isPinned: clip.isPinned, isFavorite: clip.isFavorite, accessCount: 0, contentHash: null,
  tags: clip.tags.map(toTag),
})
const scope = (state: ClipboardState) => state.activeTab === 'all' ? 'all' : state.activeTab
type ParsedSearch = { query: string; representationFamilies: string[]; facetIds: string[] }

const searchFilters: Record<string, { representationFamily?: string; facetId?: string }> = {
  text: { representationFamily: 'text' }, image: { representationFamily: 'image' },
  file: { representationFamily: 'files' }, files: { representationFamily: 'files' },
  html: { representationFamily: 'html' }, rtf: { representationFamily: 'rtf' },
  office: { representationFamily: 'office' }, document: { representationFamily: 'document' }, pdf: { representationFamily: 'document' },
  json: { facetId: 'core.data.json' }, csv: { facetId: 'core.data.table' }, table: { facetId: 'core.data.table' },
  url: { facetId: 'core.link.url' }, markdown: { facetId: 'core.text.markdown' }, code: { facetId: 'core.text.code' },
  email: { facetId: 'core.contact.email' }, color: { facetId: 'core.value.color' }, math: { facetId: 'core.math.expression' },
  phone: { facetId: 'core.contact.phone' }, path: { facetId: 'core.file.path' }, jwt: { facetId: 'core.token.jwt' },
  secret: { facetId: 'core.security.secret' }, date: { facetId: 'core.time.date' }, timestamp: { facetId: 'core.time.date' },
}

const parseSearch = (input: string): ParsedSearch => {
  const representationFamilies = new Set<string>()
  const facetIds = new Set<string>()
  const query = input.replace(/\/(\w+)/g, (token, name: string) => {
    const filter = searchFilters[name.toLowerCase()]
    if (!filter) return token
    if (filter.representationFamily) representationFamilies.add(filter.representationFamily)
    if (filter.facetId) facetIds.add(filter.facetId)
    return ''
  }).trim()
  return { query, representationFamilies: [...representationFamilies], facetIds: [...facetIds] }
}

const refreshVisibleClip = async (id: string) => {
  const state = useClipboardStore.getState()
  if (!state.clips.some(clip => clip.id === id)) return
  const clip = toClip(await invoke<V2Detail>('get_clip_detail', { clipId: id }))
  state.mergeClipUpdate(clip)
}
const ensureEvents = () => {
  if (eventListenerReady || typeof window === 'undefined') return
  eventListenerReady = true
  void Promise.all([
    listen<string>('clip-captured', event => {
      const id = event.payload
      void invoke<V2Detail>('get_clip_detail', { clipId: id })
        .then(detail => useClipboardStore.getState().addNewClip(toClip(detail)))
        .catch(() => undefined)
    }),
    listen<string>('clip-updated', event => { void refreshVisibleClip(event.payload).catch(() => undefined) }),
    listen<string>('clip-facets-updated', event => { if (event.payload) void refreshVisibleClip(event.payload).catch(() => undefined) }),
    listen<string>('clip-deleted', event => useClipboardStore.setState(state => ({ clips: state.clips.filter(clip => clip.id !== event.payload) }))),
  ])
}

export const useClipboardStore = create<ClipboardStore>(set => ({
  ...initialState,
  loadMoreClips: async (limit = 50) => {
    const state = useClipboardStore.getState(); if (state.loading || !state.hasMore) return
    ensureEvents(); set({ loading: true, error: null })
    try {
      const tagId = state.tagFilter === null ? null : v2TagId(state.tagFilter)
      let summaries: V2Summary[]
      let cursor: string | null
      if (state.mode === 'search') {
        const parsedSearch = parseSearch(state.searchQuery)
        const result = await invoke<V2Page<V2SearchResult>>('search_clips', { request: { query: parsedSearch.query, representationFamilies: parsedSearch.representationFamilies, facetIds: parsedSearch.facetIds, scope: scope(state), tagId, limit, cursor: nextCursor ?? null, mode: useUIStore.getState().isSemanticActive ? 'hybrid' : 'fts' } })
        summaries = result.items.map(item => item.clip); cursor = result.nextCursor
      } else {
        const result = await invoke<V2Page<V2Summary>>('list_clips', { request: { scope: scope(state), tagId, limit, cursor: nextCursor ?? null } })
        summaries = result.items; cursor = result.nextCursor
      }
      const clips = summaries.map(toSummaryClip); nextCursor = cursor
      set(current => ({ clips: [...current.clips, ...clips], loading: false, hasMore: cursor !== null, currentOffset: current.currentOffset + clips.length }))
    } catch (error) { set({ loading: false, error: String(error) }) }
  },
  addNewClip: clip => set(state => ({ clips: state.mode === 'browse' ? [clip, ...state.clips.filter(item => item.id !== clip.id)] : state.clips })),
  mergeClipUpdate: clip => set(state => ({ clips: state.clips.map(item => item.id === clip.id ? { ...item, ...clip } : item) })),
  resetPagination: () => { nextCursor = undefined; set({ currentOffset: 0, hasMore: true }) },
  setActiveTab: async tab => { nextCursor = undefined; set({ activeTab: tab, clips: [], currentOffset: 0, hasMore: true }); await useClipboardStore.getState().loadMoreClips() },
  enterSearchMode: async query => { nextCursor = undefined; set({ mode: 'search', searchQuery: query, clips: [], currentOffset: 0, hasMore: true }); await useClipboardStore.getState().loadMoreClips() },
  exitSearchMode: () => { nextCursor = undefined; set({ mode: 'browse', searchQuery: '', clips: [], currentOffset: 0, hasMore: true }); void useClipboardStore.getState().loadMoreClips() },
  setTagFilter: async tagFilter => { nextCursor = undefined; set({ tagFilter, clips: [], currentOffset: 0, hasMore: true }); await useClipboardStore.getState().loadMoreClips() },
  refreshAvailableTags: async () => { try { set({ availableTags: (await invoke<V2Tag[]>('list_tags')).map(toTag) }) } catch (error) { set({ error: String(error) }) } },
  updateClipNote: async (clipId, note) => { await invoke('update_clip_note', { clipId, note: note?.trim() || null }); await refreshVisibleClip(clipId) },
  addClipTag: async (clipId, tag) => { await invoke('add_clip_tag', { clipId, tagId: v2TagId(tag.id) }); await refreshVisibleClip(clipId) },
  removeClipTag: async (clipId, tagId) => { await invoke('remove_clip_tag', { clipId, tagId: v2TagId(tagId) }); await refreshVisibleClip(clipId) },
  createTagAndAttach: async (clipId, name) => {
    const result = await invoke<V2Tag>('create_tag', { name: name.trim(), color: '#3b82f6' }); const tag = toTag(result)
    set(state => ({ availableTags: [...state.availableTags, tag] })); await useClipboardStore.getState().addClipTag(clipId, tag)
  },
  deleteAvailableTag: async tagId => { await invoke('delete_tag', { tagId: v2TagId(tagId) }); set(state => ({ availableTags: state.availableTags.filter(tag => tag.id !== tagId), clips: state.clips.map(clip => ({ ...clip, tags: clip.tags?.filter(tag => tag.id !== tagId) })) })) },
  deleteClip: async id => { await invoke('delete_clip', { clipId: id }); set(state => ({ clips: state.clips.filter(clip => clip.id !== id) })) },
  toggleFavorite: async id => { const clip = useClipboardStore.getState().clips.find(item => item.id === id); if (!clip) return; await invoke('set_clip_favorite', { clipId: id, value: !clip.isFavorite }); await refreshVisibleClip(id) },
  togglePin: async id => { const clip = useClipboardStore.getState().clips.find(item => item.id === id); if (!clip) return; await invoke('set_clip_pinned', { clipId: id, value: !clip.isPinned }); await refreshVisibleClip(id) },
  clearAllClips: async () => { await invoke('clear_history'); set({ clips: [], currentOffset: 0, hasMore: false }) },
  copyDerivedText: async text => navigator.clipboard.writeText(text),
  performPrimaryAction: async (_text, clipId) => {
    const settings = useSettingsStore.getState().settings; const policy = settings?.default_paste_format === 'plain' ? { kind: 'plainText', clipId } : { kind: 'original', clipId }
    if (settings?.paste_on_enter) await invoke('paste_clip_output', { policy }); else { await invoke('copy_clip_output', { policy }); if (settings?.hide_on_copy) void getCurrentWindow().hide() }
  },
  performCopy: async (_text, clipId) => {
    const settings = useSettingsStore.getState().settings; const policy = settings?.default_paste_format === 'plain' ? { kind: 'plainText', clipId } : { kind: 'original', clipId }
    await invoke('copy_clip_output', { policy }); if (settings?.hide_on_copy) void getCurrentWindow().hide()
  },
}))
