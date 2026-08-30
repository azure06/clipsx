import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipPresentation } from '../../shared/types/v2'
import { type TransformControls, useTransformState } from './useTransformState'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../../shared/hooks/useTheme', () => ({
  useTheme: () => ({ appliedTheme: 'light' }),
}))

const presentation: ClipPresentation = {
  id: 'clip-1',
  sourceAppName: null,
  sourceAppId: null,
  capturedAt: 1,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  note: null,
  tags: [],
  historyPreview: {
    leading: { kind: 'host_icon', name: 'link' },
    title: 'https://example.com',
    subtitle: null,
    badge: null,
    accessibilityLabel: 'https://example.com',
  },
  representationCount: 1,
  primaryPresentationKind: 'url',
  thumbnailAssetId: null,
  activeView: {
    id: 'view-1',
    rendererId: 'builtin.url',
    label: 'URL',
    sourceId: 'rep-1',
    mimeType: 'text/plain',
    capabilityId: 'test.text',
    facetId: 'facet-1',
    isOriginal: false,
    presentationKind: 'url',
    purpose: 'semantic',
    matchSpecificity: 0,
    placement: 'primary',
    iconSvg: null,
    iconSvgDark: null,
    iconScale: 1,
  },
  model: {
    kind: 'semantic',
    facetId: 'facet-1',
    text: 'https://example.com',
    payload: { host: 'example.com' },
  },
}

const HookHarness = ({
  clipId,
  sourceId,
  basePresentation,
}: {
  clipId: string
  sourceId: string
  basePresentation: ClipPresentation
}) => {
  const state = useTransformState({
    clipId,
    sourceId,
    basePresentation,
    onControls: controls => {
      latestControls = controls
    },
  })
  return <div data-testid="active-result">{state.activeTransformer?.label ?? ''}</div>
}

let latestControls: TransformControls | null = null

const askAction = {
  id: 'ask-ai',
  packageId: 'example.ask-ai',
  sourceId: 'rep-plain',
  facetId: null,
  label: 'Ask AI',
  icon: null,
  iconSvg: null,
  iconSvgDark: null,
  iconScale: 1,
  placements: ['preview_toolbar', 'action_menu'] as const,
  effects: ['open_https_url'],
  transformPreset: false,
  execution: 'local' as const,
  available: true,
  unavailableReason: null,
  parameterSchema: {},
  shortcut: null,
  pinned: false,
  consentRequired: false,
  externalNavigationOrigins: [],
  httpOrigins: [],
  providers: [],
}

describe('useTransformState', () => {
  beforeEach(() => {
    latestControls = null
    invokeMock.mockReset()
    invokeMock.mockResolvedValue([])
  })

  it('does not create a result tab for a non-preview action', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_transformer_contributions') return Promise.resolve([])
      if (command === 'list_context_actions') return Promise.resolve([askAction])
      if (command === 'run_context_action') {
        return Promise.resolve({ kind: 'open_https_url', url: 'https://example.com' })
      }
      return Promise.resolve([])
    })
    render(<HookHarness clipId="clip-1" sourceId="rep-1" basePresentation={presentation} />)
    await waitFor(() => expect(latestControls).not.toBeNull())

    await act(async () => latestControls?.runAction('ask-ai'))

    expect(screen.getByTestId('active-result')).toHaveTextContent('')
    expect(invokeMock).toHaveBeenCalledWith(
      'run_context_action',
      expect.objectContaining({ sourceId: 'rep-plain', facetId: null })
    )
  })

  it('creates a result tab only for an explicit preview output', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_transformer_contributions') return Promise.resolve([])
      if (command === 'list_context_actions') return Promise.resolve([askAction])
      if (command === 'run_context_action') {
        return Promise.resolve({
          kind: 'output',
          disposition: 'preview',
          preview: {
            resultId: 'result-1',
            model: { kind: 'text', text: 'Generated answer' },
          },
        })
      }
      return Promise.resolve([])
    })
    render(<HookHarness clipId="clip-1" sourceId="rep-1" basePresentation={presentation} />)
    await waitFor(() => expect(latestControls).not.toBeNull())

    await act(async () => latestControls?.runAction('ask-ai'))

    expect(screen.getByTestId('active-result')).toHaveTextContent('Ask AI')
  })

  it('opens extension dialogs with the applied theme and active locale', async () => {
    const dialogAction = {
      ...askAction,
      id: 'open-mermaid',
      label: 'Open Mermaid',
      effects: ['open_dialog'],
    }
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_transformer_contributions') return Promise.resolve([])
      if (command === 'list_context_actions') return Promise.resolve([dialogAction])
      if (command === 'issue_extension_action_invocation')
        return Promise.resolve({ token: 'token' })
      if (command === 'run_context_action') return Promise.resolve({ kind: 'open_dialog' })
      return Promise.resolve(undefined)
    })
    render(<HookHarness clipId="clip-1" sourceId="rep-1" basePresentation={presentation} />)
    await waitFor(() => expect(latestControls).not.toBeNull())

    await act(async () => latestControls?.runAction('open-mermaid'))

    expect(invokeMock).toHaveBeenCalledWith(
      'open_extension_custom_view',
      expect.objectContaining({ theme: 'light', locale: 'en', surface: 'dialog' })
    )
  })

  it('discovers transforms for the active source and presentation only', async () => {
    render(<HookHarness clipId="clip-1" sourceId="rep-1" basePresentation={presentation} />)

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('list_transformer_contributions', {
        clipId: 'clip-1',
        sourceId: 'rep-1',
        presentationKind: 'url',
      })
    )
  })
})
