import { describe, expect, it } from 'vitest'
import type { ClipItem } from '../../shared/types'
import { getOfficeHtmlTab, resolveOfficeContent } from './office'
import {
  clipToContent,
  getContentDisplayAccentType,
  getContentDisplayLabel,
  getContentSourceLabel,
} from './utils'

const createOfficeClip = (overrides: Partial<ClipItem> = {}): ClipItem =>
  ({
    id: '1',
    contentType: 'office',
    detectedType: 'office',
    contentText: 'Name\tQty\nPens\t12',
    contentHtml: null,
    contentRtf: null,
    svgPath: null,
    pdfPath: null,
    imagePath: null,
    attachmentPath: null,
    attachmentType: null,
    filePaths: null,
    metadata: null,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    appName: null,
    isPinned: false,
    isFavorite: false,
    accessCount: 0,
    contentHash: null,
    ...overrides,
  }) as ClipItem

describe('office content resolution', () => {
  it('keeps word html payloads as office content', () => {
    const clip = createOfficeClip({
      contentHtml: '<table><tr><th>Name</th></tr><tr><td>Pens</td></tr></table>',
      appName: 'Microsoft Word',
    })

    const resolved = resolveOfficeContent(clip, {
      office_app: 'word',
      office_kind: 'document',
      table_source: 'html',
      source_app: 'Microsoft Office',
    })

    expect(resolved.type).toBe('office')
    expect(resolved.metadata.source_app).toBe('Microsoft Office')
    expect(getContentSourceLabel({ ...resolved, clip })).toBe('Microsoft Word')

    const htmlTab = getOfficeHtmlTab(resolved.metadata, clip.contentHtml)
    expect(htmlTab.label).toBe('Formatted')
    expect(htmlTab.preferHtml).toBe(false)
  })

  it('uses metadata-driven html spreadsheets as csv content', () => {
    const clip = createOfficeClip({
      contentHtml:
        '<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Pens</td><td>12</td></tr></table>',
      contentText: 'Name\tQty\nPens\t12',
      appName: 'Microsoft Excel',
    })

    const resolved = resolveOfficeContent(clip, {
      office_app: 'excel',
      office_kind: 'spreadsheet',
      table_source: 'html',
      source_app: 'Microsoft Office',
    })

    expect(resolved.type).toBe('csv')
    expect(resolved.text).toBe('Name\tQty\nPens\t12')
    expect(resolved.metadata.delimiter).toBe('\t')

    const htmlTab = getOfficeHtmlTab(resolved.metadata, clip.contentHtml)
    expect(htmlTab.label).toBe('Table')
    expect(htmlTab.preferHtml).toBe(true)
  })

  it('does not re-detect plain office text as csv without backend table metadata', () => {
    const clip = createOfficeClip({
      contentText: 'Name\tQty\nPens\t12',
      appName: 'Microsoft Office',
    })

    const resolved = resolveOfficeContent(clip, {
      office_app: 'office',
      office_kind: 'document',
      source_app: 'Microsoft Office',
    })

    expect(resolved.type).toBe('office')
  })

  it('prefers stored source_app over active app name for office provenance', () => {
    const clip = createOfficeClip({
      appName: 'Finder',
    })

    const resolved = resolveOfficeContent(clip, {
      office_app: 'word',
      office_kind: 'document',
      source_app: 'Microsoft Word',
    })

    expect(resolved.metadata.source_app).toBe('Microsoft Word')
    expect(getContentSourceLabel({ ...resolved, clip })).toBe('Microsoft Word')
  })

  it('uses office kind for display label and accent when not promoted to csv', () => {
    const clip = createOfficeClip({
      contentText: 'Quarterly summary',
      metadata: JSON.stringify({
        office_app: 'excel',
        office_kind: 'spreadsheet',
        table_source: 'plain_text',
        source_app: 'Microsoft Excel',
      }),
    })

    const content = clipToContent(clip)

    expect(content.type).toBe('office')
    expect(getContentDisplayLabel(content)).toBe('spreadsheet')
    expect(getContentDisplayAccentType(content)).toBe('csv')
  })
})
