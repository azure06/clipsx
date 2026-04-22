import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { useClipboardStore, useSettingsStore, useUIStore } from '../../stores'

const { listenMock, invokeMock, focusChangeHandlers, eventHandlers } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeMock: vi.fn(),
  focusChangeHandlers: [] as Array<(event: { payload: boolean }) => void>,
  eventHandlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn(async handler => {
      focusChangeHandlers.push(handler)
      return vi.fn()
    }),
  }),
}))

vi.mock('../../shared/hooks/useTheme', () => ({
  useTheme: () => ({
    setThemeMode: vi.fn(),
  }),
}))

vi.mock('../../shared/components/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar" />,
}))

vi.mock('../../shared/components/BottomBar', () => ({
  BottomBar: () => <div data-testid="bottombar" />,
}))

vi.mock('../../shared/components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}))

vi.mock('../clipboard/ClipboardHistory', () => ({
  ClipboardHistory: () => <div data-testid="clipboard-history" />,
}))

vi.mock('../clipboard/ClipPreview', () => ({
  ClipPreview: () => <div data-testid="clip-preview" />,
}))

vi.mock('../settings/Settings', () => ({
  Settings: () => <div data-testid="settings-view" />,
}))

vi.mock('../settings/Plugins', () => ({
  Plugins: () => <div data-testid="plugins-view" />,
}))

describe('AppLayout search focus ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    focusChangeHandlers.length = 0
    eventHandlers.clear()
    listenMock.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        const handlers = eventHandlers.get(eventName) ?? []
        handlers.push(handler)
        eventHandlers.set(eventName, handlers)
        return vi.fn()
      }
    )
    invokeMock.mockResolvedValue({
      state: 'disabled',
      enabled: false,
      configuredModel: '',
      loadedModel: null,
      message: '',
      progress: null,
    })

    useUIStore.setState({
      activeView: 'clips',
      searchQuery: '',
      previewClipId: null,
      isSemanticActive: true,
    })

    useSettingsStore.setState({
      settings: null,
      isLoading: false,
      error: null,
      loadSettings: vi.fn().mockResolvedValue(undefined),
      updateSettings: vi.fn(),
      getSettingsPath: vi.fn(),
    })

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
      loadMoreClips: vi.fn(),
      addNewClip: vi.fn(),
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
      deleteClip: vi.fn(),
      toggleFavorite: vi.fn(),
      togglePin: vi.fn(),
      clearAllClips: vi.fn(),
      copyToClipboard: vi.fn(),
      pasteClip: vi.fn(),
      copyDerivedText: vi.fn(),
      performPrimaryAction: vi.fn(),
      performCopy: vi.fn(),
      resetPagination: vi.fn(),
      generateEmbedding: vi.fn(),
    })
  })

  it('focuses search input on initial clips render', async () => {
    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type to search or paste...')).toHaveFocus()
    })
  })

  it('refocuses search input when window regains focus in clips view', async () => {
    render(<AppLayout />)
    const input = screen.getByPlaceholderText('Type to search or paste...')

    await waitFor(() => expect(input).toHaveFocus())

    input.blur()
    expect(input).not.toHaveFocus()

    focusChangeHandlers.forEach(handler => handler({ payload: true }))

    await waitFor(() => expect(input).toHaveFocus())
  })

  it('does not steal focus from active text editors', async () => {
    render(<AppLayout />)
    const input = screen.getByPlaceholderText('Type to search or paste...')

    await waitFor(() => expect(input).toHaveFocus())

    const noteField = document.createElement('textarea')
    document.body.appendChild(noteField)
    noteField.focus()
    expect(noteField).toHaveFocus()

    focusChangeHandlers.forEach(handler => handler({ payload: true }))

    await waitFor(() => expect(noteField).toHaveFocus())
    expect(input).not.toHaveFocus()

    noteField.remove()
  })

  it('merges clip-updated events into clipboard store state', async () => {
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

    render(<AppLayout />)

    await waitFor(() => {
      expect(eventHandlers.get('clip-updated')).toHaveLength(1)
    })

    const clipUpdatedHandlers = eventHandlers.get('clip-updated')

    await act(async () => {
      clipUpdatedHandlers?.[0]?.({
        payload: {
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
        },
      })
    })

    await waitFor(() => {
      expect(useClipboardStore.getState().clips[0]).toMatchObject({
        id: 'clip-1',
        hasEmbedding: true,
        note: 'keep me',
        tags: [{ id: 1, name: 'saved', color: '#fff', createdAt: 1 }],
      })
    })
  })
})
