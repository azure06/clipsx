import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { useAuthStore, useClipboardStore, useSettingsStore, useUIStore } from '../../stores'

const {
  listenMock,
  invokeMock,
  getCurrentMock,
  onOpenUrlMock,
  focusChangeHandlers,
  eventHandlers,
  testRefs,
} = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeMock: vi.fn(),
  getCurrentMock: vi.fn(),
  onOpenUrlMock: vi.fn(),
  focusChangeHandlers: [] as Array<(event: { payload: boolean }) => void>,
  eventHandlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
  testRefs: {
    sidebarProps: null as {
      onAccountClick: () => void
      onSettingsClick: () => void
    } | null,
    settingsProps: null as { initialTab?: string } | null,
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn((handler: (event: { payload: boolean }) => void) => {
      focusChangeHandlers.push(handler)
      return Promise.resolve(vi.fn())
    }),
  }),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: getCurrentMock,
  onOpenUrl: onOpenUrlMock,
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
  Sidebar: (props: { onAccountClick: () => void; onSettingsClick: () => void }) => {
    testRefs.sidebarProps = props
    return <div data-testid="sidebar" />
  },
}))

vi.mock('../clipboard/ClipboardHistory', () => ({
  ClipboardHistory: () => <div data-testid="clipboard-history" />,
}))

vi.mock('../clipboard/ClipPreview', () => ({
  ClipPreview: () => <div data-testid="clip-preview" />,
}))

vi.mock('../settings/Settings', () => ({
  Settings: (props: { initialTab?: string }) => {
    testRefs.settingsProps = props
    return <div data-testid="settings-view" />
  },
}))

vi.mock('../settings/Plugins', () => ({
  Plugins: () => <div data-testid="plugins-view" />,
}))

vi.mock('./UpdateBanner', () => ({
  UpdateBanner: () => null,
}))

describe('AppLayout search focus ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    focusChangeHandlers.length = 0
    eventHandlers.clear()
    testRefs.sidebarProps = null
    testRefs.settingsProps = null
    listenMock.mockImplementation(
      (eventName: string, handler: (event: { payload: unknown }) => void) => {
        const handlers = eventHandlers.get(eventName) ?? []
        handlers.push(handler)
        eventHandlers.set(eventName, handlers)
        return Promise.resolve(vi.fn())
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
    getCurrentMock.mockResolvedValue(null)
    onOpenUrlMock.mockResolvedValue(vi.fn())

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

    useAuthStore.setState({
      status: 'unconfigured',
      email: null,
      error: null,
      initialize: vi.fn().mockResolvedValue(undefined),
      completeCallback: vi.fn().mockResolvedValue(false),
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
      performPrimaryAction: vi.fn(),
      performCopy: vi.fn(),
      resetPagination: vi.fn(),
    })
  })

  it('processes a callback that launched ClipsX and brings the main window forward', async () => {
    const completeCallback = vi.fn().mockResolvedValue(true)
    getCurrentMock.mockResolvedValue(['clipsx://auth/callback?code=one-time-code'])
    useAuthStore.setState({ completeCallback })

    render(<AppLayout />)

    await waitFor(() => {
      expect(completeCallback).toHaveBeenCalledWith('clipsx://auth/callback?code=one-time-code')
      expect(invokeMock).toHaveBeenCalledWith('show_main_window_command')
    })
  })

  it('processes a callback delivered while ClipsX is already open', async () => {
    const completeCallback = vi.fn().mockResolvedValue(true)
    let openUrlHandler: ((urls: string[]) => void) | undefined
    onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
      openUrlHandler = handler
      return Promise.resolve(vi.fn())
    })
    useAuthStore.setState({ completeCallback })

    render(<AppLayout />)

    await waitFor(() => expect(openUrlHandler).toBeDefined())
    openUrlHandler?.(['clipsx://auth/callback?code=fresh-code'])

    await waitFor(() => {
      expect(completeCallback).toHaveBeenCalledWith('clipsx://auth/callback?code=fresh-code')
      expect(invokeMock).toHaveBeenCalledWith('show_main_window_command')
    })
  })

  it('processes a reused callback only once', async () => {
    const completeCallback = vi.fn().mockResolvedValue(true)
    let openUrlHandler: ((urls: string[]) => void) | undefined
    onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
      openUrlHandler = handler
      return Promise.resolve(vi.fn())
    })
    useAuthStore.setState({ completeCallback })

    render(<AppLayout />)

    await waitFor(() => expect(openUrlHandler).toBeDefined())
    openUrlHandler?.(['clipsx://auth/callback?code=one-time-code'])
    openUrlHandler?.(['clipsx://auth/callback?code=one-time-code'])

    await waitFor(() => expect(completeCallback).toHaveBeenCalledTimes(1))
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'show_main_window_command')
    ).toHaveLength(1)
  })

  it('opens the Account settings tab from the sidebar account indicator', async () => {
    render(<AppLayout />)

    await waitFor(() => expect(testRefs.sidebarProps).not.toBeNull())

    act(() => {
      testRefs.sidebarProps?.onAccountClick()
    })

    await waitFor(() => expect(testRefs.settingsProps?.initialTab).toBe('account'))
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

    render(<AppLayout />)

    await waitFor(() => {
      expect(eventHandlers.get('clip-updated')).toHaveLength(1)
    })

    const clipUpdatedHandlers = eventHandlers.get('clip-updated')

    act(() => {
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

  it('re-fetches text search status when text-search-status-changed fires after startup', async () => {
    invokeMock.mockResolvedValueOnce({
      state: 'loading',
      enabled: true,
      configuredModel: 'model',
      loadedModel: null,
      message: 'Loading…',
      progress: null,
    })

    render(<AppLayout />)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('get_text_search_status')
    })

    const callCountAfterMount = invokeMock.mock.calls.filter(
      c => c[0] === 'get_text_search_status'
    ).length

    invokeMock.mockResolvedValueOnce({
      state: 'ready',
      enabled: true,
      configuredModel: 'model',
      loadedModel: 'model',
      message: 'Ready',
      progress: null,
    })

    act(() => {
      eventHandlers.get('text-search-status-changed')?.[0]?.({ payload: null })
    })

    await waitFor(() => {
      const callCount = invokeMock.mock.calls.filter(c => c[0] === 'get_text_search_status').length
      expect(callCount).toBeGreaterThan(callCountAfterMount)
    })
  })
})
