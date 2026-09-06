import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '../../../shared/components/ui'
import { listSyncDevices, revokeSyncDevice } from '../../../shared/auth/supabaseAuth'
import {
  clearCloudConfiguration,
  connectConfigurationSync,
  getSyncStatus,
  setSyncEnabled,
  synchronizeConfiguration,
  SYNC_APPLIED_EVENT,
  type SyncStatus,
} from '../../../shared/sync/configSync'
import { useSettingsStore } from '../../../stores'

type Device = {
  deviceId: string
  displayName: string
  lastSeenAt: string
  revokedAt: string | null
  current: boolean
}
type Recovery = { id: string; key: string; reason: string; quarantined: boolean }

export function ConfigurationSync({ userId }: { userId: string | null }) {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [recovery, setRecovery] = useState<Recovery[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'replace' | 'reset' | null>(null)
  const refresh = useCallback(async () => {
    const state = await getSyncStatus()
    setStatus(state)
    if (state.activeUserId !== userId) {
      setDevices([])
      setRecovery([])
      return
    }
    setRecovery(await invoke<Recovery[]>('sync_recovery', { action: 'list', id: null }))
    if (state.enabled) {
      const data = await listSyncDevices()
      if (Array.isArray(data)) setDevices(data as Device[])
    }
  }, [userId])
  useEffect(() => {
    let cancelled = false
    const reload = () => {
      if (!cancelled) void refresh().catch(() => undefined)
    }
    reload()
    window.addEventListener(SYNC_APPLIED_EVENT, reload)
    return () => {
      cancelled = true
      window.removeEventListener(SYNC_APPLIED_EVENT, reload)
    }
  }, [refresh])
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await operation()
      await useSettingsStore.getState().loadSettings()
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }
  const enabled = status?.enabled && status.activeUserId === userId
  return (
    <section
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
      aria-label="Configuration sync"
    >
      <h2 className="text-lg font-semibold">Configuration sync</h2>
      <p className="text-sm text-slate-500">
        {userId
          ? enabled
            ? 'Sync enabled'
            : 'Sync paused. Choose how this device joins your cloud profile.'
          : 'Sign in from Account to sync configuration.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button disabled={busy} onClick={() => void run(synchronizeConfiguration)}>
              Sync now
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => setSyncEnabled(userId!, false))}
            >
              Pause
            </Button>
          </>
        ) : (
          <Button
            disabled={busy || !userId}
            onClick={() => void run(() => connectConfigurationSync(userId!))}
          >
            Use cloud settings
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy || !userId}
          onClick={() => setConfirm('replace')}
        >
          Replace cloud with this device
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !userId || status?.activeUserId !== userId || !status?.generation}
          onClick={() => setConfirm('reset')}
        >
          Clear cloud settings
        </Button>
      </div>
      {confirm && (
        <div role="alert" className="space-y-2 rounded border border-amber-400 p-3 text-sm">
          <p>
            {confirm === 'replace'
              ? 'Replace the entire cloud configuration with this device’s supported settings? Other devices will pause and ask how to reconnect.'
              : 'Clear cloud configuration and pause synchronization? Local settings and clipboard content remain on every device.'}
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                confirm === 'replace'
                  ? () => connectConfigurationSync(userId!, true)
                  : clearCloudConfiguration
              )
            }
          >
            Confirm {confirm === 'replace' ? 'replacement' : 'clear'}
          </Button>{' '}
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      )}
      {(error || status?.lastError) && (
        <p role="alert" className="text-sm text-red-600">
          {error || status?.lastError}
        </p>
      )}
      <p aria-live="polite" className="text-sm">
        {busy
          ? 'Synchronizing…'
          : `${status?.pendingRecords ?? 0} pending uploads · ${status?.quarantinedRecords ?? 0} quarantined · ${status?.pendingEffects ?? 0} awaiting application`}
      </p>
      <p className="text-xs text-slate-500">
        Last success:{' '}
        {status?.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : 'Never'}. An
        empty cloud profile starts with this device’s supported settings.
      </p>
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Included</h3>
          <p>
            Theme, language, output format, copy toast, search and OCR preferences, renderer
            choices, signed-extension intent and approved portable settings, and app-command
            shortcuts.
          </p>
        </div>
        <div>
          <h3 className="font-semibold">Always local</h3>
          <p>
            Clips, notes, tags, files, credentials, permission grants, provider endpoints/models,
            capture settings, window behavior/layout, autostart, global activation shortcut, update
            policy, caches and diagnostics.
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Settings are protected by your account, not end-to-end encrypted. Restored extensions
        require fresh consent for external capabilities.
      </p>
      <h3 className="font-semibold">Devices</h3>
      <ul className="space-y-2">
        {devices.map(device => (
          <li key={device.deviceId} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {device.displayName}
              {device.current ? ' (this session)' : ''} ·{' '}
              {device.revokedAt
                ? 'Revoked'
                : `Seen ${new Date(device.lastSeenAt).toLocaleString()}`}
            </span>
            {!device.revokedAt && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await revokeSyncDevice(device.deviceId)
                    if (device.current && userId) await setSyncEnabled(userId, false)
                  })
                }
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      {recovery.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Recovery</h3>
          <Button
            variant="secondary"
            disabled={busy || !enabled}
            onClick={() =>
              void run(() => invoke('sync_recovery', { action: 'retry_effects', id: null }))
            }
          >
            Retry pending packages and commands
          </Button>
          <ul className="space-y-2">
            {recovery.map(item => (
              <li key={item.id} className="rounded border p-3 text-sm">
                <p>
                  {item.key}: {item.reason}
                </p>
                {item.quarantined && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      disabled={busy || !enabled}
                      onClick={() =>
                        void run(() => invoke('sync_recovery', { action: 'retry', id: item.id }))
                      }
                    >
                      Retry
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(() => invoke('sync_recovery', { action: 'discard', id: item.id }))
                      }
                    >
                      Discard record
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
