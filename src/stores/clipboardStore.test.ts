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
          hasPlainText: true,
          shareable: true,
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
      hasPlainText: true,
      shareable: true,
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
  hasPlainText: true,
  shareable: true,
  ...overrides,
})

const workTag: V2Tag = {
  id: 'tag-work',
  name: 'work',
  color: '#fff',
}

describe('search replacement consistency', () => {
  beforeEach(() => {
    useClipboardStore.setState(useClipboardStore.getInitialState(), true)
    useClipboardStore.getState().resetPagination()
    useClipboardStore.setState(
      { ...useClipboardStore.getInitialState(), clips: [makeClip({ id: 'previous' })] },
      true
    )
    mockInvoke.mockReset()
  })

  const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<T>((yes, no) => {
      resolve = yes
      reject = no
    })
    return { promise, resolve, reject }
  }
  const page = (id: string, nextCursor: string | null = null) => ({
    items: [{ clip: makeClip({ id }), snippet: null, rank: 1, matches: [] }],
    nextCursor,
    sourceOutcomes: [{ sourceId: 'builtin.search.fts', status: 'used' as const, diagnostic: null }],
  })

  it('retains results during debounce and replaces the first page atomically', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    mockInvoke.mockReturnValueOnce(pending.promise)
    const previous = useClipboardStore.getState().clips
    useClipboardStore.getState().prepareSearch('new')
    await useClipboardStore.getState().loadMoreClips()
    expect(mockInvoke).not.toHaveBeenCalled()
    const request = useClipboardStore.getState().commitSearch()
    expect(useClipboardStore.getState().clips).toBe(previous)
    expect(useClipboardStore.getState().resultsStale).toBe(true)
    const published: string[][] = []
    const unsubscribe = useClipboardStore.subscribe(state => {
      if (!state.resultsStale) published.push(state.clips.map(clip => clip.id))
    })
    pending.resolve(page('new', 'cursor-new'))
    await request
    unsubscribe()
    expect(published).toEqual([['new']])
    expect(useClipboardStore.getState()).toMatchObject({
      currentOffset: 1,
      loading: false,
      hasMore: true,
      searchSourceOutcomes: page('new').sourceOutcomes,
    })
    mockInvoke.mockResolvedValueOnce(page('next'))
    await useClipboardStore.getState().loadMoreClips()
    expect(mockInvoke).toHaveBeenLastCalledWith('search_clips', {
      request: expect.objectContaining({ query: 'new', cursor: 'cursor-new' }) as unknown,
    })
    expect(useClipboardStore.getState().clips.map(clip => clip.id)).toEqual(['new', 'next'])
  })

  it('discards stale results and diagnostics even before the next query is submitted', async () => {
    const old = deferred<ReturnType<typeof page>>()
    mockInvoke.mockReturnValueOnce(old.promise)
    const request = useClipboardStore.getState().enterSearchMode('old')
    useClipboardStore.getState().prepareSearch('latest')
    old.resolve(page('obsolete', 'obsolete-cursor'))
    await request
    expect(useClipboardStore.getState()).toMatchObject({
      searchQuery: 'latest',
      searchSourceOutcomes: [],
      resultsStale: true,
      searchScheduled: true,
    })
    expect(useClipboardStore.getState().clips[0]?.id).toBe('previous')
    mockInvoke.mockResolvedValueOnce(page('latest'))
    await useClipboardStore.getState().commitSearch()
    expect(mockInvoke).toHaveBeenLastCalledWith('search_clips', {
      request: expect.objectContaining({ cursor: null }) as unknown,
    })
  })

  it('ignores late success and failure after a newer response', async () => {
    for (const fail of [false, true]) {
      const old = deferred<ReturnType<typeof page>>()
      mockInvoke.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('latest'))
      const request = useClipboardStore.getState().enterSearchMode(`old-${fail}`)
      await useClipboardStore.getState().enterSearchMode(`latest-${fail}`)
      if (fail) old.reject(new Error('obsolete failure'))
      else old.resolve(page('obsolete'))
      await request
      expect(useClipboardStore.getState().clips[0]?.id).toBe('latest')
      expect(useClipboardStore.getState()).toMatchObject({
        error: null,
        loading: false,
        resultsStale: false,
        searchSourceOutcomes: page('latest').sourceOutcomes,
      })
    }
  })

  it('retains prior results after failure and replaces them on retry', async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error('search failed'))
      .mockResolvedValueOnce(page('recovered'))
    await useClipboardStore.getState().enterSearchMode('query')
    expect(useClipboardStore.getState()).toMatchObject({
      resultsStale: true,
      loading: false,
      error: 'Error: search failed',
    })
    expect(useClipboardStore.getState().clips[0]?.id).toBe('previous')
    await useClipboardStore.getState().retryResults()
    expect(useClipboardStore.getState().clips[0]?.id).toBe('recovered')
    expect(useClipboardStore.getState().resultsStale).toBe(false)
  })

  it('clearing the query invalidates an active search and restores browsing', async () => {
    const old = deferred<ReturnType<typeof page>>()
    mockInvoke
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ items: [makeClip({ id: 'browse' })], nextCursor: null })
    const request = useClipboardStore.getState().enterSearchMode('old')
    useClipboardStore.getState().prepareSearch('')
    await useClipboardStore.getState().commitSearch()
    old.resolve(page('obsolete'))
    await request
    expect(useClipboardStore.getState()).toMatchObject({
      mode: 'browse',
      searchQuery: '',
      searchSourceOutcomes: [],
      resultsStale: false,
    })
    expect(useClipboardStore.getState().clips[0]?.id).toBe('browse')
  })

  it('filters use the latest draft and cannot append an old page', async () => {
    mockInvoke.mockResolvedValueOnce(page('initial', 'old-cursor'))
    await useClipboardStore.getState().enterSearchMode('initial')
    const oldPage = deferred<ReturnType<typeof page>>()
    mockInvoke.mockReturnValueOnce(oldPage.promise)
    const paging = useClipboardStore.getState().loadMoreClips()
    useClipboardStore.getState().prepareSearch('new draft')
    mockInvoke.mockResolvedValueOnce(page('filtered'))
    await useClipboardStore.getState().setTagFilter('work')
    oldPage.resolve(page('obsolete'))
    await paging
    await useClipboardStore.getState().commitSearch()
    expect(mockInvoke).toHaveBeenLastCalledWith('search_clips', {
      request: expect.objectContaining({
        query: 'new draft',
        tagId: 'work',
        cursor: null,
      }) as unknown,
    })
    expect(useClipboardStore.getState().clips.map(clip => clip.id)).toEqual(['filtered'])
  })

  it('blocks copy and mutations of stale results', async () => {
    useClipboardStore.getState().prepareSearch('new')
    await useClipboardStore.getState().performCopy('', 'previous')
    await useClipboardStore.getState().performPrimaryAction('', 'previous')
    await useClipboardStore.getState().toggleFavorite('previous')
    await useClipboardStore.getState().deleteClip('previous')
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('useClipboardStore filtered view stability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useClipboardStore.setState({
      clips: [],
      availableTags: [],
      loading: false,
      resultsStale: false,
      searchScheduled: false,
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
      resultsStale: false,
      searchScheduled: false,
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
