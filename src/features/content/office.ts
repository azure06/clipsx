import type { ClipItem } from '../../shared/types'
import type { Content, ContentMetadata } from './types'

type HtmlTable = {
  text: string
  rows: number
  columns: number
  delimiter: '\t'
}

type OfficeHtmlTab = {
  isAvailable: boolean
  label: 'Table' | 'Formatted'
  preferHtml: boolean
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
      Array.from(row.querySelectorAll('th, td')).map(
        cell => cell.textContent?.replace(/\s+/g, ' ').trim() ?? ''
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

export const resolveOfficeContent = (
  clip: ClipItem,
  baseMetadata: ContentMetadata
): Pick<Content, 'type' | 'text' | 'metadata'> => {
  const sourceApp = baseMetadata.source_app ?? clip.appName ?? undefined
  const metadata: ContentMetadata = {
    ...baseMetadata,
    svg: clip.svgPath ?? undefined,
    pdf: clip.pdfPath ?? undefined,
    attachment_path: clip.attachmentPath ?? undefined,
    source_app: sourceApp,
    office_app: baseMetadata.office_app,
    office_kind: baseMetadata.office_kind,
  }

  if (metadata.office_kind !== 'spreadsheet') {
    return {
      type: 'office',
      text: clip.contentText || '',
      metadata,
    }
  }

  const tableSource = metadata.table_source
  const htmlTable =
    tableSource === 'html' && clip.contentHtml ? extractTableFromHtml(clip.contentHtml) : null
  const hasStructuredTable = tableSource === 'csv_text' || (tableSource === 'html' && !!htmlTable)

  if (!hasStructuredTable) {
    return {
      type: 'office',
      text: clip.contentText || '',
      metadata,
    }
  }

  return {
    type: 'csv',
    text: htmlTable ? htmlTable.text : clip.contentText || '',
    metadata: {
      ...metadata,
      delimiter: metadata.delimiter ?? htmlTable?.delimiter,
      rows: metadata.rows ?? htmlTable?.rows,
      columns: metadata.columns ?? htmlTable?.columns,
    },
  }
}

export const getOfficeHtmlTab = (
  metadata: ContentMetadata,
  htmlContent?: string | null
): OfficeHtmlTab => {
  if (!htmlContent) {
    return {
      isAvailable: false,
      label: 'Formatted',
      preferHtml: false,
    }
  }

  const isSpreadsheetTable =
    metadata.office_kind === 'spreadsheet' &&
    metadata.table_source === 'html' &&
    !!extractTableFromHtml(htmlContent)

  return {
    isAvailable: true,
    label: isSpreadsheetTable ? 'Table' : 'Formatted',
    preferHtml: isSpreadsheetTable,
  }
}
