import { act, render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipboardHistory } from './ClipboardHistory'
import { ClipActions } from './ClipActions'
import { useClipboardStore, useSettingsStore } from '../../stores'
import type { ClipItem } from '../../shared/types'
import { formatShortcut } from '../../shared/keyboard/shortcuts'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'
import { usePinAction } from '../content/actions/shared/PinAction'

const {
  invokeMock,
  toastMock,
  deleteClipMock,
  toggleFavoriteMock,
  togglePinMock,
  loadMoreClipsMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastMock: vi.fn(),
  deleteClipMock: vi.fn(),
  toggleFavoriteMock: vi.fn(),
  togglePinMock: vi.fn(),
  loadMoreClipsMock: vi.fn(),
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

const makeClip = (): ClipItem => ({
  id: 'clip-1',
  contentType: 'text',
  detectedType: 'text',
  contentText: 'hello world',
  contentHtml: null,
  contentRtf: null,
  svgPath: null,
  pdfPath: null,
  imagePath: null,
  attachmentPath: null,
  attachmentType: null,
  filePaths: null,
  ocrText: null,
  indexText: 'hello world',
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
      searchClips: vi.fn(),
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
      performCopy: vi.fn(),
      resetPagination: vi.fn(),
      generateEmbedding: vi.fn(),
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
        'open_text_in_editor',
        expect.objectContaining({ text: 'hello world', extension: 'txt' })
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

  it('formats pin shortcut for action surfaces', () => {
    setNavigatorPlatform('MacIntel')
    const action = usePinAction()

    expect(formatShortcut(action.shortcut, 'macos')).toBe('⌘P')
  })

  it('renders pin shortcut in action cards', () => {
    setNavigatorPlatform('MacIntel')
    render(
      <ClipActions
        content={{
          type: 'text',
          text: 'hello world',
          metadata: {},
          clip: makeClip(),
        }}
      />
    )

    expect(document.body.textContent).toContain('⌘P')
  })
})
