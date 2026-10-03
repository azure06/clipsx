import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../../i18n/index'
import { invoke } from '@tauri-apps/api/core'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ExternalLink, KeyRound, RotateCcw, ShieldCheck, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Select } from '../../../shared/components/ui'
import { Switch } from '../../../shared/components/ui/Switch'
import { ShortcutRecorder } from '../Settings'
import type { PackageDetail, UpdateMode } from './types'
import { AutomationEditor, SavedSetupsEditor } from '../../extensions/ExtensionConfiguration'
import type { ExtensionSettingsRequest } from '../../../stores/uiStore'

type DetailTab =
  'overview' | 'settings' | 'setups' | 'automation' | 'permissions' | 'actions' | 'diagnostics'
const tabs: Array<{ id: DetailTab; label: string }> = [
  {
    id: 'overview',
    get label() {
      return i18n.t('desktopUi.overview')
    },
  },
  {
    id: 'settings',
    get label() {
      return i18n.t('desktopUi.general')
    },
  },
  {
    id: 'setups',
    get label() {
      return i18n.t('desktopUi.savedSetups')
    },
  },
  {
    id: 'automation',
    get label() {
      return i18n.t('desktopUi.automation')
    },
  },
  {
    id: 'permissions',
    get label() {
      return i18n.t('desktopUi.permissions')
    },
  },
  {
    id: 'actions',
    get label() {
      return i18n.t('desktopUi.actions')
    },
  },
  {
    id: 'diagnostics',
    get label() {
      return i18n.t('desktopUi.diagnostics')
    },
  },
]

const formatBytes = (value?: number | null) =>
  value == null
    ? i18n.t('desktopUi.notRecorded')
    : value < 1024 * 1024
      ? `${Math.ceil(value / 1024)} KB`
      : `${(value / 1024 / 1024).toFixed(2)} MB`
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : i18n.t('desktopUi.notRecorded')

