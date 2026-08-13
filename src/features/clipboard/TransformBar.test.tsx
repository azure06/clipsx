import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipPresentation } from '../../shared/types/v2'
import { useTransformState } from './useTransformState'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

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
  safeSummary: 'https://example.com',
  representationCount: 1,
  primaryPresentationKind: 'url',
  thumbnailAssetId: null,
  activeView: {
    id: 'view-1',
    rendererId: 'builtin.url',
    label: 'URL',
    sourceId: 'rep-1',
    mimeType: 'text/plain',
    facetId: 'facet-1',
    isOriginal: false,
    presentationKind: 'url',
    placement: 'primary',
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
  useTransformState({ clipId, sourceId, basePresentation, onControls: undefined })
  return null
}

describe('useTransformState', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue([])
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
