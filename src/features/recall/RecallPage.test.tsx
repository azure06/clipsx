import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { RecallPage } from './RecallPage'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('../clipboard/ClipPreview', () => ({ ClipPreview: () => null }))
vi.mock('./RecallChat', () => ({
  RecallChat: (props: import('./RecallChat').RecallChatProps) => (
    <div>
      <textarea
        aria-label="recallPage.message"
        defaultValue={props.initialDraft}
        onChange={event => props.onDraft?.(event.target.value)}
        onCompositionStart={props.onCompositionStart}
        onCompositionEnd={props.onCompositionEnd}
      />
      <div data-testid="attachments">{JSON.stringify(props.attachments)}</div>
      <div data-testid="chat-submission">{props.ask?.text ?? ''}</div>
      {props.contextOpen && (
        <div data-testid="context">
          {props.preview ?? props.suggestions}
          <button onClick={props.onContextClose}>recallContext.close</button>
        </div>
      )}
    </div>
  ),
}))
const thread = {
  id: 'thread',
  localId: 'local',
  title: 'Saved chat',
  archived: false,
  presetId: null,
  webEnabled: false,
  headMessageId: null,
  createdAt: 1,
  updatedAt: 1,
}
let configurationFails = false
beforeEach(() => {
  configurationFails = false
  vi.clearAllMocks()
  vi.mocked(invoke).mockImplementation((command, args) => {
    switch (command) {
      case 'assistant_clipboard_status':
        return Promise.resolve({ semanticReady: false })
      case 'assistant_clipboard_filters':
        return Promise.resolve({
          tags: [],
          sourceApplications: [],
          representationFamilies: [],
          facetIds: [],
        })
      case 'ai_configuration_export':
        return configurationFails
          ? Promise.reject(new Error('configuration unavailable'))
          : Promise.resolve({
              connections: [{ id: 'connection', enabled: true }],
              presets: [
                { id: 'chat', connectionId: 'connection', purpose: 'chat', name: 'Local chat' },
              ],
              selections: { defaultChat: 'chat' },
            })
      case 'recall_thread_list':
        return Promise.resolve([thread])
      case 'assistant_search_clips':
        return Promise.resolve({
          apiVersion: 1,
          items: [],
          nextCursor: null,
          exhaustive: true,
          sourceOutcomes: [],
          warnings: [],
        })
      default:
        throw new Error('Unexpected command ' + command + JSON.stringify(args))
    }
  })
})
describe('Recall workspace context', () => {
  it('uses the single composer for local suggestions without starting an agent', async () => {
    render(<RecallPage />)
    await screen.findByTestId('chat-submission')
    expect(screen.queryByRole('textbox', { name: 'recallPage.search' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'recallPage.message' }), {
      target: { value: 'meeting notes' },
    })
    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(
            ([command, args]) =>
              command === 'assistant_search_clips' &&
              (args as { request: { query: string } }).request.query === 'meeting notes'
          )
      ).toBe(true)
    )
    expect(screen.getByTestId('chat-submission')).toHaveTextContent('')
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === 'assistant_run_begin')
    ).toBe(false)
  })
  it('keeps the same chat mounted while opening and closing context', async () => {
    render(<RecallPage />)
    const chat = await screen.findByTestId('chat-submission')
    const toggle = screen.getByRole('button', { name: 'recallContext.title' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('chat-submission')).toBe(chat)
    fireEvent.click(screen.getByRole('button', { name: 'recallContext.close' }))
    await waitFor(() => expect(toggle).toHaveFocus())
    expect(screen.getByTestId('chat-submission')).toBe(chat)
  })
  it('keeps draft suggestions available without chat configuration', async () => {
    configurationFails = true
    render(<RecallPage initialQuery="offline search" />)
    await waitFor(() =>
      expect(
        vi.mocked(invoke).mock.calls.some(([command]) => command === 'assistant_search_clips')
      ).toBe(true)
    )
    expect(screen.getByRole('textbox', { name: 'recallPage.message' })).toHaveValue(
      'offline search'
    )
  })
  it('opens the shared preview in context with a header close and guards late responses', async () => {
    const base = vi.mocked(invoke).getMockImplementation()!
    let finish!: (value: unknown) => void
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === 'assistant_search_clips')
        return Promise.resolve({
          items: [{ clip: { id: 'clip', revision: 'r', capturedAt: 1 }, snippet: 'Preview me' }],
          nextCursor: null,
          exhaustive: true,
        })
      if (command === 'assistant_read_clip')
        return new Promise(resolve => {
          finish = resolve
        })
      if (command === 'get_clip_detail') return Promise.resolve({ clip: { id: 'clip' } })
      return base(command, args)
    })
    render(<RecallPage initialQuery="preview" />)
    await screen.findByTestId('chat-submission')
    fireEvent.click(screen.getByRole('button', { name: 'recallContext.title' }))
    fireEvent.click(await screen.findByRole('button', { name: 'recallPage.preview' }))
    expect(screen.getByRole('button', { name: 'recallContext.closePreview' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'recallContext.closePreview' }))
    finish({})
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_clip_detail', { clipId: 'clip' })
    )
    expect(screen.queryByRole('button', { name: 'recallContext.closePreview' })).toBeNull()
  })
})

it('attaches at most three suggested clips explicitly without starting generation', async () => {
  const base = vi.mocked(invoke).getMockImplementation()!
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === 'assistant_search_clips'
      ? Promise.resolve({
          items: ['one', 'two', 'three', 'four'].map(id => ({
            clip: { id, revision: 'r', capturedAt: 1 },
            snippet: id,
          })),
          nextCursor: null,
          exhaustive: true,
        })
      : base(command, args)
  )
  render(<RecallPage initialQuery="notes" />)
  await screen.findByTestId('chat-submission')
  fireEvent.click(screen.getByRole('button', { name: 'recallContext.title' }))
  fireEvent.click(await screen.findByRole('button', { name: 'recallContext.attachMatches' }))
  expect(screen.getByTestId('attachments')).toHaveTextContent(
    JSON.stringify(['one', 'two', 'three'].map(clipId => ({ clipId, revision: 'r' })))
  )
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'assistant_run_begin')).toBe(
    false
  )
})
