import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { RenderModelView } from './RenderModelView'
import { renderModelText } from './presentationModel'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const presentation = (
  model: RenderModel,
  presentationKind: string = model.kind
): ClipPresentation => ({
  id: 'clip-1',
  sourceAppName: 'Editor',
  sourceAppId: null,
  capturedAt: 1,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  note: null,
  tags: [],
  historyPreview: {
    leading: { kind: 'host_icon', name: 'text' },
    title: 'summary',
    subtitle: null,
    badge: null,
    accessibilityLabel: 'summary',
  },
  representationCount: 1,
  primaryPresentationKind: presentationKind,
  thumbnailAssetId: null,
  activeView: {
    id: 'view-1',
    rendererId: `builtin.${model.kind}`,
    label: 'View',
    sourceId: 'rep-1',
    mimeType: null,
    capabilityId: 'test.text',
    facetId: null,
    isOriginal: false,
    presentationKind,
    purpose: 'faithful',
    matchSpecificity: 0,
    placement: 'primary',
  },
  model,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RenderModelView', () => {
  const fixtures: Array<[RenderModel, string]> = [
    [{ kind: 'text', text: 'plain text' }, 'plain text'],
    [{ kind: 'code', language: 'rust', text: 'fn main() {}' }, 'fn main() {}'],
    [{ kind: 'markdown', markdown: '# Heading' }, 'Heading'],
    [{ kind: 'table', columns: ['Name'], rows: [['Ada']] }, 'Ada'],
    [{ kind: 'tree', value: { answer: 42 } }, 'answer:'],
    [{ kind: 'key_value', entries: [['Host', 'example.com']] }, 'example.com'],
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
    [
      {
        kind: 'card',
        leading: { kind: 'swatch', red: 255, green: 0, blue: 64, alpha: 255 },
        title: '#FF0040',
        subtitle: 'Color',
        fields: [['RGB', '255, 0, 64']],
      },
      '255, 0, 64',
    ],
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
    expect(html).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(html.getAttribute('srcdoc')).toContain('data-clipsx-preview-theme')
    expect(html.getAttribute('srcdoc')).toContain('<p>safe</p>')
    rerender(
      <RenderModelView
        presentation={presentation({
          kind: 'rich_text',
          sanitizedHtml: '<p><strong>safe</strong></p>',
          plainText: 'safe',
        })}
      />
    )
    expect(screen.getByTitle('Rich text preview')).toHaveAttribute('sandbox', 'allow-same-origin')
  })

  it('uses the shared themed scroll owner for semantic previews', () => {
    const { container } = render(
      <RenderModelView
        presentation={presentation(
          {
            kind: 'semantic',
            facetId: 'core.link.url',
            text: 'https://example.com',
            payload: { host: 'example.com' },
          },
          'url'
        )}
      />
    )
    expect(container.firstElementChild).toHaveClass('custom-scrollbar', 'overscroll-contain')
  })

  it('routes every color renderer format through source-linked literal output', async () => {
    render(
      <RenderModelView
        presentation={presentation(
          {
            kind: 'semantic',
            facetId: 'core.value.color',
            text: '#ff0040',
            payload: { hex: '#ff0040' },
          },
          'color'
        )}
      />
    )

    for (const value of ['#FF0040', 'rgb(255, 0, 64)', 'hsl(345°, 100%, 50%)']) {
      fireEvent.click(screen.getByText(value))
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('execute_clipboard_output', {
          request: {
            disposition: 'copy',
            source: { kind: 'literal_text', text: value, sourceClipId: 'clip-1' },
          },
        })
      )
    }
  })

  it('keeps secrets out of the DOM until reveal and resets for a different clip', async () => {
    const firstSecret = 'sk_test_0123456789abcdefghijklmnop'
    const secretModel: RenderModel = {
      kind: 'semantic',
      facetId: 'core.security.secret',
      text: firstSecret,
      payload: { kind: 'stripe_key' },
    }
    const { rerender } = render(
      <RenderModelView presentation={presentation(secretModel, 'secret')} />
    )
    expect(screen.queryByText(firstSecret)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reveal secret/i }))
    expect(screen.getByText(firstSecret)).toBeInTheDocument()
    const next = presentation(
      { ...secretModel, text: 'ghp_0123456789abcdefghijklmnopqrstuvwxyz' },
      'secret'
    )
    next.id = 'clip-2'
    rerender(<RenderModelView presentation={next} />)
    await waitFor(() =>
      expect(
        screen.queryByText(next.model.kind === 'semantic' ? next.model.text : '')
      ).not.toBeInTheDocument()
    )
  })

  it('restores URL video and domain-search actions', () => {
    render(
      <RenderModelView
        presentation={presentation(
          {
            kind: 'semantic',
            facetId: 'core.link.url',
            text: 'https://media.example.com/demo.mp4',
            payload: { host: 'media.example.com' },
          },
          'url'
        )}
      />
    )
    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'https://media.example.com/demo.mp4'
    )
    fireEvent.click(screen.getByRole('button', { name: /search media\.example\.com/i }))
    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: 'https://www.google.com/search?q=media.example.com',
    })
  })

  it('renders the image element for image clips', () => {
    render(
      <RenderModelView
        presentation={presentation({
          kind: 'image',
          assetId: 'image-1',
          ocr: { state: 'ready', text: 'hello' },
        })}
      />
    )
    const image = screen.getByRole('img', { name: /clipboard image/i })
    expect(image).toHaveAttribute('src', 'http://clipsx-asset.localhost/image-1')
    fireEvent.error(image)
    expect(screen.getByText('No image source found')).toBeInTheDocument()
  })

  it('derives text statistics only from models that actually contain text', () => {
    expect(renderModelText({ kind: 'table', columns: ['A'], rows: [['one']] })).toBeNull()
    expect(renderModelText({ kind: 'text', text: 'one' })).toBe('one')
  })
})
