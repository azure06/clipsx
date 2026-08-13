import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
  Braces: () => <div data-testid="braces-icon" />,
  Code2: () => <div data-testid="code-icon" />,
  Database: () => <div data-testid="database-icon" />,
  File: () => <div data-testid="file-icon" />,
  Globe: () => <div data-testid="globe-icon" />,
  KeyRound: () => <div data-testid="key-icon" />,
  Link: () => <div data-testid="link-icon" />,
  Palette: () => <div data-testid="palette-icon" />,
  Table2: () => <div data-testid="table-icon" />,
  Terminal: () => <div data-testid="terminal-icon" />,
  Text: () => <div data-testid="text-icon" />,
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

  it('falls back to the content icon when a thumbnail cannot load', () => {
    render(<ClipboardListItem clip={createImageClip()} onCopy={vi.fn()} onSelect={vi.fn()} />)
    const thumbnail = screen.getByRole('img', { name: /thumbnail/i })
    fireEvent.error(thumbnail)
    expect(screen.getByTestId('content-icon')).toBeInTheDocument()
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
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} index={0} />)

    const listItem = screen.getByText(/Image:/).closest('[data-clip-index]')
    expect(listItem).toHaveClass('gap-3') // spacing is maintained
  })

  it('labels only semantic-only search results as meaning matches', () => {
    const { rerender } = render(
      <ClipboardListItem
        clip={createTextClip({
          searchMatches: [{ sourceId: 'builtin.search.semantic_text', sourceRank: 1 }],
        })}
        onCopy={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Meaning match')).toBeInTheDocument()
    rerender(
      <ClipboardListItem
        clip={createTextClip({
          searchMatches: [
            { sourceId: 'builtin.search.fts', sourceRank: 1 },
            { sourceId: 'builtin.search.semantic_text', sourceRank: 2 },
          ],
        })}
        onCopy={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.queryByText('Meaning match')).not.toBeInTheDocument()
  })

  it('renders a cached compact swatch without invoking extension code', () => {
    const clip = createTextClip({
      compactPresentation: {
        leading: { kind: 'swatch', red: 255, green: 0, blue: 64, alpha: 255 },
        title: '#FF0040',
        subtitle: 'rgb(255, 0, 64)',
        badge: 'HEX',
        accessibilityLabel: 'Bright red color',
      },
    })
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    const swatch = screen.getByLabelText('Bright red color')
    expect(swatch).toHaveStyle({ backgroundColor: 'rgba(255, 0, 64, 1)' })
    expect(screen.getByText('#FF0040')).toBeInTheDocument()
    expect(screen.getByText('rgb(255, 0, 64)')).toBeInTheDocument()
    expect(screen.getByText('HEX')).toBeInTheDocument()
    expect(screen.queryByTestId('content-icon')).not.toBeInTheDocument()
  })
})
