import { invoke } from '@tauri-apps/api/core'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ExternalLink, KeyRound, RotateCcw, ShieldCheck, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../../../shared/components/ui/Button'
import { Switch } from '../../../shared/components/ui/Switch'
import { ShortcutRecorder } from '../Settings'
import type { PackageDetail, UpdateMode } from './types'

type DetailTab = 'overview' | 'settings' | 'permissions' | 'actions' | 'diagnostics'
const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Settings' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'actions', label: 'Actions' },
  { id: 'diagnostics', label: 'Diagnostics' },
]

const formatBytes = (value?: number | null) =>
  value == null
    ? 'Not recorded'
    : value < 1024 * 1024
      ? `${Math.ceil(value / 1024)} KB`
      : `${(value / 1024 / 1024).toFixed(2)} MB`
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : 'Not recorded'

export const PackageDetailView = ({
  packageId,
  detail,
  busy,
  onClose,
  onChanged,
}: {
  packageId: string
  detail: PackageDetail
  busy: boolean
  onClose: () => void
  onChanged: () => void
}) => {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [values, setValues] = useState(detail.settings)
  const [mode, setMode] = useState<UpdateMode>(detail.autoUpdateMode)
  const registryPackage = detail.package
  const installed = detail.installed

  useEffect(() => {
    setValues(detail.settings)
    setMode(detail.autoUpdateMode)
  }, [detail])

  if (!registryPackage) return null
  const changeSetting = async (settingId: string, value: unknown) => {
    setValues(current => ({ ...current, [settingId]: value }))
    await invoke('set_extension_package_setting', { packageId, settingId, value })
    onChanged()
  }
  const setEnabled = async (enabled: boolean) => {
    await invoke('set_extension_enabled', { packageId, enabled })
    onChanged()
  }
  const setUpdateMode = async (next: UpdateMode) => {
    setMode(next)
    await invoke('set_extension_update_preference', { packageId, mode: next })
    onChanged()
  }
  const install = async (version: string) => {
    await invoke('install_registry_extension', { packageId, version })
    onChanged()
  }
  const metadata = [
    ['Identifier', registryPackage.packageId],
    ['Installed', installed ? `v${installed.version}` : 'Not installed'],
    ['Release', `v${registryPackage.version}`],
    ['Updated', formatDate(registryPackage.updatedAt)],
    ['Published', formatDate(registryPackage.publishedAt)],
    ['Size', formatBytes(registryPackage.archiveSizeBytes)],
    ['License', registryPackage.license ?? 'Not recorded'],
  ]

  return (
    <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/45 p-5 shadow-[0_18px_42px_-34px_rgba(30,41,59,.42)] dark:border-white/10 dark:bg-slate-950/20">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/22 to-fuchsia-500/14 text-sm font-bold text-violet-700 ring-1 ring-violet-500/15 dark:text-violet-200">
          {installed?.iconSvg || registryPackage.iconAssets?.light.dataUrl ? (
            <>
              <img
                className="h-8 w-8 object-contain dark:hidden"
                src={installed?.iconSvg ?? registryPackage.iconAssets?.light.dataUrl ?? undefined}
                alt=""
              />
              <img
                className="hidden h-8 w-8 object-contain dark:block"
                src={
                  installed?.iconSvgDark ??
                  installed?.iconSvg ??
                  registryPackage.iconAssets?.dark.dataUrl ??
                  registryPackage.iconAssets?.light.dataUrl ??
                  undefined
                }
                alt=""
              />
            </>
          ) : (
            registryPackage.displayName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {registryPackage.displayName}
            </h2>
            {installed && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${installed.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/10 text-slate-500'}`}
              >
                {installed.enabled ? 'Enabled' : 'Disabled'}
              </span>
            )}
            {detail.update && (
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                Update available
              </span>
            )}
            {detail.revoked && (
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                Revoked
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {registryPackage.publisher?.displayName ??
              (installed?.source === 'developer' ? 'Local package' : 'Registry publisher')}{' '}
            · {registryPackage.packageId}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/55 p-2 dark:border-white/10 dark:bg-white/[.035]">
        {installed ? (
          <Switch
            checked={installed.enabled}
            onChange={enabled => void setEnabled(enabled)}
            size="sm"
          />
        ) : null}
        {installed ? (
          <span className="mr-auto text-xs text-slate-600 dark:text-slate-300">
            {installed.enabled ? 'Participating in ClipsX' : 'Installed but inactive'}
          </span>
        ) : (
          <span className="mr-auto text-xs text-slate-600 dark:text-slate-300">
            Ready to install from the reviewed registry
          </span>
        )}
        {detail.update ? (
          <Button
            size="sm"
            isLoading={busy}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => void install(detail.update!.version)}
          >
            Review update
          </Button>
        ) : !installed ? (
          <Button
            size="sm"
            isLoading={busy}
            disabled={detail.revoked}
            onClick={() => void install(registryPackage.version)}
          >
            Install
          </Button>
        ) : null}
      </div>

      <div
        className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200/70 dark:border-white/10"
        role="tablist"
      >
        {tabs.map(item => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${tab === item.id ? 'border-violet-500 text-violet-700 dark:text-violet-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {registryPackage.description || 'No package description was provided.'}
          </p>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {metadata.map(([label, value]) => (
              <div
                key={label}
                className="border-b border-slate-200/55 pb-2 dark:border-white/[.07]"
              >
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {label}
                </dt>
                <dd className="mt-1 break-all text-xs text-slate-700 dark:text-slate-200">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-1.5">
            {[...registryPackage.categories, ...registryPackage.tags].map(item => (
              <span
                key={item}
                className="rounded-md bg-violet-500/8 px-2 py-1 text-[10px] font-medium text-violet-700 dark:text-violet-300"
              >
                {item}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {[
              ['Homepage', registryPackage.homepageUrl],
              ['Repository', registryPackage.repositoryUrl],
              ['Documentation', registryPackage.documentationUrl],
            ].flatMap(([label, value]) =>
              value
                ? [
                    <button
                      key={label}
                      onClick={() => void invoke('open_external_url', { url: value })}
                      className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-900 dark:text-violet-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {label}
                    </button>,
                  ]
                : []
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-3">
          {!installed ? (
            <Empty text="Install this package to change its settings." />
          ) : installed.settings.length === 0 ? (
            <Empty text="This package has no user settings." />
          ) : (
            installed.settings.map(setting => (
              <label
                key={setting.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/65 bg-white/30 px-3 py-3 text-xs dark:border-white/[.08] dark:bg-white/[.025]"
              >
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {setting.label}
                </span>
                {setting.kind === 'boolean' ? (
                  <Switch
                    checked={Boolean(values[setting.id] ?? setting.default)}
                    onChange={value => void changeSetting(setting.id, value)}
                    size="sm"
                  />
                ) : (
                  <input
                    className="w-48 rounded-lg border border-slate-200 bg-white/70 px-2 py-1.5 text-xs outline-none focus:border-violet-400 dark:border-white/15 dark:bg-slate-900/60"
                    type={setting.kind === 'number' ? 'number' : 'text'}
                    value={(() => {
                      const value = values[setting.id] ?? setting.default
                      return typeof value === 'string' || typeof value === 'number'
                        ? String(value)
                        : ''
                    })()}
                    onChange={event =>
                      void changeSetting(
                        setting.id,
                        setting.kind === 'number' ? Number(event.target.value) : event.target.value
                      )
                    }
                  />
                )}
              </label>
            ))
          )}
        </div>
      )}

      {tab === 'permissions' && (
        <div className="space-y-4">
          <p className="text-xs leading-5 text-slate-500">
            External data only leaves ClipsX after a package-release-specific consent. Credentials
            stay in the operating system credential store and are never shown to the package.
          </p>
          <PermissionGroup
            title="HTTPS endpoints"
            values={installed?.httpOrigins ?? registryPackage.httpOrigins}
          />
          <PermissionGroup
            title="External navigation"
            values={
              installed?.externalNavigationOrigins ?? registryPackage.externalNavigationOrigins
            }
          />
          <PermissionGroup
            title="Credential slots"
            values={installed?.credentialLabels ?? registryPackage.credentialLabels}
            icon={<KeyRound className="h-3.5 w-3.5" />}
          />
          {detail.grantsRevokedOnUpdate && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              Updating revokes remembered consent. The next external request asks again.
            </div>
          )}
        </div>
      )}

      {tab === 'actions' && (
        <div className="space-y-3">
          {detail.actions.length === 0 ? (
            <Empty
              text={
                installed?.enabled
                  ? 'This package has no currently available actions.'
                  : 'Enable this package to manage its actions.'
              }
            />
          ) : (
            detail.actions.map(action => (
              <div
                key={action.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/65 bg-white/30 px-3 py-3 text-xs dark:border-white/[.08] dark:bg-white/[.025]"
              >
                <div className="min-w-40 flex-1">
                  <div className="font-semibold text-slate-700 dark:text-slate-200">
                    {action.label}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {action.placements.join(' · ')}
                    {action.unavailableReason ? ` · ${action.unavailableReason}` : ''}
                  </div>
                </div>
                <button
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold ${action.pinned ? 'bg-violet-500/12 text-violet-700 dark:text-violet-300' : 'bg-slate-500/8 text-slate-500'}`}
                  onClick={() =>
                    void invoke('set_extension_action_pinned', {
                      actionId: action.id,
                      pinned: !action.pinned,
                    }).then(onChanged)
                  }
                >
                  Pin
                </button>
                <div className="flex items-center gap-1">
                  <ShortcutRecorder
                    value={action.shortcut ?? ''}
                    onChange={shortcut =>
                      void invoke('set_extension_action_shortcut', {
                        actionId: action.id,
                        accelerator: shortcut || null,
                      }).then(onChanged)
                    }
                  />
                  {action.shortcut && (
                    <Tooltip.Provider delayDuration={300}>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <button
                            type="button"
                            aria-label="Remove shortcut"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-500/10 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
                            onClick={() =>
                              void invoke('set_extension_action_shortcut', {
                                actionId: action.id,
                                accelerator: null,
                              }).then(onChanged)
                            }
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content
                            className="z-100 rounded bg-white/95 px-2 py-1 text-[10px] text-gray-900 shadow dark:bg-slate-900/95 dark:text-white"
                            sideOffset={5}
                          >
                            Remove shortcut
                            <Tooltip.Arrow className="fill-white dark:fill-slate-900" />
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    </Tooltip.Provider>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'diagnostics' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200/65 bg-white/30 p-3 text-xs dark:border-white/[.08] dark:bg-white/[.025]">
            <div className="mb-2 flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Package health
            </div>
            {detail.diagnostics.length ? (
              detail.diagnostics.map(item => (
                <p key={item} className="text-slate-500">
                  {item}
                </p>
              ))
            ) : (
              <p className="text-slate-500">No runtime problems have been reported.</p>
            )}
          </div>
          {installed?.status === 'quarantined' && (
            <Button
              size="sm"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => void invoke('recover_extension', { packageId }).then(onChanged)}
            >
              Recover package
            </Button>
          )}
          {installed && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
              onClick={() => {
                if (window.confirm(`Remove ${registryPackage.displayName}?`))
                  void invoke('uninstall_extension', { packageId }).then(onClose).then(onChanged)
              }}
            >
              Remove package
            </Button>
          )}
          <div className="border-t border-slate-200/65 pt-4 dark:border-white/[.08]">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <Zap className="h-3.5 w-3.5 text-violet-500" />
              Automatic updates
              <select
                value={mode}
                className="ml-auto rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-900/60"
                disabled={installed?.source === 'developer'}
                onChange={event => void setUpdateMode(event.target.value as UpdateMode)}
              >
                <option value="inherit">Use global preference</option>
                <option value="enabled">Always install safe updates</option>
                <option value="disabled">Never auto-update</option>
              </select>
            </label>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">
              {detail.autoUpdateEligible
                ? 'This release is eligible when automatic updates are enabled.'
                : 'Only enabled, ready registry packages with unchanged permissions can update automatically.'}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

const PermissionGroup = ({
  title,
  values,
  icon,
}: {
  title: string
  values: string[]
  icon?: ReactNode
}) => (
  <div>
    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
      {icon}
      {title}
    </div>
    {values.length ? (
      <div className="flex flex-wrap gap-1.5">
        {values.map(value => (
          <code
            key={value}
            className="rounded-md bg-slate-900/[.045] px-2 py-1 text-[10px] text-slate-600 dark:bg-white/[.06] dark:text-slate-300"
          >
            {value}
          </code>
        ))}
      </div>
    ) : (
      <p className="text-xs text-slate-500">None declared.</p>
    )}
  </div>
)
const Empty = ({ text }: { text: string }) => (
  <div className="rounded-xl border border-dashed border-slate-200/80 px-4 py-8 text-center text-xs text-slate-500 dark:border-white/15">
    {text}
  </div>
)
