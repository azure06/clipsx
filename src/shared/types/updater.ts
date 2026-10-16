export type UpdaterStatus =
  | 'idle'
  | 'unavailable'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type ReleaseInfo = {
  readonly updaterConfigured: boolean
  readonly version: string
  readonly commit: string | null
  readonly modified: boolean | null
  readonly os: string
  readonly architecture: string
  readonly buildType: 'development' | 'release'
}

export type AvailableUpdate = {
  readonly currentVersion: string
  readonly version: string
  readonly date: string | null
  readonly body: string | null
}
