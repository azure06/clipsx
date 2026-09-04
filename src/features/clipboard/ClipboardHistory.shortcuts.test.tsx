import { act, render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipboardHistory } from './ClipboardHistory'
import { useClipboardStore, useSettingsStore } from '../../stores'
import type { ClipSummary } from '../../shared/types/v2'
import { formatShortcut } from '../../shared/keyboard/shortcuts'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'

const {
  invokeMock,
  toastMock,
  deleteClipMock,
  toggleFavoriteMock,
  togglePinMock,
  loadMoreClipsMock,
  performCopyMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastMock: vi.fn(),
  deleteClipMock: vi.fn(),
  toggleFavoriteMock: vi.fn(),
  togglePinMock: vi.fn(),
  loadMoreClipsMock: vi.fn(),
  performCopyMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))
vi.mock('../../shared/contexts/ToastContext', () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}))

vi.mock('./views', () => ({
  ClipboardListView: () => <div data-testid="clipboard-list-view" />,
}))

vi.mock('./components', () => ({
  TagFilter: () => null,
  ClipboardListItem: () => null,
}))

const makeClip = (id = 'clip-1'): ClipSummary => ({
  id,
  sourceAppName: null,
  sourceAppId: null,
  capturedAt: 1,
  note: null,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  tags: [],
  historyPreview: {
    leading: { kind: 'host_icon', name: 'text' },
    title: 'hello world',
    subtitle: null,
    badge: null,
    accessibilityLabel: 'hello world',
  },
  representationCount: 1,
  primaryPresentationKind: 'text',
  thumbnailAssetId: null,
  hasPlainText: true,
  shareable: true,
})

const setNavigatorPlatform = (platform: string) => {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })
}

describe('ClipboardHistory keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadMoreClipsMock.mockResolvedValue(undefined)
    deleteClipMock.mockResolvedValue(undefined)
    toggleFavoriteMock.mockResolvedValue(undefined)
    togglePinMock.mockResolvedValue(undefined)
    performCopyMock.mockResolvedValue(undefined)

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )

    useClipboardStore.setState({
      clips: [makeClip()],
      loading: false,
      error: null,
      hasMore: false,
      currentOffset: 1,
      mode: 'browse',
      searchQuery: '',
      activeTab: 'all',
      tagFilter: null,
      loadMoreClips: loadMoreClipsMock,
      addNewClip: vi.fn(),
      mergeClipUpdate: vi.fn(),
      enterSearchMode: vi.fn(),
      exitSearchMode: vi.fn(),
      setActiveTab: vi.fn(),
      setTagFilter: vi.fn(),
      refreshAvailableTags: vi.fn(),
      updateClipNote: vi.fn(),
      addClipTag: vi.fn(),
      removeClipTag: vi.fn(),
      createTagAndAttach: vi.fn(),
      deleteAvailableTag: vi.fn(),
      deleteClip: deleteClipMock,
      toggleFavorite: toggleFavoriteMock,
      togglePin: togglePinMock,
      clearAllClips: vi.fn(),
      copyDerivedText: vi.fn(),
      performPrimaryAction: vi.fn(),
      performCopy: performCopyMock,
      resetPagination: vi.fn(),
      availableTags: [],
    })

    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        paste_on_enter: true,
        show_copy_toast: false,
      },
      isLoading: false,
      error: null,
      loadSettings: vi.fn(),
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
      getSettingsPath: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('runs open in editor shortcut while search input is focused', async () => {
    setNavigatorPlatform('MacIntel')
    render(<ClipboardHistory />)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'O',
          metaKey: true,
          shiftKey: true,
        })
      )
    })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'open_clip_text_in_editor',
        expect.objectContaining({ clipId: 'clip-1', extension: 'txt' })
      )
    })

    input.remove()
  })

  it('runs favorite and pin shortcuts while search input is focused', async () => {
    setNavigatorPlatform('MacIntel')
    render(<ClipboardHistory />)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'F',
          metaKey: true,
        })
      )
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'P',
          metaKey: true,
        })
      )
    })

    await waitFor(() => {
      expect(toggleFavoriteMock).toHaveBeenCalledWith('clip-1')
      expect(togglePinMock).toHaveBeenCalledWith('clip-1')
    })

    input.remove()
  })

  it('deletes selected clip with Cmd+Backspace while search input is focused on macOS', async () => {
    setNavigatorPlatform('MacIntel')
    render(<ClipboardHistory />)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Backspace',
          metaKey: true,
        })
      )
    })

    await waitFor(() => {
      expect(deleteClipMock).toHaveBeenCalledWith('clip-1')
    })

    input.remove()
  })

  it('keeps native copy when text is selected outside inputs', async () => {
    setNavigatorPlatform('MacIntel')
    render(<ClipboardHistory />)

    const previewText = document.createElement('p')
    previewText.textContent = 'hello world from preview'
    document.body.appendChild(previewText)

    const range = document.createRange()
    range.selectNodeContents(previewText)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'C',
          metaKey: true,
        })
      )
    })

    await waitFor(() => {
      expect(performCopyMock).not.toHaveBeenCalled()
    })

    selection?.removeAllRanges()
    previewText.remove()
  })

  it('keeps bare Delete native in search input on Windows', async () => {
    setNavigatorPlatform('Win32')
    render(<ClipboardHistory />)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Delete',
        })
      )
    })

    await waitFor(() => {
      expect(deleteClipMock).not.toHaveBeenCalled()
    })

    input.remove()
  })

  it('selects the newest loaded clip with Home', async () => {
    const onPreviewItem = vi.fn()
    useClipboardStore.setState({
      clips: [makeClip('newest'), makeClip('older')],
      hasMore: false,
      currentOffset: 2,
    })
    render(<ClipboardHistory onPreviewItem={onPreviewItem} />)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }))
    })

    await waitFor(() => expect(onPreviewItem).toHaveBeenLastCalledWith('newest'))
    input.remove()
  })

  it('loads at most one older window and selects its boundary with End', async () => {
    const onPreviewItem = vi.fn()
    useClipboardStore.setState({
      clips: [makeClip('newest')],
      hasMore: false,
      currentOffset: 1,
    })
    render(<ClipboardHistory onPreviewItem={onPreviewItem} />)

    await waitFor(() => expect(loadMoreClipsMock).toHaveBeenCalledTimes(1))
    loadMoreClipsMock.mockClear()
    loadMoreClipsMock.mockImplementation(() => {
      useClipboardStore.setState({
        clips: [makeClip('newest'), makeClip('oldest')],
        hasMore: true,
        currentOffset: 2,
      })
    })
    act(() => {
      useClipboardStore.setState({
        clips: [makeClip('newest')],
        hasMore: true,
        currentOffset: 1,
      })
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(loadMoreClipsMock).toHaveBeenCalledTimes(1)
      expect(onPreviewItem).toHaveBeenLastCalledWith('oldest')
    })
  })

  it('formats pin shortcut for action surfaces', () => {
    setNavigatorPlatform('MacIntel')
    expect(formatShortcut({ modifiers: ['primary'], key: 'P' }, 'macos')).toBe('⌘P')
  })
})
