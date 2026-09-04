import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ClipSummary } from '../../../shared/types/v2'
import { ClipboardListView } from './ClipboardListView'

vi.mock('../components', () => ({
  ClipboardListItem: ({ clip, index }: { clip: ClipSummary; index: number }) => (
    <div data-testid="virtual-clip" data-index={index}>
      {clip.id}
    </div>
  ),
}))

const clip = (index: number): ClipSummary => ({
  id: `clip-${index}`,
  sourceAppName: null,
  sourceAppId: null,
  capturedAt: index,
  updatedAt: index,
  isPinned: false,
  isFavorite: false,
  note: null,
  representationCount: 1,
  primaryPresentationKind: 'text',
  thumbnailAssetId: null,
  hasPlainText: true,
  shareable: true,
  tags: [],
  historyPreview: {
    leading: { kind: 'host_icon', name: 'text' },
    title: `Clip ${index}`,
    subtitle: null,
    badge: null,
    accessibilityLabel: `Clip ${index}`,
  },
})

describe('ClipboardListView virtualization', () => {
  it('keeps the mounted row count bounded for a 60,000-item history', () => {
    render(
      <ClipboardListView
        clips={Array.from({ length: 60_000 }, (_, index) => clip(index))}
        onCopy={vi.fn()}
      />
    )

    expect(screen.getAllByTestId('virtual-clip').length).toBeLessThanOrEqual(32)
  })
})
