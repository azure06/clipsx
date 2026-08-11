import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V2ViewPanel } from './V2ViewPanel'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../content', () => ({
  ContentPreview: ({ content }: { content: { text: string } }) => <div>{content.text}</div>,
}))
vi.mock('./TransformMenu', () => ({ TransformMenu: () => <button>Transforms</button> }))

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

describe('V2ViewPanel resolver boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
            },
          ],
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
})
