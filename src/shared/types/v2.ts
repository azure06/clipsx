export type V2Tag = { id: string; name: string; color: string | null }

export type TextEmbeddingStatus = {
  enabled: boolean
  activeSpaceId: string | null
  pendingSpaceId: string | null
  diagnostic: string | null
  indexedClips: number
  pendingJobs: number
}

export type ClipSummary = {
  id: string
  sourceAppName: string | null
  sourceAppId: string | null
  capturedAt: number
  updatedAt: number
  isPinned: boolean
  isFavorite: boolean
  note: string | null
  tags: V2Tag[]
  safeSummary: string
  representationCount: number
  primaryPresentationKind: string
  thumbnailAssetId: string | null
  /** Set when this summary comes from a search result; carries the fused ranking score (0–1). */
  similarityScore?: number
}

export type RepresentationDetail = {
  id: string
  formatKey: string
  canonicalMimeType: string | null
  nativeType: string | null
  storageKind: 'text' | 'binary_asset' | 'file_list'
  ordinal: number
  capturePriority: number
  byteLength: number
  textValue: string | null
  fileReferences: string[]
  binaryFileId: string | null
  sha256: string | null
}

export type ClipDetail = { clip: ClipSummary; representations: RepresentationDetail[] }

export type ClipViewDescriptor = {
  id: string
  rendererId: string
  label: string
  sourceId: string
  mimeType: string | null
  facetId: string | null
  isOriginal: boolean
  presentationKind: string
  placement: 'primary' | 'alternate' | 'advanced'
}

export type ClipViewSet = {
  clipId: string
  primaryViewId: string
  presentationKind: string
  facets: FacetDescriptor[]
  views: ClipViewDescriptor[]
}
export type FacetDescriptor = {
  id: string
  displayName: string
  sourceRepresentationId: string
  detectorId: string
  detectorVersion: string
  payload: unknown
}

export type RenderModel =
  | { kind: 'text'; text: string }
  | { kind: 'code'; language: string | null; text: string }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'tree'; value: unknown }
  | { kind: 'key_value'; entries: [string, string][] }
  | { kind: 'image'; assetId: string; ocr: OcrPresentation }
  | { kind: 'html'; sanitizedHtml: string }
  | { kind: 'rich_text'; sanitizedHtml: string | null; plainText: string }
  | { kind: 'files'; entries: FilePresentation[] }
  | { kind: 'document'; assetId: string; mimeType: string }
  | { kind: 'office'; formatKey: string; nativeType: string | null; byteLength: number }
  | { kind: 'semantic'; facetId: string; text: string; payload: Record<string, unknown> }
  | {
      kind: 'unsupported'
      formatKey: string
      mimeType: string | null
      nativeType: string | null
      byteLength: number
    }
  | { kind: 'error'; message: string }

export type OcrPresentation =
  | { state: 'disabled' }
  | { state: 'pending' }
  | { state: 'running' }
  | { state: 'ready'; text: string }
  | { state: 'unsupported' }
  | { state: 'failed'; message: string }

export type FilePresentation = { path: string; name: string }

export type ClipPresentation = ClipSummary & {
  activeView: ClipViewDescriptor
  model: RenderModel
}
