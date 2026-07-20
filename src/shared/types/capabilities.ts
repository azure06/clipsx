export type AiCapabilityKind = 'text_search' | 'image_search'

export type AiCapabilityDeliveryMode = 'self_managed' | 'cache_managed'

export type AiCapabilityInstallState = 'not_downloaded' | 'downloading' | 'ready' | 'error'

export type AiCapabilityRuntimeState = 'idle' | 'loading' | 'ready' | 'error'

export interface AiCapabilityStatus {
  kind: AiCapabilityKind
  displayName: string
  deliveryMode: AiCapabilityDeliveryMode
  installState: AiCapabilityInstallState
  runtimeState: AiCapabilityRuntimeState
  installedAt: number | null
  lastError: string | null
  sizeBytes: number
}

// ── Text search status (drives the search bar toggle) ────────────────────────

export type TextSearchState =
  | 'disabled'
  | 'missing_model'
  | 'idle'
  | 'loading'
  | 'indexing'
  | 'ready'
  | 'error'

export interface TextSearchProgress {
  done: number
  total: number
}

export interface TextSearchStatus {
  state: TextSearchState
  enabled: boolean
  message: string
  progress: TextSearchProgress | null
}

// ── Normalized capability progress event ─────────────────────────────────────

export interface AiCapabilityProgressEvent {
  capability: string
  label: string
  downloaded: number
  total: number
  phase: string
}

// ── Index progress event ──────────────────────────────────────────────────────

export interface IndexingProgressEvent {
  done: number
  total: number
}
