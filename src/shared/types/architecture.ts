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
