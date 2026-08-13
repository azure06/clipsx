import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V2ViewPanel } from './V2ViewPanel'

const { invokeMock, listenMock, unlistenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

const summary = {
  id: 'clip-1',
  sourceAppName: 'Editor',
  sourceAppId: null,
  capturedAt: 1,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  note: null,
  tags: [],
  safeSummary: 'canonical text',
  representationCount: 1,
  primaryPresentationKind: 'text',
  thumbnailAssetId: null,
}

let artifactListener: ((event: { payload: { clipId: string; sourceId: string } }) => void) | null

describe('V2ViewPanel resolver boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    artifactListener = null
    listenMock.mockImplementation((_event: string, callback: typeof artifactListener) => {
      artifactListener = callback
      return Promise.resolve(unlistenMock)
    })
    invokeMock.mockImplementation((command: string, args?: { rendererId?: string }) => {
      if (command === 'get_clip_detail') {
        return Promise.resolve({
          clip: summary,
          representations: [
            {
              id: 'rep-1',
              formatKey: 'windows:CF_UNICODETEXT',
              canonicalMimeType: 'text/plain',
              nativeType: 'CF_UNICODETEXT',
              storageKind: 'text',
              ordinal: 0,
              capturePriority: 10,
              byteLength: 14,
              textValue: 'canonical text',
              fileReferences: [],
              binaryFileId: null,
              sha256: null,
              capabilityId: 'windows.text.unicode',
              formatFamily: 'text',
            },
          ],
          formatObservations: [],
        })
      }
      if (command === 'get_clip_views') {
        return Promise.resolve({
          clipId: 'clip-1',
          primaryViewId: 'extension-view',
          presentationKind: 'extension',
          facets: [],
          views: [
            {
              id: 'core-view',
              rendererId: 'builtin.text',
              label: 'Text',
              sourceId: 'rep-1',
              mimeType: 'text/plain',
              facetId: null,
              isOriginal: false,
              presentationKind: 'text',
              placement: 'alternate',
            },
            {
              id: 'extension-view',
              rendererId: 'sample.renderer',
              label: 'Extension',
              sourceId: 'rep-1',
              mimeType: 'text/plain',
              facetId: null,
              isOriginal: false,
              presentationKind: 'extension',
              placement: 'primary',
            },
          ],
        })
      }
      if (command === 'render_clip_view' && args?.rendererId === 'sample.renderer') {
        return Promise.reject(new Error('extension failed'))
      }
      if (command === 'render_clip_view' && args?.rendererId === 'builtin.text') {
        return Promise.resolve({ kind: 'text', text: 'canonical text' })
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })
  })

  it('uses primaryViewId, falls back to core, and never starts a transform while opening', async () => {
    render(<V2ViewPanel clipId="clip-1" />)

    expect(await screen.findByText('canonical text')).toBeInTheDocument()
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'render_clip_view',
        expect.objectContaining({ rendererId: 'sample.renderer' })
      )
      expect(invokeMock).toHaveBeenCalledWith(
        'render_clip_view',
        expect.objectContaining({ rendererId: 'builtin.text' })
      )
    })
    expect(invokeMock).not.toHaveBeenCalledWith('create_transform_preview', expect.anything())
  })

  it('refreshes only the render model after artifact completion', async () => {
    render(<V2ViewPanel clipId="clip-1" />)
    expect(await screen.findByText('canonical text')).toBeInTheDocument()
    const detailCalls = invokeMock.mock.calls.filter(
      ([command]) => command === 'get_clip_detail'
    ).length
    const renderCalls = invokeMock.mock.calls.filter(
      ([command]) => command === 'render_clip_view'
    ).length

    act(() => {
      artifactListener?.({ payload: { clipId: 'clip-1', sourceId: 'other-representation' } })
    })
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'render_clip_view')
    ).toHaveLength(renderCalls)

    act(() => {
      artifactListener?.({ payload: { clipId: 'clip-1', sourceId: 'rep-1' } })
    })
    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([command]) => command === 'render_clip_view').length
      ).toBeGreaterThan(renderCalls)
    })
    expect(invokeMock.mock.calls.filter(([command]) => command === 'get_clip_detail')).toHaveLength(
      detailCalls
    )
  })

  it('ignores a stale render response after the selected clip changes', async () => {
    let resolveOldRender: ((model: { kind: 'text'; text: string }) => void) | undefined
    invokeMock.mockImplementation(
      (command: string, args?: { clipId?: string; rendererId?: string }) => {
        const clipId = args?.clipId ?? 'clip-1'
        if (command === 'get_clip_detail') {
          return Promise.resolve({
            clip: { ...summary, id: clipId },
            representations: [],
            formatObservations: [],
          })
        }
        if (command === 'get_clip_views') {
          return Promise.resolve({
            clipId,
            primaryViewId: 'view',
            presentationKind: 'text',
            facets: [],
            views: [
              {
                id: 'view',
                rendererId: 'builtin.text',
                label: 'Text',
                sourceId: `rep-${clipId}`,
                mimeType: 'text/plain',
                facetId: null,
                isOriginal: false,
                presentationKind: 'text',
                placement: 'primary',
              },
            ],
          })
        }
        if (command === 'render_clip_view' && clipId === 'clip-1') {
          return new Promise(resolve => {
            resolveOldRender = resolve
          })
        }
        if (command === 'render_clip_view') {
          return Promise.resolve({ kind: 'text', text: 'new clip model' })
        }
        return Promise.reject(new Error(`unexpected command: ${command}`))
      }
    )

    const { rerender } = render(<V2ViewPanel clipId="clip-1" />)
    await waitFor(() => expect(resolveOldRender).toBeDefined())
    rerender(<V2ViewPanel clipId="clip-2" />)
    expect(await screen.findByText('new clip model')).toBeInTheDocument()

    act(() => resolveOldRender?.({ kind: 'text', text: 'stale clip model' }))
    expect(screen.queryByText('stale clip model')).not.toBeInTheDocument()
  })

  it('unsubscribes from artifact events on unmount', async () => {
    const { unmount } = render(<V2ViewPanel clipId="clip-1" />)
    expect(await screen.findByText('canonical text')).toBeInTheDocument()
    const callsBeforeUnmount = unlistenMock.mock.calls.length
    unmount()
    expect(unlistenMock.mock.calls.length).toBeGreaterThan(callsBeforeUnmount)
  })
})
