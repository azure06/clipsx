export type SemanticStatusState =
  | 'disabled'
  | 'missing_model'
  | 'loading'
  | 'indexing'
  | 'ready'
  | 'error'

export interface SemanticProgress {
  done: number
  total: number
}

export interface SemanticStatus {
  state: SemanticStatusState
  enabled: boolean
  configuredModel: string
  loadedModel: string | null
  message: string
  progress: SemanticProgress | null
}
