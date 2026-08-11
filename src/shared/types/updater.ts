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
}

export type AvailableUpdate = {
  readonly currentVersion: string
  readonly version: string
  readonly date: string | null
  readonly body: string | null
}