export const PackageDetailView = ({
  packageId,
  detail,
  busy,
  onClose,
  onChanged,
  request,
}: {
  packageId: string
  detail: PackageDetail
  busy: boolean
  onClose: () => void
  request?: ExtensionSettingsRequest | null
  onChanged: () => Promise<void>
}) => {
  useTranslation()

  const [tab, setTab] = useState<DetailTab>(request?.section ?? 'overview')
  const [values, setValues] = useState(detail.settings)
  const [mode, setMode] = useState<UpdateMode>(detail.autoUpdateMode)
  const [operationBusy, setOperationBusy] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const operationInFlight = useRef(false)
  const registryPackage = detail.package
  const installed = detail.installed

  useEffect(() => {
    if (request) setTab(request.section)
  }, [request])
  useEffect(() => {
    setValues(detail.settings)
    setMode(detail.autoUpdateMode)
  }, [detail])
  useEffect(() => {
    setOperationError(null)
  }, [packageId])

  if (!registryPackage) return null
  const runOperation = async (operation: () => Promise<unknown>) => {
    if (operationInFlight.current) return false
    operationInFlight.current = true
    setOperationBusy(true)
    setOperationError(null)
    try {
      await operation()
      await onChanged()
      return true
    } catch (value) {
      setOperationError(String(value))
      return false
    } finally {
      operationInFlight.current = false
      setOperationBusy(false)
    }
  }
  const changeSetting = async (settingId: string, value: unknown) => {
    const previous = values[settingId]
    setValues(current => ({ ...current, [settingId]: value }))
    if (
      !(await runOperation(() =>
        invoke('set_extension_package_setting', { packageId, settingId, value })
      ))
    ) {
      setValues(current => ({ ...current, [settingId]: previous }))
    }
  }
  const setEnabled = async (enabled: boolean) => {
    await runOperation(() => invoke('set_extension_enabled', { packageId, enabled }))
  }
  const setUpdateMode = async (next: UpdateMode) => {
    const previous = mode
    setMode(next)
    if (
      !(await runOperation(() =>
        invoke('set_extension_update_preference', { packageId, mode: next })
      ))
    ) {
      setMode(previous)
    }
  }
  const install = async (version: string) => {
    await runOperation(() => invoke('install_registry_extension', { packageId, version }))
  }
  const metadata = [
    [i18n.t('desktopUi.identifier'), registryPackage.packageId],
    [
      i18n.t('desktopUi.installedf8b3'),
      installed ? `v${installed.version}` : i18n.t('desktopUi.notInstalled'),
    ],
    [i18n.t('desktopUi.release'), `v${registryPackage.version}`],
    [i18n.t('desktopUi.updated'), formatDate(registryPackage.updatedAt)],
    [i18n.t('desktopUi.published'), formatDate(registryPackage.publishedAt)],
    [i18n.t('desktopUi.size'), formatBytes(registryPackage.archiveSizeBytes)],
    [i18n.t('desktopUi.license'), registryPackage.license ?? i18n.t('desktopUi.notRecorded')],
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
                {installed.enabled ? i18n.t('desktopUi.enabled') : i18n.t('desktopUi.disabled')}
              </span>
            )}
            {detail.update && (
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                <Trans i18nKey="desktopUi.updateAvailable" />
              </span>
            )}
            {detail.revoked && (
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                <Trans i18nKey="desktopUi.revoked" />
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {registryPackage.publisher?.displayName ??
              (installed?.source === 'developer'
                ? i18n.t('desktopUi.localPackage')
                : i18n.t('desktopUi.registryPublisher'))}{' '}
            · {registryPackage.packageId}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <Trans i18nKey="desktopUi.back" />
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/55 p-2 dark:border-white/10 dark:bg-white/[.035]">
        {installed ? (
          <Switch
            checked={installed.enabled}
            onChange={enabled => void setEnabled(enabled)}
            size="sm"
            disabled={busy || operationBusy}
          />
        ) : null}
        {installed ? (
          <span className="mr-auto text-xs text-slate-600 dark:text-slate-300">
            {installed.enabled
              ? i18n.t('desktopUi.participatingInClipsx')
              : i18n.t('desktopUi.installedButInactive')}
          </span>
        ) : (
          <span className="mr-auto text-xs text-slate-600 dark:text-slate-300">
            <Trans i18nKey="desktopUi.readyToInstallFromTheReviewedRegistry" />
          </span>
        )}
        {detail.update ? (
          <Button
            size="sm"
            isLoading={busy || operationBusy}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => void install(detail.update!.version)}
          >
            <Trans i18nKey="desktopUi.reviewUpdate" />
          </Button>
        ) : !installed ? (
          <Button
            size="sm"
            isLoading={busy || operationBusy}
            disabled={detail.revoked}
            onClick={() => void install(registryPackage.version)}
          >
            <Trans i18nKey="desktopUi.install" />
          </Button>
        ) : null}
      </div>

      {operationError && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-red-500/20 bg-red-500/[.07] px-3 py-2 text-xs leading-5 text-red-700 dark:text-red-300"
        >
          {operationError}
        </div>
      )}

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
            {registryPackage.description || i18n.t('desktopUi.noPackageDescriptionWasProvided')}
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
              [i18n.t('desktopUi.homepage'), registryPackage.homepageUrl],
              [i18n.t('desktopUi.repository'), registryPackage.repositoryUrl],
              [i18n.t('desktopUi.documentation'), registryPackage.documentationUrl],
            ].flatMap(([label, value]) =>
              value
                ? [
                    <button
                      key={label}
                      onClick={() =>
                        void runOperation(() => invoke('open_external_url', { url: value }))
                      }
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
            <Empty text={i18n.t('desktopUi.installToConfigure')} />
          ) : installed.settings.length === 0 ? (
            <Empty text={i18n.t('desktopUi.noUserSettings')} />
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

      {tab === 'setups' && installed && (
        <SavedSetupsEditor packageId={packageId} detail={detail} onChanged={onChanged} />
      )}
      {tab === 'automation' && installed && (
        <AutomationEditor
          packageId={packageId}
          detail={detail}
          request={request}
          onChanged={onChanged}
        />
      )}

      {tab === 'permissions' && (
        <div className="space-y-4">
          <p className="text-xs leading-5 text-slate-500">
            <Trans i18nKey="desktopUi.externalDataOnlyLeavesClipsxAfterAPackageRelease" />
          </p>
          <PermissionGroup
            title={i18n.t('desktopUi.httpsEndpoints')}
            values={installed?.httpOrigins ?? registryPackage.httpOrigins}
          />
          <PermissionGroup
            title={i18n.t('desktopUi.externalNavigation')}
            values={
              installed?.externalNavigationOrigins ?? registryPackage.externalNavigationOrigins
            }
          />
          <PermissionGroup
            title={i18n.t('desktopUi.credentialSlots')}
            values={installed?.credentialLabels ?? registryPackage.credentialLabels}
            icon={<KeyRound className="h-3.5 w-3.5" />}
          />
          {detail.grantsRevokedOnUpdate && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <Trans i18nKey="desktopUi.updatingRevokesRememberedConsentTheNextExternalRequestAsks" />
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
                  ? i18n.t('desktopUi.thisPackageHasNoCurrentlyAvailableActions')
                  : i18n.t('desktopUi.enableThisPackageToManageItsActions')
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
                <div className="flex items-center gap-1">
                  <ShortcutRecorder
                    value={action.shortcut ?? ''}
                    onChange={shortcut =>
                      void runOperation(() =>
                        invoke('set_extension_action_shortcut', {
                          actionId: action.id,
                          accelerator: shortcut || null,
                        })
                      )
                    }
                  />
                  {action.shortcut && (
                    <Tooltip.Provider delayDuration={300}>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <button
                            type="button"
                            aria-label={i18n.t('desktopUi.removeShortcut')}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-500/10 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
                            disabled={operationBusy}
                            onClick={() =>
                              void runOperation(() =>
                                invoke('set_extension_action_shortcut', {
                                  actionId: action.id,
                                  accelerator: null,
                                })
                              )
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
                            <Trans i18nKey="desktopUi.removeShortcut" />
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
              <Trans i18nKey="desktopUi.packageHealth" />
            </div>
            {detail.diagnostics.length ? (
              detail.diagnostics.map(item => (
                <p key={item} className="text-slate-500">
                  {item}
                </p>
              ))
            ) : (
              <p className="text-slate-500">
                <Trans i18nKey="desktopUi.noRuntimeProblemsHaveBeenReported" />
              </p>
            )}
          </div>
          {installed?.status === 'quarantined' && (
            <Button
              size="sm"
              isLoading={operationBusy}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => void runOperation(() => invoke('recover_extension', { packageId }))}
            >
              <Trans i18nKey="desktopUi.recoverPackage" />
            </Button>
          )}
          {installed && (
            <Button
              variant="ghost"
              size="sm"
              isLoading={operationBusy}
              leftIcon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
              onClick={() => {
                if (
                  window.confirm(
                    i18n.t('desktopUi.removePackage', { name: registryPackage.displayName })
                  )
                )
                  void runOperation(() => invoke('uninstall_extension', { packageId })).then(
                    removed => {
                      if (removed) onClose()
                    }
                  )
              }}
            >
              <Trans i18nKey="desktopUi.removePackage" />
            </Button>
          )}
          <div className="border-t border-slate-200/65 pt-4 dark:border-white/[.08]">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <Zap className="h-3.5 w-3.5 text-violet-500" />
              <Trans i18nKey="desktopUi.automaticUpdates" />
              <Select
                ariaLabel="Automatic updates"
                value={mode}
                className="ml-auto text-xs"
                disabled={installed?.source === 'developer' || operationBusy}
                onChange={next => void setUpdateMode(next)}
                options={[
                  {
                    value: 'inherit',
                    label: i18n.t('desktopUi.useGlobalPreference'),
                  },
                  {
                    value: 'enabled',
                    label: i18n.t('desktopUi.alwaysInstallSafeUpdates'),
                  },
                  {
                    value: 'disabled',
                    label: i18n.t('desktopUi.neverAutoUpdate'),
                  },
                ]}
              />
            </label>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">
              {detail.autoUpdateEligible
                ? i18n.t('desktopUi.thisReleaseIsEligibleWhenAutomaticUpdatesAreEnabled')
                : i18n.t('desktopUi.onlyEnabledReadyRegistryPackagesWithUnchangedPermissionsCan')}
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
}) => {
  useTranslation()
  return (
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
        <p className="text-xs text-slate-500">
          <Trans i18nKey="desktopUi.noneDeclared" />
        </p>
      )}
    </div>
  )
}
const Empty = ({ text }: { text: string }) => {
  useTranslation()
  return (
    <div className="rounded-xl border border-dashed border-slate-200/80 px-4 py-8 text-center text-xs text-slate-500 dark:border-white/15">
      {text}
    </div>
  )
}
