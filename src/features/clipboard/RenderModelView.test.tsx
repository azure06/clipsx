import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { RenderModelView } from './RenderModelView'
import { renderModelText } from './presentationModel'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const presentation = (model: RenderModel, presentationKind = model.kind): ClipPresentation => ({
  id: 'clip-1',
  sourceAppName: 'Editor',
  sourceAppId: null,
  capturedAt: 1,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  note: null,
  tags: [],
  safeSummary: 'summary',
  representationCount: 1,
  primaryPresentationKind: presentationKind,
  thumbnailAssetId: null,
  activeView: {
    id: 'view-1',
    rendererId: `builtin.${model.kind}`,
    label: 'View',
    sourceId: 'rep-1',
    mimeType: null,
    facetId: null,
    isOriginal: false,
    presentationKind,
    placement: 'primary',
  },
  model,
})

afterEach(cleanup)

describe('RenderModelView', () => {
  const fixtures: Array<[RenderModel, string]> = [
    [{ kind: 'text', text: 'plain text' }, 'plain text'],
    [{ kind: 'code', language: 'rust', text: 'fn main() {}' }, 'fn main() {}'],
    [{ kind: 'markdown', markdown: '# Heading' }, 'Heading'],
    [{ kind: 'table', columns: ['Name'], rows: [['Ada']] }, 'Ada'],
    [{ kind: 'tree', value: { answer: 42 } }, 'answer:'],
    [{ kind: 'key_value', entries: [['Host', 'example.com']] }, 'example.com'],
    [
      { kind: 'image', assetId: 'image-1', ocr: { state: 'ready', text: 'recognized' } },
      'recognized',
    ],
    [{ kind: 'files', entries: [{ path: 'C:\\missing\\a.txt', name: 'a.txt' }] }, 'a.txt'],
    [
      { kind: 'document', assetId: 'document-1', mimeType: 'application/pdf' },
      'Document preview unavailable.',
    ],
    [
      { kind: 'office', formatKey: 'windows:Office', nativeType: 'Office', byteLength: 12 },
      'Office/native representation',
    ],
    [
      {
        kind: 'semantic',
        facetId: 'core.link.url',
        text: 'https://example.com',
        payload: { host: 'example.com' },
      },
      'example.com',
    ],
    [
      {
        kind: 'unsupported',
        formatKey: 'native:x',
        mimeType: null,
        nativeType: 'x',
        byteLength: 3,
      },
      'Unsupported preview',
    ],
    [{ kind: 'error', message: 'render failed' }, 'render failed'],
  ]

  it.each(fixtures)('renders the %s model without a legacy Content adapter', (model, expected) => {
    render(<RenderModelView presentation={presentation(model)} />)
    expect(screen.getAllByText(expected, { exact: false })[0]).toBeInTheDocument()
  })

  it('keeps table cells structured instead of flattening them to tab text', () => {
    render(
      <RenderModelView
        presentation={presentation({ kind: 'table', columns: ['A', 'B'], rows: [['one', 'two']] })}
      />
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('cell')).toHaveLength(2)
    expect(screen.queryByText('one\ttwo')).not.toBeInTheDocument()
  })

  it('renders HTML and rich text only through sandboxed iframe documents', () => {
    const { rerender } = render(
      <RenderModelView
        presentation={presentation({ kind: 'html', sanitizedHtml: '<p>safe</p>' })}
      />
    )
    const html = screen.getByTitle('HTML preview')
    expect(html).toHaveAttribute('sandbox', '')
    expect(html).toHaveAttribute('srcdoc', '<p>safe</p>')
    rerender(
      <RenderModelView
        presentation={presentation({
          kind: 'rich_text',
          sanitizedHtml: '<p><strong>safe</strong></p>',
          plainText: 'safe',
        })}
      />
    )
    expect(screen.getByTitle('Rich text preview')).toHaveAttribute('sandbox', '')
  })

  it('shows every OCR terminal state without fabricating OCR text', () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <RenderModelView
        presentation={presentation({
          kind: 'image',
          assetId: 'image-1',
          ocr: { state: 'failed', message: 'Text recognition failed' },
        })}
        onRetryOcr={onRetry}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
    rerender(
      <RenderModelView
        presentation={presentation({
          kind: 'image',
          assetId: 'image-1',
          ocr: { state: 'ready', text: '' },
        })}
      />
    )
    expect(screen.getByText('No text found.')).toBeInTheDocument()
  })

  it.each([
    [{ state: 'disabled' } as const, 'Text recognition is disabled.'],
    [{ state: 'pending' } as const, 'Text recognition is queued.'],
    [{ state: 'running' } as const, 'Text recognition is running'],
    [{ state: 'unsupported' } as const, 'Text recognition is unavailable on this platform.'],
  ])('renders the %s OCR lifecycle state', (ocr, expected) => {
    render(
      <RenderModelView presentation={presentation({ kind: 'image', assetId: 'image-1', ocr })} />
    )
    expect(screen.getByText(expected, { exact: false })).toBeInTheDocument()
  })

  it('derives text statistics only from models that actually contain text', () => {
    expect(renderModelText({ kind: 'table', columns: ['A'], rows: [['one']] })).toBeNull()
    expect(renderModelText({ kind: 'text', text: 'one' })).toBe('one')
  })
})
