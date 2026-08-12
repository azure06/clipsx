import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClipboardListItem } from './ClipboardListItem'
import type { ClipSummary } from '../../../shared/types/v2'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `file://${path}`,
}))

// Mock icons
vi.mock('lucide-react', () => ({
  Pin: () => <div data-testid="pin-icon" />,
  Star: () => <div data-testid="star-icon" />,
  Sparkles: () => <div data-testid="sparkles-icon" />,
  Hash: () => <div data-testid="hash-icon" />,
  MessageSquare: () => <div data-testid="message-icon" />,
  Command: () => <div data-testid="command-icon" />,
  CornerDownLeft: () => <div data-testid="corner-icon" />,
  ScanText: () => <div data-testid="scan-icon" />,
}))

// Mock ContentIcon
vi.mock('../../content/icons', () => ({
  ContentIcon: ({ presentationKind }: { presentationKind: string }) => (
    <div data-testid="content-icon">{presentationKind}</div>
  ),
}))

// Mock keyboard shortcuts
vi.mock('../../../shared/keyboard/shortcuts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../shared/keyboard/shortcuts')>()
  return {
    ...actual,
    getPlatform: () => 'linux',
  }
})

const createTextClip = (overrides?: Partial<ClipSummary>): ClipSummary => ({
  id: '1',
  sourceAppName: null,
  sourceAppId: null,
  capturedAt: 1_000_000,
  note: null,
  updatedAt: 1_000_000,
  isPinned: false,
  isFavorite: false,
  tags: [],
  safeSummary: 'Hello world',
  representationCount: 1,
  primaryPresentationKind: 'text',
  thumbnailAssetId: null,
  ...overrides,
})

const createImageClip = (overrides?: Partial<ClipSummary>): ClipSummary =>
  createTextClip({
    primaryPresentationKind: 'image',
    thumbnailAssetId: 'asset-image',
    safeSummary: '[Image: image.png]',
    ...overrides,
  })

describe('ClipboardListItem', () => {
  it('should render content icon for text clips', () => {
    const clip = createTextClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    expect(screen.getByTestId('content-icon')).toBeInTheDocument()
    expect(screen.getByTestId('content-icon')).toHaveTextContent('text')
  })

  it('should render image thumbnail for image clips', () => {
    const clip = createImageClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    const thumbnail = screen.getByRole('img', {
      name: /thumbnail/i,
    })
    expect(thumbnail).toBeInTheDocument()
    expect(thumbnail).toHaveAttribute('src', 'clipsx-asset://localhost/asset-image')
    expect(thumbnail.className).toContain('rounded-full')
    expect(thumbnail.className).toContain('object-cover')
  })

  it('should fallback to content icon when image path is missing', () => {
    const clip = createImageClip({ thumbnailAssetId: null })
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    expect(screen.getByTestId('content-icon')).toBeInTheDocument()
  })

  it('should display preview text for both image and text clips', () => {
    const textClip = createTextClip()
    const { rerender } = render(
      <ClipboardListItem clip={textClip} onCopy={vi.fn()} onSelect={vi.fn()} />
    )

    expect(screen.getByText(/Hello world/)).toBeInTheDocument()

    const imageClip = createImageClip()
    rerender(<ClipboardListItem clip={imageClip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    expect(screen.getByText(/Image:/)).toBeInTheDocument()
  })

  it('should render properly sized thumbnail (6x6 with h-6 w-6 classes)', () => {
    const clip = createImageClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    const thumbnail = screen.getByRole('img', {
      name: /thumbnail/i,
    })
    expect(thumbnail.className).toContain('h-6')
    expect(thumbnail.className).toContain('w-6')
  })

  it('should maintain list item layout with thumbnail', () => {
    const clip = createImageClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    const listItem = screen.getByText(/Image:/).closest('div')
    expect(listItem).toHaveClass('gap-3') // spacing is maintained
  })
})
