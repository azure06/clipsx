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
      availableTags: [],
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
})
