import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipboardStore } from './clipboardStore'
import { useSettingsStore } from './settingsStore'
import type { ClipSummary, V2Tag } from '../shared/types/v2'
import { DEFAULT_SETTINGS } from '../shared/types'

const { mockInvoke, mockHide } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockHide: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: mockHide,
  }),
}))

describe('useClipboardStore.copyDerivedText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes derived copies through the backend plain-text copy command without hiding the window', async () => {
    await useClipboardStore.getState().copyDerivedText('example.com')

    expect(mockInvoke).toHaveBeenCalledWith('execute_clipboard_output', {
      request: {
        disposition: 'copy',
        source: { kind: 'literal_text', text: 'example.com' },
      },
    })
    expect(mockHide).not.toHaveBeenCalled()
  })
})

describe('useClipboardStore.performCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, hide_on_copy: false },
      isLoading: false,
      error: null,
    })
  })

  it('hides the window after explicit copy when hide_on_copy is enabled', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, hide_on_copy: true },
    })

    await useClipboardStore.getState().performCopy('copied text', 'clip-1')

    expect(mockInvoke).toHaveBeenCalledWith('execute_clipboard_output', {
      request: { disposition: 'copy', source: { kind: 'original', clipId: 'clip-1' } },
    })
    expect(mockHide).toHaveBeenCalledTimes(1)
  })

  it('does not hide the window after explicit copy when hide_on_copy is disabled', async () => {
    await useClipboardStore.getState().performCopy('copied text', 'clip-1')

    expect(mockInvoke).toHaveBeenCalledWith('execute_clipboard_output', {
      request: { disposition: 'copy', source: { kind: 'original', clipId: 'clip-1' } },
    })
    expect(mockHide).not.toHaveBeenCalled()
  })

  it('uses the snake-case policy kind and camel-case field for plain text', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, default_paste_format: 'plain' },
    })

    await useClipboardStore.getState().performCopy('copied text', 'clip-1')

    expect(mockInvoke).toHaveBeenCalledWith('execute_clipboard_output', {
      request: { disposition: 'copy', source: { kind: 'plain_text', clipId: 'clip-1' } },
    })
  })
})

describe('useClipboardStore.performPrimaryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      isLoading: false,
      error: null,
    })
  })

  it('copies without pasting or hiding with the default settings', async () => {
    await useClipboardStore.getState().performPrimaryAction('copied text', 'clip-1')

    expect(mockInvoke).toHaveBeenCalledWith('execute_clipboard_output', {
      request: { disposition: 'copy', source: { kind: 'original', clipId: 'clip-1' } },
    })
    expect(mockHide).not.toHaveBeenCalled()
  })
})

describe('useClipboardStore.mergeClipUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useClipboardStore.setState({
      clips: [
        {
          id: 'clip-1',
          sourceAppName: null,
          sourceAppId: null,
          capturedAt: 1,
          note: 'keep me',
          updatedAt: 1,
          isPinned: false,
          isFavorite: false,
          tags: [{ id: 'tag-saved', name: 'saved', color: '#fff' }],
          historyPreview: {
            leading: { kind: 'none' },
            title: 'hello',
            subtitle: null,
            badge: null,
            accessibilityLabel: 'hello',
          },
          representationCount: 1,
          primaryPresentationKind: 'text',
          thumbnailAssetId: null,
        },
      ],
    })
  })

  it('applies authoritative mutable fields while preserving omitted summary fields', () => {
    useClipboardStore.getState().mergeClipUpdate({
      id: 'clip-1',
      sourceAppName: null,
      sourceAppId: null,
      capturedAt: 1,
      note: null,
      updatedAt: 2,
      isPinned: false,
      isFavorite: false,
      tags: [{ id: 'tag-saved', name: 'saved', color: '#fff' }],
      historyPreview: {
        leading: { kind: 'none' },
        title: 'hello',
        subtitle: null,
        badge: null,
        accessibilityLabel: 'hello',
      },
      representationCount: 1,
      primaryPresentationKind: 'text',
      thumbnailAssetId: null,
    })

    expect(useClipboardStore.getState().clips[0]).toMatchObject({
      id: 'clip-1',
      note: null,
      tags: [{ id: 'tag-saved', name: 'saved', color: '#fff' }],
    })
  })
})

const makeClip = (overrides: Partial<ClipSummary> = {}): ClipSummary => ({
  id: 'clip-1',
  sourceAppName: null,
  sourceAppId: null,
  capturedAt: 1,
  note: null,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  tags: [],
  historyPreview: {
    leading: { kind: 'none' },
    title: 'hello',
    subtitle: null,
    badge: null,
    accessibilityLabel: 'hello',
  },
  representationCount: 1,
  primaryPresentationKind: 'text',
  thumbnailAssetId: null,
  ...overrides,
})

const workTag: V2Tag = {
  id: 'tag-work',
  name: 'work',
  color: '#fff',
}

