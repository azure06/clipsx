import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { useAuthStore, useClipboardStore, useSettingsStore, useUIStore } from '../../stores'

const {
  listenMock,
  invokeMock,
  getCurrentMock,
  onOpenUrlMock,
  isFocusedMock,
  onFocusChangedMock,
  focusHandlers,
  eventHandlers,
  testRefs,
} = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeMock: vi.fn(),
  getCurrentMock: vi.fn(),
  onOpenUrlMock: vi.fn(),
  isFocusedMock: vi.fn(),
  onFocusChangedMock: vi.fn(),
  focusHandlers: [] as Array<(event: { payload: boolean }) => void>,
  eventHandlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
  testRefs: {
    sidebarProps: null as {
      onAccountClick: () => void
      onSettingsClick: () => void
    } | null,
    settingsProps: null as { initialTab?: string } | null,
    clipboardHistoryProps: null as { onPreviewItem?: (clipId: string | null) => void } | null,
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
    isFocused: isFocusedMock,
    onFocusChanged: onFocusChangedMock,
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
  ClipboardHistory: (props: { onPreviewItem?: (clipId: string | null) => void }) => {
    testRefs.clipboardHistoryProps = props
    return <div data-testid="clipboard-history" />
  },
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
    focusHandlers.length = 0
    eventHandlers.clear()
    testRefs.sidebarProps = null
    testRefs.settingsProps = null
    testRefs.clipboardHistoryProps = null
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
    isFocusedMock.mockResolvedValue(true)
    onFocusChangedMock.mockImplementation((handler: (event: { payload: boolean }) => void) => {
      focusHandlers.push(handler)
      return Promise.resolve(vi.fn())
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

    useAuthStore.setState({
      status: 'unconfigured',
      userId: null,
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

  it('keeps the preview-selection callback stable across renders', () => {
    const { rerender } = render(<AppLayout />)
    const first = testRefs.clipboardHistoryProps?.onPreviewItem

    rerender(<AppLayout />)

    expect(testRefs.clipboardHistoryProps?.onPreviewItem).toBe(first)
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

  it('processes a callback delivered from the local browser listener', async () => {
    const completeCallback = vi.fn().mockResolvedValue(true)
    useAuthStore.setState({ completeCallback })

    render(<AppLayout />)

    await waitFor(() => expect(eventHandlers.has('auth-callback-url')).toBe(true))

    act(() => {
      for (const handler of eventHandlers.get('auth-callback-url') ?? []) {
        handler({ payload: 'http://127.0.0.1:43123/auth/desktop/callback?code=fresh-code' })
      }
    })

    await waitFor(() => {
      expect(completeCallback).toHaveBeenCalledWith(
        'http://127.0.0.1:43123/auth/desktop/callback?code=fresh-code'
      )
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
      expect(screen.getByPlaceholderText('Search clips or ask a question…')).toHaveFocus()
    })
  })

  it('refocuses search input after an explicit host activation in clips view', async () => {
    render(<AppLayout />)
    const input = screen.getByPlaceholderText('Search clips or ask a question…')

    await waitFor(() => expect(input).toHaveFocus())

    input.blur()
    expect(input).not.toHaveFocus()

    eventHandlers.get('main-window-activated')?.[0]?.({ payload: null })

    await waitFor(() => expect(input).toHaveFocus())
  })

  it('does not steal focus on another page after explicit host activation', async () => {
    render(<AppLayout />)
    const input = screen.getByPlaceholderText('Search clips or ask a question…')

    await waitFor(() => expect(input).toHaveFocus())

    act(() => useUIStore.getState().setActiveView('settings'))
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeInTheDocument())
    const settingsField = document.createElement('textarea')
    document.body.appendChild(settingsField)
    settingsField.focus()

    eventHandlers.get('main-window-activated')?.[0]?.({ payload: null })

    await waitFor(() => expect(settingsField).toHaveFocus())
    expect(input).not.toHaveFocus()

    settingsField.remove()
  })

  it('does not install a duplicate clip invalidation controller in the layout', () => {
    render(<AppLayout />)

    expect(eventHandlers.get('clip-updated')).toBeUndefined()
    expect(eventHandlers.get('clip-captured')).toBeUndefined()
  })

  it('uses native focus changes for sync activation', async () => {
    useAuthStore.setState({ status: 'signed_in', userId: 'account-1' })

    render(<AppLayout />)

    await waitFor(() => {
      expect(isFocusedMock).toHaveBeenCalledTimes(1)
      expect(onFocusChangedMock).toHaveBeenCalledTimes(1)
    })
    act(() => {
      focusHandlers[0]?.({ payload: false })
      focusHandlers[0]?.({ payload: true })
    })
  })

  it('re-fetches embedding status when embedding-space-changed fires after startup', async () => {
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
      expect(invokeMock).toHaveBeenCalledWith('get_text_embedding_status')
    })

    const callCountAfterMount = invokeMock.mock.calls.filter(
      c => c[0] === 'get_text_embedding_status'
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
      eventHandlers.get('embedding-space-changed')?.[0]?.({ payload: null })
    })

    await waitFor(() => {
      const callCount = invokeMock.mock.calls.filter(
        c => c[0] === 'get_text_embedding_status'
      ).length
      expect(callCount).toBeGreaterThan(callCountAfterMount)
    })
  })
})
