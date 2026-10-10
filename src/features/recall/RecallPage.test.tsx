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
  RecallChat: ({ ask }: { ask: { text: string } | null }) => (
    <div data-testid="chat-submission">{ask?.text ?? ''}</div>
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
describe('Recall workspace submission', () => {
  it('typing and Enter retrieve without generating; Ask submits explicitly', async () => {
    render(<RecallPage />)
    await screen.findByTestId('chat-submission')
    const input = screen.getByRole('textbox', { name: 'recallPage.search' })
    fireEvent.change(input, { target: { value: 'meeting notes' } })
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
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByTestId('chat-submission')).toHaveTextContent('')
    fireEvent.click(screen.getByRole('button', { name: 'recallPage.ask' }))
    expect(screen.getByTestId('chat-submission')).toHaveTextContent('meeting notes')
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === 'assistant_run_begin')
    ).toBe(false)
  })
  it('keeps keyword search available if chat configuration fails', async () => {
    configurationFails = true
    render(<RecallPage initialQuery="offline search" />)
    await waitFor(() =>
      expect(
        vi.mocked(invoke).mock.calls.some(([command]) => command === 'assistant_search_clips')
      ).toBe(true)
    )
    expect(screen.getByRole('button', { name: 'recallPage.ask' })).toBeDisabled()
  })
})
