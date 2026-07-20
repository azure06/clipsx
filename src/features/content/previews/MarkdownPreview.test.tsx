import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import mermaid from 'mermaid'
import { ThemeProvider, useTheme } from '../../../shared/hooks/useTheme'
import type { Content } from '../types'
import { MarkdownPreview } from './MarkdownPreview'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => `asset://${value}`,
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn((_id: string, chart: string) =>
      Promise.resolve({
        svg: `<svg data-testid="mermaid-svg"><text>${chart}</text></svg>`,
      })
    ),
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

const renderPreview = (content: Content, extra?: React.ReactNode) =>
  render(
    <ThemeProvider>
      {extra}
      <MarkdownPreview content={content} />
    </ThemeProvider>
  )

const ThemeControls = () => {
  const { setThemeMode } = useTheme()
  return <button onClick={() => setThemeMode('dark')}>Use dark theme</button>
}

describe('MarkdownPreview', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('themeMode', 'light')
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

    renderPreview(makeContent(markdown))

    expect(screen.getByText('Release Notes')).toHaveClass('text-gray-900')
    expect(screen.getByText('Item one')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('const answer = 42')).toBeInTheDocument()
    expect(screen.getByText('const answer = 42').closest('pre')).not.toBeNull()
  })

  it('renders mermaid fences through the Mermaid component path', async () => {
    renderPreview(makeContent(['```mermaid', 'graph TD', '  A --> B', '```'].join('\n')))

    await screen.findByTestId('mermaid-diagram')
    await screen.findByTestId('mermaid-svg')

    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    })
    expect(mermaid.render).toHaveBeenCalled()
  })

  it('uses the dark Mermaid theme and rerenders when the applied theme changes', async () => {
    const chart = ['```mermaid', 'graph TD', '  A --> B', '```'].join('\n')
    renderPreview(makeContent(chart), <ThemeControls />)

    await screen.findByTestId('mermaid-svg')
    expect(mermaid.initialize).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }))

    await waitFor(() => {
      expect(mermaid.initialize).toHaveBeenLastCalledWith({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
      })
    })
    expect(mermaid.render).toHaveBeenCalledTimes(2)
  })

  it('passes explicit Mermaid styling through unchanged', async () => {
    const diagram = [
      "%%{init: {'theme': 'base'}}%%",
      'flowchart TD',
      '  A --> B',
      '  style A fill:#123456,color:#ffffff',
    ].join('\n')

    renderPreview(makeContent(['```mermaid', diagram, '```'].join('\n')))

    await waitFor(() => {
      expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), diagram)
    })
  })

  it('keeps non-mermaid fenced blocks as code', async () => {
    renderPreview(makeContent(['```json', '{"hello":"world"}', '```'].join('\n')))

    await waitFor(() => {
      expect(screen.getByText('{"hello":"world"}').closest('pre')).not.toBeNull()
    })
    expect(screen.queryByTestId('mermaid-diagram')).not.toBeInTheDocument()
  })

  it('does not execute raw html', () => {
    renderPreview(makeContent('<div data-testid="raw-html">unsafe</div>\n\nParagraph text'))

    expect(screen.queryByTestId('raw-html')).not.toBeInTheDocument()
    expect(screen.getByText('Paragraph text')).toBeInTheDocument()
  })
})
