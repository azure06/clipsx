import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextEmbeddingStatus } from '../../shared/types/v2'
import { IntelligencePage } from './IntelligencePage'

const { eventHandlers, invokeMock, listenMock, toastMock } = vi.hoisted(() => ({
  eventHandlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('../../shared/contexts/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}))

const readyStatus = (overrides: Partial<TextEmbeddingStatus> = {}): TextEmbeddingStatus => ({
  enabled: true,
  phase: 'ready',
  activeSpaceId: 'space-1',
  pendingSpaceId: null,
  diagnostic: null,
  indexedClips: 5,
  pendingJobs: 0,
  failedJobs: 0,
  totalClips: 5,
  endpoint: 'http://localhost:11434',
  model: 'nomic-embed-text',
  ...overrides,
})

const toastTitles = (): string[] =>
  (toastMock.mock.calls as Array<[{ title: string }]>).map(([value]) => value.title)

describe('IntelligencePage indexing actions', () => {
  let currentStatus: TextEmbeddingStatus
  let failNextStatusRefresh: boolean

  beforeEach(() => {
    vi.clearAllMocks()
    eventHandlers.clear()
    currentStatus = readyStatus()
    failNextStatusRefresh = false
    listenMock.mockImplementation(
      (eventName: string, handler: (event: { payload: unknown }) => void) => {
        const handlers = eventHandlers.get(eventName) ?? []
        handlers.push(handler)
        eventHandlers.set(eventName, handlers)
        return Promise.resolve(vi.fn())
      }
    )
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_text_embedding_status') {
        if (failNextStatusRefresh) {
          failNextStatusRefresh = false
          return Promise.reject(new Error('status unavailable'))
        }
        return Promise.resolve(currentStatus)
      }
      if (command === 'list_search_sources') return Promise.resolve([])
      if (command === 'get_search_settings') {
        return Promise.resolve({ syntaxMode: 'simple', enabledSourceIds: [] })
      }
      return Promise.resolve(null)
    })
  })

  it('does not settle against stale status before the command succeeds', async () => {
    let resolveReindex: (() => void) | undefined
    const reindex = new Promise<void>(resolve => {
      resolveReindex = resolve
    })
    invokeMock.mockImplementation((command: string) => {
      if (command === 'reindex_text_embeddings') return reindex
      if (command === 'get_text_embedding_status') return Promise.resolve(currentStatus)
      if (command === 'list_search_sources') return Promise.resolve([])
      if (command === 'get_search_settings') {
        return Promise.resolve({ syntaxMode: 'simple', enabledSourceIds: [] })
      }
      return Promise.resolve(null)
    })

    render(<IntelligencePage />)
    const button = await screen.findByRole('button', { name: 'Reindex all' })
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    expect(toastTitles()).not.toContain('Reindex complete')

    currentStatus = readyStatus({ phase: 'indexing', pendingJobs: 5, indexedClips: 0 })
    act(() => resolveReindex?.())
    await waitFor(() => expect(button).toBeDisabled())
    expect(toastTitles()).not.toContain('Reindex complete')

    currentStatus = readyStatus()
    act(() => {
      for (const handler of eventHandlers.get('search-index-progress') ?? []) {
        handler({ payload: 'builtin.search.semantic_text' })
      }
    })

    await waitFor(() => expect(toastTitles()).toContain('Reindex complete'))
    expect(button).toBeEnabled()
  })

  it('settles a no-work Index Missing action from its fresh terminal status', async () => {
    render(<IntelligencePage />)
    const button = await screen.findByRole('button', { name: 'Index missing' })
    fireEvent.click(button)

    await waitFor(() => expect(toastTitles()).toContain('Index missing complete'))
    expect(button).toBeEnabled()
  })

  it('clears loading and reports command and status-refresh failures', async () => {
    render(<IntelligencePage />)
    const reindexButton = await screen.findByRole('button', { name: 'Reindex all' })
    invokeMock.mockRejectedValueOnce(new Error('command rejected'))
    fireEvent.click(reindexButton)

    await waitFor(() => expect(toastTitles()).toContain('Reindex failed'))
    expect(reindexButton).toBeEnabled()

    const missingButton = screen.getByRole('button', { name: 'Index missing' })
    failNextStatusRefresh = true
    fireEvent.click(missingButton)

    await waitFor(() => expect(toastTitles()).toContain('Could not refresh Intelligence status'))
    expect(missingButton).toBeEnabled()
    expect(toastTitles()).not.toContain('Index missing complete')
  })

  it('confirms a successful disconnect', async () => {
    render(<IntelligencePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Configuration/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(toastTitles()).toContain('Meaning Search disconnected'))
  })

  it('deduplicates repeated failures until status recovers', async () => {
    currentStatus = readyStatus({
      phase: 'degraded',
      diagnostic: 'provider unavailable',
      failedJobs: 1,
    })
    render(<IntelligencePage />)
    await screen.findByText(/provider unavailable/)

    act(() => {
      for (const handler of eventHandlers.get('embedding-index-failed') ?? []) {
        handler({ payload: 'provider unavailable' })
        handler({ payload: 'provider unavailable' })
      }
    })
    expect(toastTitles().filter(title => title === 'Meaning Search needs attention')).toHaveLength(
      1
    )

    currentStatus = readyStatus()
    act(() => {
      for (const handler of eventHandlers.get('search-index-progress') ?? []) {
        handler({ payload: 'builtin.search.semantic_text' })
      }
    })
    await screen.findByText('ready')

    currentStatus = readyStatus({ phase: 'degraded', diagnostic: 'provider unavailable' })
    act(() => {
      for (const handler of eventHandlers.get('embedding-index-failed') ?? []) {
        handler({ payload: 'provider unavailable' })
      }
    })

    await waitFor(() =>
      expect(
        toastTitles().filter(title => title === 'Meaning Search needs attention')
      ).toHaveLength(2)
    )
  })
})
