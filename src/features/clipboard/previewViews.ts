import type { ClipViewDescriptor } from '../../shared/types/v2'

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
    item.purpose === 'source'
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
export function defaultPreferenceScope(view: ClipViewDescriptor) {
  return view.facetId
    ? ('facet' as const)
    : view.mimeType
      ? ('mime' as const)
      : ('capability' as const)
}
