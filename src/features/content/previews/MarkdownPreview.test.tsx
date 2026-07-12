import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import mermaid from 'mermaid'
import type { Content } from '../types'
import { MarkdownPreview } from './MarkdownPreview'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => `asset://${value}`,
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, chart: string) => ({
      svg: `<svg data-testid="mermaid-svg"><text>${chart}</text></svg>`,
    })),
  },
}))

const makeContent = (text: string): Content => ({
  type: 'markdown',
  text,
  metadata: {
    language: 'markdown',
    line_count: text.split('\n').length,
    word_count: text.split(/\s+/).filter(Boolean).length,
  },
  clip: {
    id: 'clip-md-1',
    contentType: 'text',
    detectedType: 'markdown',
    contentText: text,
    contentHtml: null,
    contentRtf: null,
    svgPath: null,
    pdfPath: null,
    imagePath: null,
    attachmentPath: null,
    attachmentType: null,
    filePaths: null,
    ocrText: null,
    indexText: text,
    primaryTextSource: 'clipboard',
    ocrStatus: 'not_needed',
    metadata: null,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    appName: null,
    isPinned: false,
    isFavorite: false,
    accessCount: 0,
    contentHash: null,
  },
})

describe('MarkdownPreview', () => {
  beforeEach(() => {
    document.documentElement.className = 'light'
    vi.clearAllMocks()
  })

  it('renders headings, lists, tables, and fenced code blocks', () => {
    const markdown = [
      '# Release Notes',
      '',
      '- Item one',
      '- Item two',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| foo | bar |',
      '',
      '```ts',
      'const answer = 42',
      '```',
    ].join('\n')

    render(<MarkdownPreview content={makeContent(markdown)} />)

    expect(screen.getByText('Release Notes')).toHaveClass('text-gray-900')
    expect(screen.getByText('Item one')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('const answer = 42')).toBeInTheDocument()
    expect(screen.getByText('const answer = 42').closest('pre')).not.toBeNull()
  })

  it('renders mermaid fences through the Mermaid component path', async () => {
    render(
      <MarkdownPreview
        content={makeContent(['```mermaid', 'graph TD', '  A --> B', '```'].join('\n'))}
      />
    )

    await screen.findByTestId('mermaid-diagram')
    await screen.findByTestId('mermaid-svg')

    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
    })
    expect(mermaid.render).toHaveBeenCalled()
  })

  it('keeps non-mermaid fenced blocks as code', async () => {
    render(
      <MarkdownPreview content={makeContent(['```json', '{"hello":"world"}', '```'].join('\n'))} />
    )

    await waitFor(() => {
      expect(screen.getByText('{"hello":"world"}').closest('pre')).not.toBeNull()
    })
    expect(screen.queryByTestId('mermaid-diagram')).not.toBeInTheDocument()
  })

  it('does not execute raw html', () => {
    render(
      <MarkdownPreview
        content={makeContent('<div data-testid="raw-html">unsafe</div>\n\nParagraph text')}
      />
    )

    expect(screen.queryByTestId('raw-html')).not.toBeInTheDocument()
    expect(screen.getByText('Paragraph text')).toBeInTheDocument()
  })
})
