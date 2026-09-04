export type V2Tag = { id: string; name: string; color: string | null }

export type ClipboardOutputSource =
  | { kind: 'original'; clipId: string }
  | { kind: 'plain_text'; clipId: string }
  | { kind: 'transformed'; resultId: string }
  | { kind: 'literal_text'; text: string; sourceClipId?: string }

export type ClipboardOutputRequest = {
  disposition: 'copy' | 'paste'
  source: ClipboardOutputSource
}

export type TextEmbeddingStatus = {
  enabled: boolean
  phase:
    | 'not_configured'
    | 'checking'
    | 'validating_model'
    | 'indexing'
    | 'ready'
    | 'degraded'
    | 'disabled'
  activeSpaceId: string | null
  pendingSpaceId: string | null
  diagnostic: string | null
  indexedClips: number
  pendingJobs: number
  failedJobs: number
  eligibleClips: number
  dimensions: number | null
  indexBytes: number
  estimatedRebuildBytes: number
  model: string | null
  minimumSimilarityPercent: number | null
}

export type FailedTextEmbeddingJob = {
  clip: ClipSummary
  attemptCount: number
  lastError: string | null
  updatedAt: number
}

export type SearchSourceDescriptor = {
  id: string
  label: string
  mandatory: boolean
  inputKinds: string[]
  indexingRequired: boolean
  enabled: boolean
  state: 'ready' | 'indexing' | 'degraded' | 'disabled' | 'not_configured'
  diagnostic: string | null
}

export type SearchMatch = { sourceId: string; sourceRank: number; sourceScore?: number }
export type SearchSourceOutcome = {
  sourceId: string
  status: 'used' | 'unavailable' | 'failed'
  diagnostic: string | null
}
export type RecallResult = { answer: string; includedCount: number; excludedCount: number }

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
  historyPreview: HistoryPreview
  representationCount: number
  primaryPresentationKind: string
  thumbnailAssetId: string | null
  hasPlainText: boolean
  shareable: boolean
  hasEmbedding?: boolean
  ocrStatus?: string | null
  /** Set when this summary comes from a search result; carries the fused ranking score (0–1). */
  similarityScore?: number
  searchMatches?: SearchMatch[]
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
  capabilityId: string
  formatFamily: string
}

export type FormatObservation = {
  ordinal: number
  platform: 'windows' | 'macos' | 'linux_x11'
  nativeIdentifier: string
  numericId: number | null
  medium: string | null
  byteLength: number | null
  capabilityId: string | null
  policyVersion: number
  decision: 'captured' | 'disabled' | 'unsupported' | 'redundant' | 'unreadable' | 'too_large'
  reason: string
}

export type ClipDetail = {
  clip: ClipSummary
  representations: RepresentationDetail[]
  formatObservations: FormatObservation[]
}

export type ClipViewDescriptor = {
  id: string
  rendererId: string
  label: string
  sourceId: string
  mimeType: string | null
  capabilityId: string
  facetId: string | null
  iconSvg: string | null
  iconSvgDark: string | null
  iconScale: number
  isOriginal: boolean
  presentationKind: string
  purpose: 'faithful' | 'structured' | 'semantic' | 'source' | 'diagnostic'
  matchSpecificity: number
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
  | {
      kind: 'image'
      source:
        | { kind: 'managed'; assetId: string }
        | { kind: 'transform_result'; resultId: string; outputIndex: number }
      ocr: OcrPresentation
    }
  | { kind: 'html'; sanitizedHtml: string }
  | { kind: 'rich_text'; sanitizedHtml: string | null; plainText: string }
  | { kind: 'files'; entries: FilePresentation[] }
  | { kind: 'document'; assetId: string; mimeType: string }
  | { kind: 'semantic'; facetId: string; text: string; payload: Record<string, unknown> }
  | {
      kind: 'unsupported'
      formatKey: string
      mimeType: string | null
      nativeType: string | null
      byteLength: number
    }
  | { kind: 'error'; message: string }

export type LeadingVisual =
  | { kind: 'none' }
  | { kind: 'host_icon'; name: string }
  | { kind: 'package_icon'; light: string; dark: string | null; scalePercent: number }
  | { kind: 'swatch'; red: number; green: number; blue: number; alpha: number }
  | { kind: 'input_thumbnail' }
  | { kind: 'monogram'; text: string }

export type HistoryPreview = {
  leading: LeadingVisual
  title: string
  subtitle: string | null
  badge: string | null
  accessibilityLabel: string
}

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
