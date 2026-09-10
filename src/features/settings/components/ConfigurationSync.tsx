import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '../../../shared/components/ui'
import { listSyncDevices, revokeSyncDevice } from '../../../shared/auth/supabaseAuth'
import {
  clearCloudConfiguration,
  configurationSyncScheduler,
  connectConfigurationSync,
  getSyncStatus,
  setSyncEnabled,
  SYNC_APPLIED_EVENT,
  type SyncStatus,
} from '../../../shared/sync/configSync'
import { useSettingsStore } from '../../../stores'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Cloud,
  Monitor,
  Pause,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react'
import { SettingsSection } from './SettingsPrimitives'

type Device = {
  deviceId: string
  displayName: string
  lastSeenAt: string
  revokedAt: string | null
  current: boolean
}
type Recovery = { id: string; key: string; reason: string; quarantined: boolean }

export function ConfigurationSync({
  userId,
  onOpenAccount,
}: {
  userId: string | null
  onOpenAccount: () => void
}) {
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
  const accountStatus = userId && status?.activeUserId === userId ? status : null
  const enabled = accountStatus?.enabled
  const syncError = error || accountStatus?.lastError
  const attention = Boolean(
    syncError || accountStatus?.quarantinedRecords || accountStatus?.pendingEffects
  )
  const statusLabel = busy
    ? 'Updating…'
    : !userId
      ? 'Not connected'
      : !status
        ? 'Status unavailable'
        : attention
          ? 'Needs attention'
          : enabled
            ? 'Sync enabled'
            : 'Sync paused'
  return (
    <section
      className="@container space-y-5 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-violet-500"
      aria-label="Configuration sync"
    >
      <div className="overflow-hidden rounded-xl border border-violet-200/70 bg-linear-to-br from-violet-500/[0.08] via-white/35 to-fuchsia-500/[0.04] shadow-[0_6px_18px_rgba(15,23,42,0.04)] dark:border-violet-400/20 dark:via-white/[0.025]">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-300">
              <Cloud className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Your setup, on every device
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Sync your preferences. Keep your clipboard local.
              </p>
            </div>
          </div>
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${attention ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/10 text-slate-600 dark:text-slate-400'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-5">
          <p className="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {!userId
              ? 'Sign in to bring your ClipsX setup to your other devices.'
              : enabled
                ? accountStatus?.lastSuccessAt
                  ? `Last synced ${new Date(accountStatus.lastSuccessAt).toLocaleString()}`
                  : 'Ready for your first sync.'
                : 'Use your saved cloud settings to connect this device. A new cloud profile starts with your current setup.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {!userId ? (
              <Button
                size="sm"
                rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
                onClick={onOpenAccount}
              >
                Go to Account
              </Button>
            ) : enabled ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  leftIcon={
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${busy ? 'motion-safe:animate-spin' : ''}`}
                    />
                  }
                  onClick={() => void run(() => configurationSyncScheduler.request('manual'))}
                >
                  Sync now
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  leftIcon={<Pause className="h-3.5 w-3.5" />}
                  onClick={() => void run(() => setSyncEnabled(userId, false))}
                >
                  Pause
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                leftIcon={<Cloud className="h-3.5 w-3.5" />}
                onClick={() => void run(() => connectConfigurationSync(userId))}
              >
                Use cloud settings
              </Button>
            )}
          </div>
        </div>
        {accountStatus &&
          (accountStatus.pendingRecords > 0 ||
            accountStatus.quarantinedRecords > 0 ||
            accountStatus.pendingEffects > 0) && (
            <div
              className="flex flex-wrap gap-x-5 gap-y-2 border-t border-violet-200/50 px-5 py-3 text-xs text-slate-600 dark:border-white/10 dark:text-slate-400"
              aria-live="polite"
            >
              <span>{accountStatus.pendingRecords} pending uploads</span>
              <span>{accountStatus.quarantinedRecords} need review</span>
              <span>{accountStatus.pendingEffects} awaiting application</span>
            </div>
          )}
      </div>
      {syncError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="break-words">{syncError}</p>
        </div>
      )}

      <SettingsSection
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="What travels with you"
        description="Your preferences sync. Your content stays here."
      >
        <div className="grid gap-4 @min-[480px]:grid-cols-2">
          <div className="rounded-lg bg-violet-500/5 p-3.5">
            <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300">
              <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
              Synced
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              {[
                'Appearance & language',
                'Copy, search & OCR preferences',
                'Renderers & app shortcuts',
                'Portable extension settings',
              ].map(label => (
                <li key={label} className="flex items-center gap-2">
                  <Check className="h-3 w-3 shrink-0 text-violet-500" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-slate-500/5 p-3.5">
            <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
              Stays on this device
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              {[
                'Clips, notes, tags & files',
                'Credentials & permissions',
                'Capture & window settings',
                'AI providers & device shortcuts',
              ].map(label => (
                <li key={label} className="flex items-center gap-2">
                  <span
                    className="mx-1 h-1 w-1 shrink-0 rounded-full bg-slate-400"
                    aria-hidden="true"
                  />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <details className="group text-xs text-slate-500 dark:text-slate-400">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-violet-500 [&::-webkit-details-marker]:hidden">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Privacy & sync details
            <ChevronDown
              className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="mt-3 space-y-2 leading-relaxed">
            <p>
              Settings are protected by your account, not end-to-end encrypted. Restored extensions
              require fresh consent for external capabilities.
            </p>
            <p>
              Sync includes theme, language, output format, copy toast, search and OCR preferences,
              renderer choices, signed-extension intent, approved portable settings, and app-command
              shortcuts.
            </p>
            <p>
              Clips, notes, tags, files, credentials, permission grants, provider endpoints and
              models, capture settings, window behavior and layout, autostart, the global activation
              shortcut, update policy, caches, and diagnostics always stay local.
            </p>
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        icon={<Monitor className="h-4 w-4" />}
        title="Devices"
        description="Manage access to your synced settings."
      >
        {devices.length === 0 ? (
          <div className="flex items-center gap-3 py-1 text-slate-400">
            <Monitor className="h-8 w-8 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {!userId
                  ? 'Your devices will appear here'
                  : enabled
                    ? 'No devices to display'
                    : 'Connect to see your devices'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {!userId
                  ? 'Sign in and enable sync to get started.'
                  : 'Devices appear after connecting to your cloud profile.'}
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200/70 dark:divide-white/10">
            {devices.map(device => (
              <li
                key={device.deviceId}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="rounded-lg bg-slate-500/5 p-2 text-slate-400">
                    <Monitor className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-sm font-medium text-slate-800 dark:text-slate-200">
                        {device.displayName}
                      </p>
                      {device.current && (
                        <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                          This device
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {device.revokedAt
                        ? 'Access revoked'
                        : `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>
                {!device.revokedAt && (
                  <Button
                    size="sm"
                    variant="ghost"
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
        )}
      </SettingsSection>

      {userId && (
        <details className="group rounded-xl border border-slate-200/70 bg-white/35 dark:border-white/10 dark:bg-white/[0.025]">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-violet-500 dark:text-slate-400 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Advanced sync options
            <ChevronDown
              className="ml-auto h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-4 border-t border-slate-200/70 p-4 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Start from this device
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Replace cloud settings. Other devices will need to reconnect.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirm('replace')}
              >
                Replace cloud settings
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Clear cloud settings
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Pause sync and remove the cloud copy. Local settings stay intact.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !accountStatus?.generation}
                onClick={() => setConfirm('reset')}
              >
                Clear cloud settings
              </Button>
            </div>
            {confirm && (
              <div
                role="alert"
                className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200"
              >
                <p>
                  {confirm === 'replace'
                    ? 'Replace the entire cloud configuration with the supported settings on this device? Other devices will pause and ask how to reconnect.'
                    : 'Clear cloud configuration and pause synchronization? Local settings and clipboard content remain on every device.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        confirm === 'replace'
                          ? () => connectConfigurationSync(userId, true)
                          : clearCloudConfiguration
                      )
                    }
                  >
                    Confirm {confirm === 'replace' ? 'replacement' : 'clear'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </details>
      )}
      {recovery.length > 0 && (
        <SettingsSection
          icon={<TriangleAlert className="h-4 w-4" />}
          title="Needs attention"
          description="Review settings that could not be applied."
        >
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
        </SettingsSection>
      )}
    </section>
  )
}
