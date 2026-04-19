import type { ClipItem } from '../../shared/types'
import type { Content, ContentMetadata, ContentType } from './types'

type DelimitedTable = {
  delimiter: string
  rows: number
  columns: number
}

type HtmlTable = {
  text: string
  rows: number
  columns: number
  delimiter: '\t'
}

// Parse backend metadata JSON string
export const parseMetadata = (metadataJson?: string | null): ContentMetadata => {
  if (!metadataJson) return {}

  try {
    return JSON.parse(metadataJson) as ContentMetadata
  } catch {
    return {}
  }
}

export const detectDelimitedText = (text: string): DelimitedTable | null => {
  const lines = text.split(/\r?\n/).filter((line, index, allLines) => {
    if (index === allLines.length - 1 && line.trim() === '') {
      return false
    }
    return true
  })

  if (lines.length < 2) return null

  for (const delimiter of [',', ';', '\t', '|']) {
    const columnCounts = lines.map(line => line.split(delimiter).length)
    if (columnCounts.some(count => count < 2)) continue

    const [firstColumnCount] = columnCounts
    if (!firstColumnCount) continue

    if (columnCounts.every(count => count === firstColumnCount)) {
      return {
        delimiter,
        rows: lines.length,
        columns: firstColumnCount,
      }
    }
  }

  return null
}

export const extractTableFromHtml = (html: string): HtmlTable | null => {
  if (typeof DOMParser === 'undefined') return null

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null

  const rowElements = Array.from(table.querySelectorAll('tr'))
  if (rowElements.length === 0) return null

  const rows = rowElements
    .map(row =>
      Array.from(row.querySelectorAll('th, td')).map(cell =>
        cell.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      )
    )
    .filter(cells => cells.length > 0)

  if (rows.length === 0) return null

  const columns = Math.max(...rows.map(cells => cells.length))
  if (columns === 0) return null

  return {
    text: rows.map(cells => cells.join('\t')).join('\n'),
    rows: rows.length,
    columns,
    delimiter: '\t',
  }
}

const resolveOfficeContent = (
  clip: ClipItem,
  baseMetadata: ContentMetadata
): Pick<Content, 'type' | 'text' | 'metadata'> => {
  const htmlTable = clip.contentHtml ? extractTableFromHtml(clip.contentHtml) : null
  const textTable = clip.contentText ? detectDelimitedText(clip.contentText) : null
  const hasRenderableTable = Boolean(htmlTable || textTable)
  const sourceApp = clip.appName ?? baseMetadata.source_app
  const officeKind = baseMetadata.office_kind

  const metadata: ContentMetadata = {
    ...baseMetadata,
    svg: clip.svgPath ?? undefined,
    pdf: clip.pdfPath ?? undefined,
    attachment_path: clip.attachmentPath ?? undefined,
    source_app: sourceApp,
    office_kind: officeKind,
  }

  if (officeKind === 'spreadsheet' && hasRenderableTable) {
    const fallbackTable = htmlTable && !textTable ? htmlTable : null
    const activeTable = textTable ?? fallbackTable
    const tableSource =
      metadata.table_source ??
      (htmlTable ? 'html' : textTable ? 'csv_text' : clip.contentText?.trim() ? 'plain_text' : undefined)

    const text = fallbackTable ? fallbackTable.text : clip.contentText || ''

    return {
      type: 'csv',
      text,
      metadata: {
        ...metadata,
        table_source: tableSource,
        delimiter: metadata.delimiter ?? activeTable?.delimiter,
        rows: metadata.rows ?? activeTable?.rows,
        columns: metadata.columns ?? activeTable?.columns,
      },
    }
  }

  return {
    type: 'office',
    text: clip.contentText || '',
    metadata,
  }
}

// Get content type from clip
export const getContentType = (clip: ClipItem): ContentType => {
  if (clip.contentType === 'office') {
    return resolveOfficeContent(clip, parseMetadata(clip.metadata)).type
  }
  if (clip.contentType === 'image') return 'image'
  if (clip.contentType === 'files') return 'files'

  const detected = clip.detectedType?.toLowerCase() || 'text'
  return detected as ContentType
}

// Convert ClipItem to unified Content
export const clipToContent = (clip: ClipItem): Content => {
  const baseMetadata = parseMetadata(clip.metadata)
  const resolvedOfficeContent =
    clip.contentType === 'office' ? resolveOfficeContent(clip, baseMetadata) : null

  const metadata: ContentMetadata = resolvedOfficeContent?.metadata ?? baseMetadata
  const text = resolvedOfficeContent?.text ?? (clip.contentText || '')
  const type = resolvedOfficeContent?.type ?? getContentType(clip)

  return {
    type,
    text,
    metadata,
    clip,
  }
}

// Get type color for UI
export const getTypeColor = (type: ContentType): string => {
  const colors: Record<ContentType, string> = {
    text: 'bg-slate-500',
    url: 'bg-blue-500',
    email: 'bg-amber-500',
    color: 'bg-purple-500',
    code: 'bg-green-500',
    json: 'bg-emerald-500',
    csv: 'bg-lime-500',
    jwt: 'bg-violet-500',
    timestamp: 'bg-cyan-500',
    secret: 'bg-red-500',
    path: 'bg-indigo-500',
    image: 'bg-pink-500',
    files: 'bg-blue-600',
    office: 'bg-blue-400',
    math: 'bg-orange-500',
    phone: 'bg-teal-500',
    date: 'bg-rose-500',
  }
  return colors[type] || colors.text
}

// Get type icon (emoji fallback, can be replaced with lucide icons)
export const getTypeIcon = (type: ContentType): string => {
  const icons: Record<ContentType, string> = {
    text: '📄',
    url: '🔗',
    email: '✉️',
    color: '🎨',
    code: '⚡',
    json: '{ }',
    csv: '📊',
    jwt: '🔑',
    timestamp: '⏰',
    secret: '🔒',
    path: '📁',
    image: '🖼️',
    files: '📦',
    office: '📊',
    math: '🧮',
    phone: '📞',
    date: '📅',
  }
  return icons[type] || icons.text
}
