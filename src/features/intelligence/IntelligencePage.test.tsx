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
  eligibleClips: 5,
  dimensions: 768,
  indexBytes: 2048,
  estimatedRebuildBytes: 4096,
  model: 'nomic-embed-text',
  minimumSimilarityPercent: null,
  ...overrides,
})

const toastTitles = (): string[] =>
  (toastMock.mock.calls as Array<[{ title: string }]>).map(([value]) => value.title)

describe('IntelligencePage indexing actions', () => {
  let currentStatus: TextEmbeddingStatus
  let failNextStatusRefresh: boolean
  const connection = {
    providerId: 'builtin.model_provider.ollama',
    displayName: 'Ollama',
    configured: true,
    endpoint: 'http://localhost:11434',
    state: 'ready',
    diagnostic: null,
    models: [
      {
        id: 'nomic-embed-text',
        digest: 'embed-digest',
        size: 274_000_000,
        capabilities: ['text_embedding'],
        inspectionDiagnostic: null,
      },
      {
        id: 'llama3.2',
        digest: 'generation-digest',
        size: 2_000_000_000,
        capabilities: ['text_generation'],
        inspectionDiagnostic: null,
      },
    ],
  } as const
  let currentOcrStatus: {
    settings: { enabled: boolean; language: string }
    provider: {
      providerId: string
      providerVersion: string
      available: boolean
      languages: Array<{ id: string; label: string }>
      recoveryCode: string | null
      recoveryMessage: string | null
    }
    selectedLanguage: string | null
    pendingJobs: number
    runningJobs: number
    failedJobs: number
  }

  beforeEach(() => {
    vi.clearAllMocks()
    eventHandlers.clear()
    currentStatus = readyStatus()
    currentOcrStatus = {
      settings: { enabled: true, language: 'auto' },
      provider: {
        providerId: 'builtin.ocr.native',
        providerVersion: 'Windows.Media.Ocr',
        available: true,
        languages: [
          { id: 'en-US', label: 'English (United States)' },
          { id: 'ja-JP', label: 'Japanese' },
        ],
        recoveryCode: null,
        recoveryMessage: null,
      },
      selectedLanguage: 'en-US',
      pendingJobs: 2,
      runningJobs: 1,
      failedJobs: 0,
    }
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
      if (command === 'list_failed_text_embedding_jobs') return Promise.resolve([])
      if (command === 'get_ocr_runtime_status') return Promise.resolve(currentOcrStatus)
      if (command === 'update_ocr_settings') return Promise.resolve(currentOcrStatus)
      if (command === 'get_model_provider_connection') return Promise.resolve(connection)
      if (command === 'get_text_generation_status') {
        return Promise.resolve({
          enabled: false,
          available: false,
          diagnostic: 'Text generation is not configured',
          providerId: null,
          model: null,
        })
      }
      if (command === 'get_search_settings') {
        return Promise.resolve({ syntaxMode: 'simple', enabledSourceIds: [] })
      }
      return Promise.resolve(null)
    })
  })

  it('shows native OCR diagnostics and persists enablement from the vision page', async () => {
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === 'get_text_embedding_status') return Promise.resolve(currentStatus)
      if (command === 'list_search_sources') return Promise.resolve([])
      if (command === 'list_failed_text_embedding_jobs') return Promise.resolve([])
      if (command === 'get_search_settings') {
        return Promise.resolve({ syntaxMode: 'simple', enabledSourceIds: [] })
      }
      if (command === 'get_ocr_runtime_status') return Promise.resolve(currentOcrStatus)
      if (command === 'update_ocr_settings') {
        const settings = (payload as { settings: { enabled: boolean; language: string } }).settings
        currentOcrStatus = { ...currentOcrStatus, settings }
        return Promise.resolve(currentOcrStatus)
      }
      return Promise.resolve(null)
    })

    render(<IntelligencePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'OCR & vision' }))

    expect(await screen.findByText('Windows.Media.Ocr')).toBeInTheDocument()
    expect(screen.getByText('en-US')).toBeInTheDocument()
    expect(screen.getByText('3 waiting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('update_ocr_settings', {
        settings: { enabled: false, language: 'auto' },
      })
    )
    expect(toastTitles()).toContain('Text recognition disabled')
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
      if (command === 'list_failed_text_embedding_jobs') return Promise.resolve([])
      if (command === 'get_search_settings') {
        return Promise.resolve({ syntaxMode: 'simple', enabledSourceIds: [] })
      }
      return Promise.resolve(null)
    })

    render(<IntelligencePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Indexing' }))
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Indexing' }))
    const button = await screen.findByRole('button', { name: 'Index missing' })
    fireEvent.click(button)

    await waitFor(() => expect(toastTitles()).toContain('Index missing complete'))
    expect(button).toBeEnabled()
  })

  it('clears loading and reports command and status-refresh failures', async () => {
    render(<IntelligencePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Indexing' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }))

    await waitFor(() => expect(toastTitles()).toContain('Meaning Search disabled'))
  })

  it('uses one connection and separates model assignment from indexing', async () => {
    render(<IntelligencePage />)

    expect(await screen.findByText('Ollama Connection')).toBeInTheDocument()
    expect(screen.getByText('1 embedding')).toBeInTheDocument()
    expect(screen.getByText('1 generative')).toBeInTheDocument()
    expect(screen.queryByLabelText('Generation endpoint')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reindex all' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Indexing' }))
    expect(await screen.findByRole('button', { name: 'Reindex all' })).toBeInTheDocument()
    expect(screen.queryByText('Ollama Connection')).not.toBeInTheDocument()
  })

  it('persists a device-local meaning threshold from Search settings', async () => {
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === 'get_text_embedding_status') return Promise.resolve(currentStatus)
      if (command === 'list_search_sources') return Promise.resolve([])
      if (command === 'list_failed_text_embedding_jobs') return Promise.resolve([])
      if (command === 'get_ocr_runtime_status') return Promise.resolve(currentOcrStatus)
      if (command === 'get_search_settings') {
        return Promise.resolve({ syntaxMode: 'simple', enabledSourceIds: [] })
      }
      if (command === 'update_text_embedding_threshold') {
        const minimumSimilarityPercent = (payload as { minimumSimilarityPercent: number | null })
          .minimumSimilarityPercent
        currentStatus = readyStatus({ minimumSimilarityPercent })
        return Promise.resolve(currentStatus)
      }
      return Promise.resolve(null)
    })

    render(<IntelligencePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Filter weak meaning matches' }))

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('update_text_embedding_threshold', {
        minimumSimilarityPercent: 70,
      })
    )
    expect(await screen.findByLabelText('Minimum meaning similarity percentage')).toHaveValue(70)
    expect(toastTitles()).toContain('Meaning threshold set to 70%')
  })

  it('deduplicates repeated failures until status recovers', async () => {
    currentStatus = readyStatus({
      phase: 'degraded',
      diagnostic: 'provider unavailable',
      failedJobs: 1,
    })
    render(<IntelligencePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Indexing' }))
    await screen.findByText(/Ollama was unavailable during the last attempt/)

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
