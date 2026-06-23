import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClipboardListItem } from './ClipboardListItem'
import type { ClipItem } from '../../../shared/types'

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
vi.mock('../../content', () => ({
  ContentIcon: ({ content }: any) => <div data-testid="content-icon">{content.type}</div>,
  clipToContent: (clip: any) => ({ type: clip.contentType }),
}))

// Mock keyboard shortcuts
vi.mock('../../../shared/keyboard/shortcuts', () => ({
  getPlatform: () => 'linux',
}))

const createTextClip = (overrides?: Partial<ClipItem>): ClipItem => ({
  id: '1',
  contentType: 'text',
  contentText: 'Hello world',
  contentHtml: null,
  contentRtf: null,
  svgPath: null,
  pdfPath: null,
  imagePath: null,
  attachmentPath: null,
  attachmentType: null,
  filePaths: null,
  ocrText: null,
  indexText: 'hello world',
  primaryTextSource: 'clipboard' as const,
  ocrStatus: 'done' as const,
  detectedType: 'text',
  metadata: null,
  note: null,
  createdAt: 1000,
  updatedAt: 1000,
  appName: null,
  isPinned: false,
  isFavorite: false,
  accessCount: 0,
  contentHash: null,
  hasEmbedding: false,
  similarityScore: undefined,
  ...overrides,
})

const createImageClip = (overrides?: Partial<ClipItem>): ClipItem =>
  createTextClip({
    contentType: 'image',
    imagePath: '/tmp/image.png',
    contentText: '[Image: image.png]',
    detectedType: 'image',
    ocrStatus: 'pending' as const,
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
    }) as HTMLImageElement
    expect(thumbnail).toBeInTheDocument()
    expect(thumbnail.src).toBe('file:///tmp/image.png')
    expect(thumbnail.className).toContain('rounded')
    expect(thumbnail.className).toContain('object-cover')
  })

  it('should fallback to content icon when image path is missing', () => {
    const clip = createImageClip({ imagePath: null })
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

  it('should render properly sized thumbnail (8x8 with h-8 w-8 classes)', () => {
    const clip = createImageClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    const thumbnail = screen.getByRole('img', {
      name: /thumbnail/i,
    }) as HTMLImageElement
    expect(thumbnail.className).toContain('h-8')
    expect(thumbnail.className).toContain('w-8')
  })

  it('should maintain list item layout with thumbnail', () => {
    const clip = createImageClip()
    render(<ClipboardListItem clip={clip} onCopy={vi.fn()} onSelect={vi.fn()} />)

    const listItem = screen.getByText(/Image:/).closest('div')
    expect(listItem).toHaveClass('gap-3') // spacing is maintained
  })
})
