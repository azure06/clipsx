import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Content, SmartAction } from '../types'
import { PreviewLocalMenu } from './PreviewShell'
import { TextPreview } from './TextPreview'
import { JSONPreview } from './JSONPreview'
import { URLPreview } from './URLPreview'
import { OfficePreview } from './OfficePreview'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => `asset://${value}`,
}))

const makeContent = (overrides: Partial<Content> = {}): Content => ({
  type: 'text',
  text: 'sample text',
  metadata: {},
  clip: {
    id: 'clip-1',
    contentType: 'text',
    detectedType: 'text',
    contentText: 'sample text',
    contentHtml: null,
    contentRtf: null,
    svgPath: null,
    pdfPath: null,
    imagePath: null,
    attachmentPath: null,
    attachmentType: null,
    filePaths: null,
    ocrText: null,
    indexText: 'sample text',
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
  ...overrides,
})

describe('preview light theme styling', () => {
  beforeEach(() => {
    document.documentElement.className = 'light'
  })

  it('renders preview local menu with light-safe surface and text classes', async () => {
    const user = userEvent.setup()
    const action: SmartAction = {
      id: 'copy',
      label: 'Copy Domain',
      icon: <span data-testid="action-icon">I</span>,
      category: 'utility',
      placement: 'preview_menu',
      check: () => true,
      execute: vi.fn(),
    }

    render(<PreviewLocalMenu actions={[action]} content={makeContent()} />)

    await user.click(screen.getByRole('button', { name: /more actions/i }))

    const item = await screen.findByText('Copy Domain')
    const menu = item.closest('[data-radix-popper-content-wrapper]')?.firstElementChild

    expect(menu).not.toBeNull()
    expect(menu?.className).toContain('bg-white/95')
    expect(item).toHaveClass('text-gray-700')
  })

  it('renders plain text preview with dark text in light mode', () => {
    render(<TextPreview content={makeContent({ text: 'Readable text' })} />)

    expect(screen.getByText('Readable text')).toHaveClass('text-gray-900')
  })

  it('renders structured previews without dark-only background leaks in light mode', () => {
    const { rerender } = render(
      <JSONPreview content={makeContent({ type: 'json', text: '{"hello":"world"}' })} />
    )

    const jsonCode = screen.getByText(/"hello"/)
    expect(jsonCode).toHaveClass('text-emerald-700')

    rerender(
      <URLPreview
        content={makeContent({
          type: 'url',
          text: 'https://example.com/docs',
          metadata: { url: 'https://example.com/docs' },
        })}
      />
    )

    expect(screen.getByText('https://example.com/docs')).toHaveClass('text-gray-900')
    const hostname = screen
      .getAllByText('example.com')
      .find(element => element.className.includes('text-blue-700'))

    expect(hostname).toBeDefined()
    expect(hostname).toHaveClass('text-blue-700')
  })

  it('renders office text tab with readable text colors in light mode', () => {
    render(
      <OfficePreview
        content={makeContent({
          type: 'office',
          text: 'Spreadsheet export',
        })}
      />
    )

    expect(screen.getByText('Spreadsheet export')).toHaveClass('text-gray-700')
  })
})
