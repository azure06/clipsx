import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipboardHistory } from './ClipboardHistory'
import { useClipboardStore, useSettingsStore } from '../../stores'
import type { ClipSummary } from '../../shared/types/v2'
import { DEFAULT_SETTINGS } from '../../shared/types/settings'

const { toastMock, performPrimaryActionMock, performCopyMock, loadMoreClipsMock, listenMock } =
  vi.hoisted(() => ({
    toastMock: vi.fn(),
    performPrimaryActionMock: vi.fn(),
    performCopyMock: vi.fn(),
    loadMoreClipsMock: vi.fn(),
    listenMock: vi.fn(() => Promise.resolve(vi.fn())),
  }))

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

vi.mock('../../shared/contexts/ToastContext', () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}))

const makeClip = (): ClipSummary => ({
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

describe('ClipboardHistory activation modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadMoreClipsMock.mockResolvedValue(undefined)
    performPrimaryActionMock.mockResolvedValue(undefined)
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
      pinnedPreview: [],
      pinnedPreviewLoading: false,
      pinnedPreviewError: null,
      refreshPinnedPreview: vi.fn().mockResolvedValue(undefined),
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
      deleteClip: vi.fn(),
      toggleFavorite: vi.fn(),
      togglePin: vi.fn(),
      clearAllClips: vi.fn(),
      copyDerivedText: vi.fn(),
      performPrimaryAction: performPrimaryActionMock,
      performCopy: performCopyMock,
      resetPagination: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('activates on first click when activation mode is single_click_copy', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        item_activation_mode: 'single_click_copy',
        show_copy_toast: false,
      },
      isLoading: false,
      error: null,
      loadSettings: vi.fn(),
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
      getSettingsPath: vi.fn(),
    })

    render(<ClipboardHistory />)

    fireEvent.click(screen.getByText('hello world'))

    await waitFor(() => {
      expect(performPrimaryActionMock).toHaveBeenCalledWith('hello world', 'clip-1')
      expect(performCopyMock).not.toHaveBeenCalled()
    })
  })

  it('defaults to select-then-double-click activation while settings load', async () => {
    useSettingsStore.setState({
      settings: null,
      isLoading: true,
      error: null,
      loadSettings: vi.fn(),
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
      getSettingsPath: vi.fn(),
    })

    render(<ClipboardHistory />)

    const item = screen.getByText('hello world')
    fireEvent.click(item)

    expect(performCopyMock).not.toHaveBeenCalled()
    expect(performPrimaryActionMock).not.toHaveBeenCalled()

    fireEvent.doubleClick(item)

    await waitFor(() => {
      expect(performPrimaryActionMock).toHaveBeenCalledWith('hello world', 'clip-1')
      expect(performCopyMock).not.toHaveBeenCalled()
    })
  })
  const pinnedClips = () =>
    Array.from({ length: 4 }, (_, index) => ({
      ...makeClip(),
      id: `pin-${index}`,
      isPinned: true,
      historyPreview: {
        ...makeClip().historyPreview,
        title: `Pinned ${index}`,
        accessibilityLabel: `Pinned ${index}`,
      },
    }))

  it('shows three older pins once above recent history and supports collapse and view all', async () => {
    const pins = pinnedClips()
    const setTab = vi.fn()
    useClipboardStore.setState({
      pinnedPreview: pins,
      clips: [makeClip(), pins[0]!],
      setActiveTab: setTab,
    })
    const { container } = render(<ClipboardHistory />)
    await screen.findByText('Recent clips')
    expect(screen.getAllByText('Pinned 0')).toHaveLength(1)
    expect(screen.getByText('Pinned 2')).toBeInTheDocument()
    expect(screen.queryByText('Pinned 3')).not.toBeInTheDocument()
    expect(
      [...container.querySelectorAll('[data-clip-index]')].map(el =>
        el.getAttribute('data-clip-index')
      )
    ).toEqual(['0', '1', '2', '3'])
    const collapse = screen.getByRole('button', { name: 'Collapse pinned clips' })
    collapse.focus()
    // Native keyboard activation must remain available on section controls.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    collapse.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(performPrimaryActionMock).not.toHaveBeenCalled()
    fireEvent.click(collapse)
    expect(screen.queryByText('Pinned 0')).not.toBeInTheDocument()
    expect(screen.getByText('hello world')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View all' }))
    expect(setTab).toHaveBeenCalledWith('pinned')
    fireEvent.click(screen.getByRole('button', { name: 'Expand pinned clips' }))
    expect(screen.getByText('Pinned 0')).toBeInTheDocument()
  })

  it.each([
    { mode: 'search' as const, tagFilter: null, activeTab: 'all' as const },
    { mode: 'browse' as const, tagFilter: 'work', activeTab: 'all' as const },
    { mode: 'browse' as const, tagFilter: null, activeTab: 'pinned' as const },
    { mode: 'browse' as const, tagFilter: null, activeTab: 'favorites' as const },
  ])('keeps filtered results in their original order without a pinned section: %j', async scope => {
    const pins = pinnedClips()
    useClipboardStore.setState({ ...scope, clips: [makeClip(), pins[1]!], pinnedPreview: pins })
    render(<ClipboardHistory />)
    await screen.findByText('hello world')
    expect(screen.queryByRole('button', { name: 'Collapse pinned clips' })).not.toBeInTheDocument()
    if (scope.activeTab !== 'pinned')
      expect(screen.queryByRole('button', { name: /^Move .* (up|down)$/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Pinned 0')).not.toBeInTheDocument()
    expect(screen.getByText('Pinned 1')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(performPrimaryActionMock).toHaveBeenCalledWith('hello world', 'clip-1')
  })

  it('quick-copy and arrow navigation follow the visible pinned then recent order', async () => {
    const pins = pinnedClips()
    useClipboardStore.setState({ pinnedPreview: pins, clips: [makeClip()] })
    render(<ClipboardHistory />)
    await screen.findByText('Pinned 0')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(performPrimaryActionMock).toHaveBeenLastCalledWith('Pinned 0', 'pin-0')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(performPrimaryActionMock).toHaveBeenLastCalledWith('Pinned 1', 'pin-1')
    fireEvent.keyDown(window, { key: '4', ctrlKey: true })
    expect(performPrimaryActionMock).toHaveBeenLastCalledWith('hello world', 'clip-1')
  })
  it('offers ordering only in the unfiltered Pinned collection', async () => {
    const pins = pinnedClips(),
      move = vi.fn().mockResolvedValue(undefined)
    useClipboardStore.setState({
      activeTab: 'pinned',
      clips: pins,
      pinnedPreview: pins,
      movePinnedClip: move,
      pinOrderSaving: false,
    })
    render(<ClipboardHistory />)
    const down = await screen.findByRole('button', { name: 'Move Pinned 0 down' })
    fireEvent.click(down)
    expect(move).toHaveBeenCalledWith('pin-0', 'down')
    expect(performPrimaryActionMock).not.toHaveBeenCalled()
  })
})
