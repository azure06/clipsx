export type V2Tag = { id: string; name: string; color: string | null }

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
}

export type RepresentationDetail = {
  id: string
  formatKey: string
  canonicalMimeType: string | null
  nativeType: string | null
  storageKind: 'text' | 'binary_asset' | 'file_list'
  ordinal: number
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
}

export type ClipViewSet = { clipId: string; facets: FacetDescriptor[]; views: ClipViewDescriptor[] }
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
  | { kind: 'image'; artifactId: string }
  | { kind: 'html'; sanitizedHtml: string }
  | { kind: 'error'; message: string }

export type ClipPresentation = ClipSummary & {
  primaryMimeType: string | null
  primaryKind: 'text' | 'image' | 'files' | 'document' | 'binary'
}

export const toClipPresentation = (clip: ClipSummary): ClipPresentation => ({
  ...clip,
  primaryMimeType: null,
  primaryKind: 'text',
})
