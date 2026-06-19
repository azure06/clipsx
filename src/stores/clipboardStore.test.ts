import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipboardStore } from './clipboardStore'
import { useSettingsStore } from './settingsStore'
import type { ClipItem, Tag } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

const { mockInvoke, mockHide } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockHide: vi.fn(),
}))

let clipboardWriteTextMock = vi.fn()

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
    clipboardWriteTextMock = vi.fn()

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    })
  })

  it('routes derived copies through the backend plain-text copy command without hiding the window', async () => {
    await useClipboardStore.getState().copyDerivedText('example.com')

    expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', {
      text: 'example.com',
      plain: true,
      trackUsage: false,
    })
    expect(mockHide).not.toHaveBeenCalled()
    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
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

    expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', {
      text: 'copied text',
      clipId: 'clip-1',
      plain: undefined,
      trackUsage: true,
    })
    expect(mockHide).toHaveBeenCalledTimes(1)
  })

  it('does not hide the window after explicit copy when hide_on_copy is disabled', async () => {
    await useClipboardStore.getState().performCopy('copied text', 'clip-1')

    expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', {
      text: 'copied text',
      clipId: 'clip-1',
      plain: undefined,
      trackUsage: true,
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
          contentType: 'text',
          detectedType: 'text',
          contentText: 'hello',
          contentHtml: null,
          contentRtf: null,
          svgPath: null,
          pdfPath: null,
          imagePath: null,
          attachmentPath: null,
          attachmentType: null,
          filePaths: null,
          ocrText: null,
          indexText: 'hello',
          primaryTextSource: 'clipboard',
          ocrStatus: 'not_needed',
          metadata: null,
          note: 'keep me',
          createdAt: 1,
          updatedAt: 1,
          appName: null,
          isPinned: false,
          isFavorite: false,
          accessCount: 0,
          contentHash: null,
          hasEmbedding: false,
          tags: [{ id: 1, name: 'saved', color: '#fff', createdAt: 1 }],
        },
      ],
    })
  })

  it('updates existing clip state without dropping local tags or note', () => {
    useClipboardStore.getState().mergeClipUpdate({
      id: 'clip-1',
      contentType: 'text',
      detectedType: 'text',
      contentText: 'hello',
      contentHtml: null,
      contentRtf: null,
      svgPath: null,
      pdfPath: null,
      imagePath: null,
      attachmentPath: null,
      attachmentType: null,
      filePaths: null,
      ocrText: null,
      indexText: 'hello',
      primaryTextSource: 'clipboard',
      ocrStatus: 'not_needed',
      metadata: null,
      note: null,
      createdAt: 1,
      updatedAt: 2,
      appName: null,
      isPinned: false,
      isFavorite: false,
      accessCount: 0,
      contentHash: null,
      hasEmbedding: true,
    })

    expect(useClipboardStore.getState().clips[0]).toMatchObject({
      id: 'clip-1',
      hasEmbedding: true,
      note: 'keep me',
      tags: [{ id: 1, name: 'saved', color: '#fff', createdAt: 1 }],
    })
  })
})

const makeClip = (overrides: Partial<ClipItem> = {}): ClipItem => ({
  id: 'clip-1',
  contentType: 'text',
  detectedType: 'text',
  contentText: 'hello',
  contentHtml: null,
  contentRtf: null,
  svgPath: null,
  pdfPath: null,
  imagePath: null,
  attachmentPath: null,
  attachmentType: null,
  filePaths: null,
  ocrText: null,
  indexText: 'hello',
  primaryTextSource: 'clipboard',
  ocrStatus: 'not_needed',
  metadata: null,
  note: null,
  createdAt: 1,
  updatedAt: 1,
  appName: null,
  isPinned: false,
  isFavorite: false,
  accessCount: 0,
  contentHash: null,
  hasEmbedding: false,
  tags: [],
  ...overrides,
})

const workTag: Tag = {
  id: 7,
  name: 'work',
  color: '#fff',
  createdAt: 1,
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

    expect(mockInvoke).toHaveBeenCalledWith('search_clips_paginated', {
      query: 'hello',
      filterTypes: [],
      limit: 50,
      offset: 0,
      favoritesOnly: true,
      pinnedOnly: false,
      tagFilter: null,
      useSemanticSearch: true,
      similarityThreshold: 0.3,
    })
  })
})

describe('useClipboardStore OCR clip-updated handling', () => {
  const makeImageClip = (overrides: Partial<ClipItem> = {}): ClipItem => ({
    id: 'img-1',
    contentType: 'image',
    detectedType: 'image',
    contentText: '[Image: img-1.png]',
    contentHtml: null,
    contentRtf: null,
    svgPath: null,
    pdfPath: null,
    imagePath: '/data/images/img-1.png',
    attachmentPath: null,
    attachmentType: null,
    filePaths: null,
    ocrText: null,
    indexText: '',
    primaryTextSource: 'none',
    ocrStatus: 'pending',
    metadata: null,
    note: null,
    createdAt: 1000,
    updatedAt: 1000,
    appName: null,
    isPinned: false,
    isFavorite: false,
    accessCount: 0,
    contentHash: 'abc',
    hasEmbedding: false,
    tags: [],
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useClipboardStore.setState({
      clips: [makeImageClip()],
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

  it('merges OCR completion update: ocrStatus done and new text', () => {
    useClipboardStore.getState().mergeClipUpdate(
      makeImageClip({
        ocrStatus: 'done',
        ocrText: 'extracted text',
        indexText: 'extracted text',
        primaryTextSource: 'ocr',
        contentText: 'extracted text',
        updatedAt: 2000,
      })
    )

    const clip = useClipboardStore.getState().clips[0]!
    expect(clip.ocrStatus).toBe('done')
    expect(clip.primaryTextSource).toBe('ocr')
    expect(clip.indexText).toBe('extracted text')
  })

  it('merges OCR running status without changing text', () => {
    useClipboardStore
      .getState()
      .mergeClipUpdate(makeImageClip({ ocrStatus: 'running', updatedAt: 1500 }))

    const clip = useClipboardStore.getState().clips[0]!
    expect(clip.ocrStatus).toBe('running')
    expect(clip.indexText).toBe('')
    expect(clip.primaryTextSource).toBe('none')
  })

  it('merges OCR failed status', () => {
    useClipboardStore
      .getState()
      .mergeClipUpdate(makeImageClip({ ocrStatus: 'failed', updatedAt: 1500 }))

    const clip = useClipboardStore.getState().clips[0]!
    expect(clip.ocrStatus).toBe('failed')
  })

  it('preserves local tags when OCR update arrives without tags', () => {
    const tag = { id: 3, name: 'screenshot', color: null, createdAt: 1 }
    useClipboardStore.setState({
      clips: [makeImageClip({ tags: [tag] })],
    })

    // Simulate a backend clip-updated payload that omits the tags field
    // (backend does not populate tags on clip-updated events).
    const { tags: _omitted, ...clipWithoutTags } = makeImageClip({
      ocrStatus: 'done',
      ocrText: 'hi',
      indexText: 'hi',
    })
    useClipboardStore.getState().mergeClipUpdate(clipWithoutTags as ClipItem)

    expect(useClipboardStore.getState().clips[0]!.tags).toEqual([tag])
  })

  it('ignores clip-updated events for clips not in the current list', () => {
    useClipboardStore
      .getState()
      .mergeClipUpdate(makeImageClip({ id: 'unknown-clip', ocrStatus: 'done' }))

    expect(useClipboardStore.getState().clips).toHaveLength(1)
    expect(useClipboardStore.getState().clips[0]!.id).toBe('img-1')
  })
})
