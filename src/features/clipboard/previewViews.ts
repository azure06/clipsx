import type { ClipViewDescriptor, FacetDescriptor } from '../../shared/types/v2'

export const isInspectionView = (view: ClipViewDescriptor) =>
  view.purpose === 'source' || view.purpose === 'diagnostic'
export const sourceLabel = (view: ClipViewDescriptor) =>
  ({
    'text/html': 'HTML',
    'text/rtf': 'RTF',
    'application/rtf': 'RTF',
    'text/plain': 'Text',
    'image/png': 'PNG',
  })[view.mimeType ?? ''] ??
  view.mimeType ??
  view.capabilityId
export function viewChoiceLabel(
  view: ClipViewDescriptor,
  all: ClipViewDescriptor[],
  labels: Record<string, string>
) {
  const baseLabel = (item: ClipViewDescriptor) =>
    item.capabilityId === 'builtin.ocr'
      ? item.label
      : item.purpose === 'source'
        ? `${sourceLabel(item)} · ${labels['source']}`
        : ((item.rendererId.startsWith('builtin.') ? labels[item.presentationKind] : undefined) ??
          item.label)
  const label = baseLabel(view)
  const similar = all.filter(other => baseLabel(other) === label)
  const sources = [...new Set(similar.map(other => other.sourceId))]
  if (sources.length < 2) return label
  const sameFormat = similar.filter(other => other.mimeType === view.mimeType)
  const sourceNumber =
    new Set(sameFormat.map(other => other.sourceId)).size > 1
      ? ` ${sources.indexOf(view.sourceId) + 1}`
      : ''
  return `${label} (${sourceLabel(view)}${sourceNumber})`
}
export function viewPreferenceTarget(view: ClipViewDescriptor, facets: FacetDescriptor[] = []) {
  if (isInspectionView(view) || view.id.startsWith('__')) return null
  if (view.facetId) {
    const facet = facets.find(
      item => item.id === view.facetId && item.sourceRepresentationId === view.sourceId
    )
    const name = facet?.displayName.trim()
    if (!name || /^(plain\s+|rich\s+)?text$/i.test(name)) return null
    return { scope: 'facet' as const, name }
  }
  const name = {
    'text/html': 'HTML',
    'application/json': 'JSON',
    'text/csv': 'CSV',
    'text/tab-separated-values': 'TSV',
    'text/markdown': 'Markdown',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/svg+xml': 'SVG',
    'application/pdf': 'PDF',
  }[view.mimeType ?? '']
  return name ? { scope: 'mime' as const, name } : null
}
