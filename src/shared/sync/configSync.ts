import { invoke } from '@tauri-apps/api/core'
import {
  applySupabaseSyncBatch,
  enrollSyncDevice,
  resetSyncProfile,
  replaceSyncProfile,
} from '../auth/supabaseAuth'
import type { Json } from '../auth/database.types'

export type SyncStatus = {
  enabled: boolean
  activeUserId: string | null
  deviceId: string
  deviceName: string
  generation: number
  localEpoch: number
  serverCursor: number
  pendingRecords: number
  quarantinedRecords: number
  pendingEffects: number
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  lastError: string | null
}
type SyncBatch = {
  protocolVersion: number
  userId: string
  generation: number
  localEpoch: number
  deviceId: string
  afterCursor: number
  records: Json[]
}
export const PROFILE_MUTATED_EVENT = 'clipsx:profile-mutated'
export const SYNC_APPLIED_EVENT = 'clipsx:sync-applied'
export const getSyncStatus = () => invoke<SyncStatus>('get_sync_status')
export const setSyncEnabled = (userId: string, enabled: boolean) =>
  invoke<SyncStatus>('set_sync_enabled', { userId, enabled })
const object = (value: Json): Record<string, Json | undefined> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid sync response')
  return value
}
export const connectConfigurationSync = async (userId: string, replaceCloud = false) => {
  const before = await getSyncStatus()
  if (before.activeUserId) await setSyncEnabled(before.activeUserId, false)
  if (active) await active.catch(() => undefined)
  const local = await getSyncStatus()
  const enrollment = object(await enrollSyncDevice(local.deviceId, local.deviceName))
  if (
    typeof enrollment['deviceId'] !== 'string' ||
    !Number.isSafeInteger(enrollment['generation']) ||
    typeof enrollment['serverTimeMs'] !== 'number'
  )
    throw new Error('Invalid enrollment')
  let generation = enrollment['generation'] as number
  if (replaceCloud || enrollment['initialized'] === false) {
    const records = await invoke<Json[]>('snapshot_configuration_sync')
    generation = await replaceSyncProfile(generation, enrollment['deviceId'], records, replaceCloud)
  }
  await invoke<SyncStatus>('begin_configuration_sync', {
    userId,
    deviceId: enrollment['deviceId'],
    generation,
    serverTimeMs: enrollment['serverTimeMs'],
    upload: false,
  })
  return synchronizeConfiguration()
}
export const clearCloudConfiguration = async () => {
  const status = await getSyncStatus()
  if (!status.activeUserId) throw new Error('Sign in before clearing cloud settings')
  await setSyncEnabled(status.activeUserId, false)
  await resetSyncProfile(status.generation)
  return getSyncStatus()
}
let active: Promise<SyncStatus> | null = null
let failures = 0
let retryAt = 0
export const synchronizeConfiguration = (): Promise<SyncStatus> => {
  active ??= run().finally(() => {
    active = null
  })
  return active
}
async function run(): Promise<SyncStatus> {
  let context: SyncBatch | null = null
  try {
    // Bounded drain; the next scheduled run continues a larger backlog.
    for (let page = 0; page < 100; page++) {
      const batch = await invoke<SyncBatch>('prepare_sync_batch')
      context = batch
      const response = object(await applySupabaseSyncBatch(batch))
      const current = await getSyncStatus()
      if (
        !current.enabled ||
        current.activeUserId !== batch.userId ||
        current.localEpoch !== batch.localEpoch
      )
        return current
      if (response['error'] === 'generation_changed') {
        await setSyncEnabled(batch.userId, false)
        throw new Error(
          'Cloud settings were reset or replaced. Choose how to reconnect this device.'
        )
      }
      const status = await invoke<SyncStatus>('apply_sync_response', {
        response: { ...response, localEpoch: batch.localEpoch },
      })
      window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
      if (response['hasMore'] !== true && status.pendingRecords === 0) {
        failures = 0
        retryAt = 0
        return status
      }
    }
    return getSyncStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configuration sync failed'
    const current = await getSyncStatus()
    if (
      context &&
      current.activeUserId === context.userId &&
      current.localEpoch === context.localEpoch
    ) {
      if (/sync_device_revoked|sync_session_required/.test(message))
        await setSyncEnabled(context.userId, false)
      // Only sanitized protocol/network errors are retained; never request bodies.
      await invoke('record_sync_error', { message: message.slice(0, 512) }).catch(() => undefined)
    }
    failures++
    retryAt =
      Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)) * (0.5 + Math.random())
    throw error
  }
}
export const synchronizeIfEnabled = async (userId: string) => {
  const status = await getSyncStatus()
  if (!status.enabled || status.activeUserId !== userId || Date.now() < retryAt) return null
  return synchronizeConfiguration()
}