describe('useClipboardStore filtered view stability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useClipboardStore.setState({
      clips: [],
      availableTags: [],
      loading: false,
      error: null,
      hasMore: false,
      currentOffset: 0,
      mode: 'browse',
      searchQuery: '',
      activeTab: 'all',
      tagFilter: null,
    })
  })

  it('does not inject new non-favorite clips into favorites tab', () => {
    useClipboardStore.setState({
      activeTab: 'favorites',
      clips: [makeClip({ id: 'fav-1', isFavorite: true })],
      currentOffset: 1,
    })

    useClipboardStore.getState().addNewClip(makeClip({ id: 'clip-2', isFavorite: false }))

    expect(useClipboardStore.getState().clips.map(clip => clip.id)).toEqual(['fav-1'])
    expect(useClipboardStore.getState().currentOffset).toBe(1)
  })

  it('does not inject new non-pinned clips into pinned tab', () => {
    useClipboardStore.setState({
      activeTab: 'pinned',
      clips: [makeClip({ id: 'pin-1', isPinned: true })],
      currentOffset: 1,
    })

    useClipboardStore.getState().addNewClip(makeClip({ id: 'clip-2', isPinned: false }))

    expect(useClipboardStore.getState().clips.map(clip => clip.id)).toEqual(['pin-1'])
    expect(useClipboardStore.getState().currentOffset).toBe(1)
  })

  it('does not inject unmatched new clips when a tag filter is active', () => {
    useClipboardStore.setState({
      tagFilter: workTag.id,
      clips: [makeClip({ id: 'tagged-1', tags: [workTag] })],
      currentOffset: 1,
    })

    useClipboardStore.getState().addNewClip(makeClip({ id: 'clip-2', tags: [] }))

    expect(useClipboardStore.getState().clips.map(clip => clip.id)).toEqual(['tagged-1'])
    expect(useClipboardStore.getState().currentOffset).toBe(1)
  })

  it('keeps search results stable when new clips arrive', () => {
    useClipboardStore.setState({
      mode: 'search',
      searchQuery: 'hello',
      clips: [makeClip({ id: 'result-1' })],
      currentOffset: 1,
    })

    useClipboardStore.getState().addNewClip(makeClip({ id: 'clip-2' }))

    expect(useClipboardStore.getState().clips.map(clip => clip.id)).toEqual(['result-1'])
    expect(useClipboardStore.getState().currentOffset).toBe(1)
  })

  it('removes a clip from favorites tab immediately when unfavorited', async () => {
    useClipboardStore.setState({
      activeTab: 'favorites',
      clips: [makeClip({ id: 'fav-1', isFavorite: true })],
      currentOffset: 1,
    })
    mockInvoke.mockResolvedValueOnce(false)

    await useClipboardStore.getState().toggleFavorite('fav-1')

    expect(useClipboardStore.getState().clips).toEqual([])
    expect(useClipboardStore.getState().currentOffset).toBe(0)
  })

  it('removes a clip from pinned tab immediately when unpinned', async () => {
    useClipboardStore.setState({
      activeTab: 'pinned',
      clips: [makeClip({ id: 'pin-1', isPinned: true })],
      currentOffset: 1,
    })
    mockInvoke.mockResolvedValueOnce(false)

    await useClipboardStore.getState().togglePin('pin-1')

    expect(useClipboardStore.getState().clips).toEqual([])
    expect(useClipboardStore.getState().currentOffset).toBe(0)
  })

  it('re-runs search when active tab changes during search mode', async () => {
    mockInvoke.mockResolvedValueOnce([])
    mockInvoke.mockResolvedValueOnce([])

    useClipboardStore.setState({
      mode: 'search',
      searchQuery: 'hello',
      activeTab: 'all',
      clips: [],
      currentOffset: 0,
      hasMore: true,
    })

    await useClipboardStore.getState().setActiveTab('favorites')

    expect(mockInvoke).toHaveBeenCalledWith('search_clips', {
      request: {
        query: 'hello',
        representationFamilies: [],
        facetIds: [],
        scope: 'favorites',
        tagId: null,
        limit: 50,
        cursor: null,
        enabledSourceIds: ['builtin.search.fts', 'builtin.search.semantic_text'],
      },
    })
  })

  it('discards an older browse response after a search starts', async () => {
    mockInvoke.mockReset()
    let resolveBrowse!: (value: { items: ClipSummary[]; nextCursor: null }) => void
    const browse = new Promise<{ items: ClipSummary[]; nextCursor: null }>(resolve => {
      resolveBrowse = resolve
    })
    mockInvoke.mockReturnValueOnce(browse).mockResolvedValueOnce({
      items: [{ clip: makeClip({ id: 'search-result' }), snippet: null, rank: 0 }],
      nextCursor: null,
    })
    useClipboardStore.setState({ hasMore: true, loading: false })

    const browseRequest = useClipboardStore.getState().loadMoreClips()
    const searchRequest = useClipboardStore.getState().enterSearchMode('doc')
    await searchRequest
    resolveBrowse({ items: [makeClip({ id: 'stale-browse-result' })], nextCursor: null })
    await browseRequest

    expect(useClipboardStore.getState().clips.map(clip => clip.id)).toEqual(['search-result'])
    expect(useClipboardStore.getState().mode).toBe('search')
  })
})

describe('useClipboardStore authoritative summary updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useClipboardStore.setState({
      clips: [makeClip({ id: 'img-1', primaryPresentationKind: 'image' })],
      availableTags: [],
      loading: false,
      error: null,
      hasMore: false,
      currentOffset: 1,
      mode: 'browse',
      searchQuery: '',
      activeTab: 'all',
      tagFilter: null,
    })
  })

  it('merges rebuilt search summary text without loading representations into the store', () => {
    useClipboardStore.getState().mergeClipUpdate(
      makeClip({
        id: 'img-1',
        primaryPresentationKind: 'image',
        historyPreview: {
          leading: { kind: 'none' },
          title: 'extracted text',
          subtitle: null,
          badge: null,
          accessibilityLabel: 'extracted text',
        },
      })
    )

    expect(useClipboardStore.getState().clips[0]!.historyPreview.title).toBe('extracted text')
  })

  it('does not add an update for a clip outside the current list', () => {
    useClipboardStore.getState().mergeClipUpdate(makeClip({ id: 'unknown-clip' }))

    expect(useClipboardStore.getState().clips).toHaveLength(1)
    expect(useClipboardStore.getState().clips[0]!.id).toBe('img-1')
  })
})
