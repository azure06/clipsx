import type { ClipSummary } from '../../shared/types/v2'
import type { Content, ContentType } from '../content'

const contentType = (kind: string): ContentType => {
  if (kind === 'image' || kind === 'files' || kind === 'office') return kind
  return 'text'
}

export const summaryToContent = (clip: ClipSummary): Content => ({
  type: contentType(clip.primaryPresentationKind),
  text: clip.safeSummary,
  metadata: {},
  clip: {
    id: clip.id,
    isFavorite: clip.isFavorite,
    isPinned: clip.isPinned,
    imagePath: clip.thumbnailAssetId ? `clipsx-asset://localhost/${clip.thumbnailAssetId}` : null,
    appName: clip.sourceAppName,
  },
})
