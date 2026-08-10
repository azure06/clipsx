export type StartupState = 'architecture_cutover' | 'legacy_reset_required' | 'unsupported_schema'

export type StartupStatus = { state: StartupState; message: string; resetAvailable: boolean }
export type FactoryResetResult = { deleted: string[]; failures: string[]; restartRequired: boolean }
export type StorageKind = 'text' | 'binary_asset' | 'file_list'
export type LifecycleState =
  | 'pending'
  | 'ready'
  | 'failed'
  | 'missing'
  | 'quarantined'
  | 'unsupported'
  | 'invalidated'
export type RepresentationContract = {
  id: string
  clipId: string
  formatKey: string
  canonicalMimeType?: string
  nativeType?: string
  platform: 'macos' | 'windows' | 'linux_x11'
  storageKind: StorageKind
  ordinal: number
  capturePriority: number
  lifecycleState: LifecycleState
}
export type Tag = { id: string; name: string; color?: string }
export type ClipSummary = {
  id: string
  sourceAppName?: string
  sourceAppId?: string
  capturedAt: number
  updatedAt: number
  isPinned: boolean
  isFavorite: boolean
  note?: string
  tags: Tag[]
  safeSummary: string
  representationCount: number
}
export type ClipPage = { items: ClipSummary[]; nextCursor?: string }
export type RepresentationDetail = {
  id: string
  formatKey: string
  canonicalMimeType?: string
  nativeType?: string
  storageKind: StorageKind
  ordinal: number
  byteLength: number
  textValue?: string
  fileReferences: string[]
  binaryFileId?: string
  sha256?: string
}
export type ClipDetail = { clip: ClipSummary; representations: RepresentationDetail[] }
export type CaptureSettings = {
  maxOrdinaryClips?: number
  maxAgeDays?: number
  maxManagedBytes?: number
  maxRepresentationBytes?: number
  maxSnapshotBytes?: number
  managedBytesUsed: number
  retentionWarning?: string
}
export type FacetDescriptor = {
  id: string
  displayName: string
  sourceRepresentationId: string
  detectorId: string
  detectorVersion: string
  payload: unknown
}
export type ClipViewDescriptor = {
  id: string
  rendererId: string
  label: string
  sourceId: string
  mimeType?: string
  facetId?: string
  isOriginal: boolean
}
export type ClipViewSet = { clipId: string; facets: FacetDescriptor[]; views: ClipViewDescriptor[] }
export type RendererPreferences = {
  byMimeType: Record<string, string>
  byFacetId: Record<string, string>
}
export type RenderModel =
  | { kind: 'text'; text: string }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'tree'; value: unknown }
  | { kind: 'key_value'; entries: [string, string][] }
  | { kind: 'image'; artifactId: string }
  | { kind: 'html'; sanitizedHtml: string }
  | { kind: 'error'; message: string }
export type TransformerDescriptor = {
  id: string
  version: string
  label: string
  parameterSchema: unknown
  inputLimitBytes: number
  timeoutMs: number
}
export type TransformOutputDescriptor = { canonicalMimeType?: string; byteLength: number }
export type TransformPreview = {
  resultId: string
  expiresAt: number
  transformerId: string
  transformerVersion: string
  sourceId: string
  outputs: TransformOutputDescriptor[]
  model: RenderModel
}
export type OutputPolicy =
  | { kind: 'original'; clipId: string }
  | { kind: 'plain_text'; clipId: string }
  | { kind: 'transformed'; resultId: string }
export type TransformPreferences = { favoriteTransformerIds: string[] }

export type SyntaxMode = 'simple' | 'advanced'
export type SearchSettings = { syntaxMode: SyntaxMode }

export type SearchRequest = {
  query: string
  scope?: string
  tagId?: string
  limit?: number
  cursor?: string
}

export type SearchResult = {
  clip: ClipSummary
  snippet?: string
  rank: number
}

export type SearchPage = {
  items: SearchResult[]
  total: number
  nextCursor?: string
}
