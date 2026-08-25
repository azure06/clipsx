import { invoke } from '@tauri-apps/api/core'
import { applySupabaseSyncBatch } from '../auth/supabaseAuth'

export type SyncStatus = {
  enabled: boolean
  activeUserId: string | null
  deviceId: string
  deviceName: string
  serverCursor: number
  pendingRecords: number
  quarantinedRecords: number
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  lastError: string | null
}

type SyncBatch = {
  deviceId: string
  deviceName: string
  afterCursor: number
  records: Array<{
    kind: string
    key: string
    payload: unknown
    tombstone: boolean
    revisionPhysicalMs: number
    revisionCounter: number
  }>
}

export const getSyncStatus = () => invoke<SyncStatus>('get_sync_status')

export const setSyncEnabled = (userId: string, enabled: boolean) =>
  invoke<SyncStatus>('set_sync_enabled', { userId, enabled })

export const synchronizeConfiguration = async () => {
  try {
    const batch = await invoke<SyncBatch>('prepare_sync_batch')
    const response = await applySupabaseSyncBatch(batch)
    return await invoke<SyncStatus>('apply_sync_response', { response })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await invoke('record_sync_error', { message }).catch(() => undefined)
    throw error
  }
}

let activeSynchronization: Promise<SyncStatus | null> | null = null

export const synchronizeIfEnabled = (userId: string) => {
  activeSynchronization ??= getSyncStatus()
    .then(status => {
      if (!status.enabled || status.activeUserId !== userId) return null
      return synchronizeConfiguration()
    })
    .finally(() => {
      activeSynchronization = null
    })
  return activeSynchronization
}

export const PROFILE_MUTATED_EVENT = 'clipsx:profile-mutated'
