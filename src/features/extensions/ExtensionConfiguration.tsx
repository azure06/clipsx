import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Select, Switch } from '../../shared/components/ui'
import { useUIStore } from '../../stores/uiStore'
import type { ExtensionSettingsRequest } from '../../stores/uiStore'
import type { PackageDetail } from '../settings/extensions/types'
import { SetupConfiguration } from './SetupConfiguration'
import {
  cleanParameters,
  allowSetupChange,
  sameParameters,
  controlClass,
  humanLabel,
  parameterErrors,
  type SavedSetup,
} from './parameters'

type SourceApplication = { platform: string; id: string; displayName: string }
export type AutomationRule = {
  id: string
  activationId: string
  application: SourceApplication | null
  enabled: boolean
  setupKind: 'builtin' | 'saved'
  setupRef: string
  setupLabel: string
  defaultView: string
  reasonCode: string | null
  revision: number
}
const changed = () => window.dispatchEvent(new Event('clipsx-extension-permissions-changed'))

export function SavedSetupsEditor({
  packageId,
  detail,
  onChanged,
}: {
  packageId: string
  detail: PackageDetail
  onChanged: () => Promise<void>
}) {
  const first = detail.transformers[0]
  const [setups, setSetups] = useState<SavedSetup[]>([])
  const [transformerId, setTransformerId] = useState(first?.id ?? '')
  const [reference, setReference] = useState(first?.setups[0]?.id ?? 'default')
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    first
      ? cleanParameters(
          first.parameterSchema,
          first.parameterUi ?? [],
          first.setups[0]?.parameters ?? {}
        )
      : {}
  )
  const [view, setView] = useState<'result_only' | 'compare'>(
    first?.setups[0]?.defaultView ?? first?.defaultView ?? 'result_only'
  )
  const [name, setName] = useState('')
  const [copyMode, setCopyMode] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(
    async () =>
      setSetups(
        (await invoke<SavedSetup[]>('list_extension_transform_setups')).filter(
          item => item.packageId === packageId
        )
      ),
    [packageId]
  )
  useEffect(() => {
    void refresh().catch(reason => setError(String(reason)))
  }, [refresh])
  const transformer = detail.transformers.find(item => item.id === transformerId)
  const selected = reference.startsWith('saved:')
    ? setups.find(item => item.id === reference.slice(6))
    : undefined
  const builtin = transformer?.setups.find(item => item.id === reference)
  const baseline = transformer
    ? cleanParameters(
        transformer.parameterSchema,
        transformer.parameterUi ?? [],
        selected?.parameters ?? builtin?.parameters ?? {}
      )
    : {}
  const dirty =
    !sameParameters(values, baseline) ||
    view !== (selected?.defaultView ?? builtin?.defaultView ?? transformer?.defaultView) ||
    ((!selected || copyMode) && !!name.trim())
  const choose = (next: string, operation = transformer) => {
    if (!operation) return
    const saved = next.startsWith('saved:')
      ? setups.find(item => item.id === next.slice(6))
      : undefined
    const base = operation.setups.find(item => item.id === next)
    setTransformerId(operation.id)
    setReference(next)
    setValues(
      cleanParameters(
        operation.parameterSchema,
        operation.parameterUi ?? [],
        saved?.parameters ?? base?.parameters ?? {}
      )
    )
    setView(saved?.defaultView ?? base?.defaultView ?? operation.defaultView)
    setName('')
    setCopyMode(false)
    setErrors({})
    setError(null)
  }
  const save = async () => {
    if (!transformer) return
    const next = parameterErrors(transformer.parameterSchema, transformer.parameterUi ?? [], values)
    setErrors(next)
    const label = selected && !copyMode ? selected.label : name.trim()
    if (Object.keys(next).length || !label) {
      if (!label) setError('Enter a setup name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await invoke<SavedSetup>('save_extension_transform_setup', {
        id: selected && !copyMode ? selected.id : null,
        expectedRevision: selected && !copyMode ? selected.revision : null,
        transformerId,
        label,
        parameters: cleanParameters(
          transformer.parameterSchema,
          transformer.parameterUi ?? [],
          values
        ),
        defaultView: view,
      })
      await refresh()
      setReference(`saved:${saved.id}`)
      setValues(saved.parameters)
      setView(saved.defaultView)
      setName('')
      setCopyMode(false)
      changed()
      await onChanged()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (setup: SavedSetup) => {
    if (
      !window.confirm(
        'Delete this setup? Its automation rules will be disabled. Existing results stay available.'
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      await invoke('delete_extension_transform_setup', { id: setup.id })
      await refresh()
      if (selected?.id === setup.id) choose(transformer?.setups[0]?.id ?? 'default')
      changed()
      await onChanged()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4">
      <p className="text-xs leading-5 text-slate-500">
        Saved setups are reusable choices. Changes apply to future automatic runs; existing results
        stay unchanged.
      </p>
      {detail.transformers.length > 1 && (
        <Select
          label="Operation"
          value={transformerId}
          disabled={busy}
          className={controlClass}
          options={detail.transformers.map(item => ({ value: item.id, label: item.label }))}
          onChange={id => {
            if (allowSetupChange(dirty)) {
              const operation = detail.transformers.find(item => item.id === id)
              choose(operation?.setups[0]?.id ?? 'default', operation)
            }
          }}
        />
      )}
      {transformer ? (
        <>
          <SetupConfiguration
            transformer={transformer}
            setups={setups.filter(item => item.transformerId === transformer.id)}
            reference={reference}
            values={values}
            view={view}
            errors={errors}
            disabled={busy}
            onSelect={next => {
              if (allowSetupChange(dirty)) choose(next)
            }}
            onChange={next => {
              setValues(next)
              setErrors({})
            }}
            onViewChange={setView}
          />
          {(!selected || copyMode) && (
            <label className="grid gap-1.5 text-xs font-semibold">
              Setup name
              <input
                className={controlClass}
                value={name}
                maxLength={80}
                onChange={event => setName(event.target.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || (selected && !selected.available)}
              onClick={() => void save()}
            >
              {selected && !copyMode ? 'Save changes' : 'Save setup'}
            </Button>
            {selected && !copyMode && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setCopyMode(true)
                    setName('')
                  }}
                >
                  Save as another setup
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove(selected)}
                >
                  Delete setup
                </Button>
              </>
            )}
            {copyMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCopyMode(false)
                  setName('')
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          This extension has no configurable transformations.
        </p>
      )}
      {setups.some(item => !item.available) && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold text-slate-500">Unavailable setups</p>
          {setups
            .filter(item => !item.available)
            .map(item => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1">
                  {item.label} — incompatible with the installed operation
                </span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(item)}>
                  Delete {item.label}
                </Button>
              </div>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export function AutomationEditor({
  packageId,
  detail,
  request,
  onChanged,
}: {
  packageId: string
  detail: PackageDetail
  request?: ExtensionSettingsRequest | null
  onChanged: () => Promise<void>
}) {
  const [automation, setAutomation] = useState<{ revision: number; rules: AutomationRule[] }>({
    revision: 0,
    rules: [],
  })
  const [applications, setApplications] = useState<SourceApplication[]>([])
  const [setups, setSetups] = useState<SavedSetup[]>([])
  const [activationId, setActivationId] = useState(
    () =>
      detail.activations.find(item =>
        detail.transformers.some(
          transformer =>
            transformer.id === request?.transformerId && transformer.localId === item.transformerId
        )
      )?.id ??
      detail.activations[0]?.id ??
      ''
  )
  const [applicationId, setApplicationId] = useState('all')
  const [setupRef, setSetupRef] = useState(
    request?.setupRef ? `${request.setupKind}:${request.setupRef}` : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const [rules, apps, saved] = await Promise.all([
      invoke<typeof automation>('get_extension_automation', { packageId }),
      invoke<SourceApplication[]>('list_source_applications'),
      invoke<SavedSetup[]>('list_extension_transform_setups'),
    ])
    setAutomation(rules)
    setApplications(apps)
    setSetups(saved.filter(item => item.packageId === packageId))
  }, [packageId])
  useEffect(() => {
    void refresh().catch(reason => setError(String(reason)))
  }, [refresh, detail])
  const activation = detail.activations.find(item => item.id === activationId)
  const transformer = detail.transformers.find(item => item.localId === activation?.transformerId)
  const builtin =
    transformer?.setups.map(item => ({
      value: `builtin:${item.id}`,
      label: item.displayName,
      available:
        Object.keys(
          parameterErrors(
            transformer.parameterSchema,
            transformer.parameterUi ?? [],
            item.parameters
          )
        ).length === 0,
    })) ?? []
  const saved = setups
    .filter(item => item.transformerId === transformer?.id)
    .map(item => ({ value: `saved:${item.id}`, label: item.label, available: item.available }))
  const options = [...builtin, ...saved]
  const selected = options.find(item => item.value === setupRef)
  const save = async (rules: AutomationRule[]) => {
    const newlyEnabled = rules.filter(
      rule =>
        rule.enabled &&
        (detail.automationConsentRequired ||
          !automation.rules.some(
            old =>
              old.id === rule.id &&
              old.enabled &&
              old.setupKind === rule.setupKind &&
              old.setupRef === rule.setupRef &&
              JSON.stringify(old.application) === JSON.stringify(rule.application)
          ))
    )
    if (newlyEnabled.length) {
      const permissions = detail.automationPermissions
      const formats =
        [
          ...new Set(
            detail.activations.flatMap(
              item => item.matchers?.flatMap(matcher => matcher.mimeTypes ?? []) ?? []
            )
          ),
        ].join(', ') || 'declared matching formats'
      const capabilities = [
        permissions.sourceApplication ? 'normalized source application' : null,
        permissions.providers.length ? 'configured local generation' : null,
        ...permissions.http.map(item => `read ${item.origin}`),
        ...permissions.externalWrites.map(item => `write ${item.origin}`),
        permissions.packageState ? 'declared package state' : null,
      ]
        .filter(Boolean)
        .join(', ')
      if (
        !window.confirm(
          `Allow ${detail.package?.displayName ?? packageId} to process ${formats} copied from ${newlyEnabled.map(rule => rule.application?.displayName ?? 'all applications, including unknown sources').join(', ')} using ${capabilities || 'local processing'} and store attached results? Automatic work never copies or pastes.`
        )
      )
        return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('set_extension_automation', {
        packageId,
        expectedRevision: automation.revision,
        rules,
      })
      await refresh()
      await onChanged()
      changed()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  if (!detail.activations.length)
    return (
      <p className="text-xs text-slate-500">This extension does not declare capture automation.</p>
    )
  return (
    <div className="grid gap-4">
      {detail.automationConsentRequired && (
        <div
          role="alert"
          className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs"
        >
          <p>
            Permission is required for this package release. Rules stay inactive until approved.
          </p>
          {automation.rules.some(rule => rule.enabled) && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy}
              onClick={() => void save(automation.rules)}
            >
              Review permissions
            </Button>
          )}
        </div>
      )}
      <p className="text-xs leading-5 text-slate-500">
        Choose which copied content starts an operation. Rules reuse a setup; they do not maintain
        separate parameter fields. Results stay attached to the source clip.
      </p>
      <Select
        label="Operation"
        ariaLabel="Automation operation"
        className={controlClass}
        value={activationId}
        onChange={id => {
          setActivationId(id)
          setSetupRef('')
        }}
        options={detail.activations.map(item => ({
          value: item.id,
          label:
            detail.transformers.find(transformer => transformer.localId === item.transformerId)
              ?.label ?? humanLabel(item.transformerId),
        }))}
      />
      <Select
        label="Copied content"
        className={controlClass}
        value={applicationId}
        onChange={setApplicationId}
        placeholder="Choose an observed application"
        options={[
          { value: 'all', label: 'All copied clips' },
          ...applications.map(item => ({
            value: `${item.platform}\u0000${item.id}`,
            label: `From ${item.displayName}`,
          })),
        ]}
      />
      {!applications.length && (
        <p className="text-[11px] text-slate-500">
          All copied clips works without application identity. Copy from an application to add a
          specific source rule.
        </p>
      )}
      <Select
        label="Setup"
        ariaLabel="Automation setup"
        className={controlClass}
        value={setupRef}
        onChange={setSetupRef}
        placeholder="Choose a setup"
        groups={[
          {
            label: 'Built-in setups',
            options: builtin.map(item => ({
              value: item.value,
              label: item.label + (!item.available ? ' — configure and save first' : ''),
              disabled: !item.available,
            })),
          },
          {
            label: 'Saved setups',
            options: saved.map(item => ({
              value: item.value,
              label: item.label + (!item.available ? ' — unavailable' : ''),
              disabled: !item.available,
            })),
          },
        ]}
      />
      {transformer?.providerAvailable === false && (
        <p
          role="alert"
          className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          A generation model is not configured.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => useUIStore.getState().setActiveView('intelligence')}
          >
            Configure Local Text Generation
          </button>{' '}
          before testing this rule.
        </p>
      )}
      <div>
        <Button
          size="sm"
          disabled={busy || !applicationId || !selected?.available}
          onClick={() => {
            const application =
              applicationId === 'all'
                ? null
                : applications.find(item => `${item.platform}\u0000${item.id}` === applicationId)
            if (application === undefined || !selected) return
            const split = setupRef.indexOf(':')
            const existing = automation.rules.find(
              rule =>
                rule.activationId === activationId &&
                (rule.application?.platform ?? null) === (application?.platform ?? null) &&
                (rule.application?.id ?? null) === (application?.id ?? null)
            )
            const rule: AutomationRule = {
              id: existing?.id ?? crypto.randomUUID(),
              activationId,
              application,
              enabled: true,
              setupKind: setupRef.slice(0, split) as 'builtin' | 'saved',
              setupRef: setupRef.slice(split + 1),
              setupLabel: selected.label,
              defaultView: '',
              reasonCode: null,
              revision: automation.revision,
            }
            void save([...automation.rules.filter(item => item.id !== rule.id), rule])
          }}
        >
          Add rule
        </Button>
      </div>
      <div className="space-y-2">
        {automation.rules.map(rule => (
          <div
            key={rule.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-white/50 p-3 text-xs dark:border-white/10 dark:bg-white/[.025]"
          >
            <Switch
              ariaLabel={`Enable ${rule.application?.displayName ?? 'all copied clips'} rule`}
              checked={rule.enabled}
              disabled={busy || !!rule.reasonCode}
              size="sm"
              onChange={enabled =>
                void save(
                  automation.rules.map(item => (item.id === rule.id ? { ...item, enabled } : item))
                )
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {rule.application?.displayName ?? 'All copied clips'}
              </span>
              <span className="mt-1 block text-[11px] text-slate-500">
                {rule.setupLabel}
                {rule.reasonCode ? ` · ${humanLabel(rule.reasonCode)}` : ''}
              </span>
            </span>
            <button
              type="button"
              aria-label="Delete automation rule"
              disabled={busy}
              onClick={() => void save(automation.rules.filter(item => item.id !== rule.id))}
              className="rounded p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
