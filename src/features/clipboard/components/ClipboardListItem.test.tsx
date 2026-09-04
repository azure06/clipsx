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
  Binary: () => <div data-testid="binary-icon" />,
  Braces: () => <div data-testid="braces-icon" />,
  Briefcase: () => <div data-testid="briefcase-icon" />,
  CalendarDays: () => <div data-testid="calendar-icon" />,
  Code2: () => <div data-testid="code-icon" />,
  Database: () => <div data-testid="database-icon" />,
  File: () => <div data-testid="file-icon" />,
  FileCode2: () => <div data-testid="html-icon" />,
  FileQuestion: () => <div data-testid="file-question-icon" />,
  FileText: () => <div data-testid="file-text-icon" />,
  FileType: () => <div data-testid="text-file-icon" />,
  Files: () => <div data-testid="files-icon" />,
  Folder: () => <div data-testid="folder-icon" />,
  Globe: () => <div data-testid="globe-icon" />,
  Image: () => <div data-testid="image-icon" />,
  KeyRound: () => <div data-testid="key-icon" />,
  Link: () => <div data-testid="link-icon" />,
  Mail: () => <div data-testid="mail-icon" />,
  Palette: () => <div data-testid="palette-icon" />,
  Phone: () => <div data-testid="phone-icon" />,
  Sigma: () => <div data-testid="sigma-icon" />,
  Table2: () => <div data-testid="table-icon" />,
  Terminal: () => <div data-testid="terminal-icon" />,
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
  historyPreview: {
    leading: { kind: 'none' },
    title: 'Hello world',
    subtitle: null,
    badge: null,
    accessibilityLabel: 'Hello world',
  },
  representationCount: 1,
  primaryPresentationKind: 'text',
  thumbnailAssetId: null,
  hasPlainText: true,
  shareable: true,
  ...overrides,
})

const createImageClip = (overrides?: Partial<ClipSummary>): ClipSummary =>
  createTextClip({
    primaryPresentationKind: 'image',
    thumbnailAssetId: 'asset-image',
    historyPreview: {
      leading: { kind: 'input_thumbnail' },
      title: '[Image: image.png]',
      subtitle: null,
      badge: null,
      accessibilityLabel: '[Image: image.png]',
    },
    ...overrides,
  })

describe('ClipboardListItem', () => {
  it('should render a fallback icon for text clips with no explicit leading visual', () => {
    const clip = createTextClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    expect(screen.getByTestId('file-icon')).toBeInTheDocument()
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

  it('falls back to the plain icon when a thumbnail cannot load', () => {
    render(<ClipboardListItem clip={createImageClip()} onCopy={vi.fn()} onSelect={vi.fn()} />)
    const thumbnail = screen.getByRole('img', { name: /thumbnail/i })
    fireEvent.error(thumbnail)
    expect(screen.getByTestId('file-icon')).toBeInTheDocument()
  })

  it('should fallback to the plain icon when image path is missing', () => {
    const clip = createImageClip({ thumbnailAssetId: null })
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    expect(screen.getByTestId('file-icon')).toBeInTheDocument()
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

  it('should render a compact circular thumbnail in the list row', () => {
    const clip = createImageClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    const thumbnail = screen.getByRole('img', {
      name: /thumbnail/i,
    })
    expect(thumbnail.className).toContain('h-[26px]')
    expect(thumbnail.className).toContain('w-[26px]')
    expect(thumbnail.className).toContain('rounded-full')
  })

  it('should maintain list item layout with thumbnail', () => {
    const clip = createImageClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} index={0} />)

    const listItem = screen.getByText(/Image:/).closest('[data-clip-index]')
    expect(listItem).toHaveClass('gap-3') // spacing is maintained
  })

  it('shows the semantic percentage only for semantic-only search results', () => {
    const { rerender } = render(
      <ClipboardListItem
        clip={createTextClip({
          searchMatches: [
            { sourceId: 'builtin.search.semantic_text', sourceRank: 1, sourceScore: 0.824 },
          ],
        })}
        onCopy={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByLabelText('Semantic Match Score: 82%')).toBeInTheDocument()
    rerender(
      <ClipboardListItem
        clip={createTextClip({
          searchMatches: [
            { sourceId: 'builtin.search.fts', sourceRank: 1 },
            { sourceId: 'builtin.search.semantic_text', sourceRank: 2, sourceScore: 0.824 },
          ],
        })}
        onCopy={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.queryByText('82%')).not.toBeInTheDocument()
  })

  it('renders a cached compact swatch without invoking extension code', () => {
    const clip = createTextClip({
      historyPreview: {
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
    expect(screen.queryByTestId('file-icon')).not.toBeInTheDocument()
  })
})
