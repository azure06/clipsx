import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Switch } from '../../shared/components/ui'
import { useUIStore } from '../../stores/uiStore'
import type { ExtensionSettingsRequest } from '../../stores/uiStore'
import type { PackageDetail } from '../settings/extensions/types'
import { ParameterForm } from './ParameterForm'
import {
  cleanParameters,
  controlClass,
  humanLabel,
  parameterErrors,
  type SavedSetup,
} from './parameters'

type SourceApplication = { platform: string; id: string; displayName: string }
export type AutomationRule = {
  id: string
  activationId: string
  application: SourceApplication
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
  const [setups, setSetups] = useState<SavedSetup[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [transformerId, setTransformerId] = useState(detail.transformers[0]?.id ?? '')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [name, setName] = useState('')
  const [view, setView] = useState<'result_only' | 'compare'>('result_only')
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
  const selected = setups.find(item => item.id === selectedId)
  const transformer = detail.transformers.find(item => item.id === transformerId)
  const choose = (id: string) => {
    const saved = setups.find(item => item.id === id)
    setSelectedId(id)
    setName(saved?.label ?? '')
    setValues(saved?.parameters ?? {})
    setView(saved?.defaultView ?? 'result_only')
    setErrors({})
    setError(null)
    if (saved) setTransformerId(saved.transformerId)
  }
  const save = async (copy: boolean) => {
    if (!transformer) return
    const next = parameterErrors(transformer.parameterSchema, transformer.parameterUi ?? [], values)
    setErrors(next)
    if (Object.keys(next).length || !name.trim()) {
      if (!name.trim()) setError('Enter a setup name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await invoke<SavedSetup>('save_extension_transform_setup', {
        id: !copy ? (selected?.id ?? null) : null,
        expectedRevision: !copy ? (selected?.revision ?? null) : null,
        transformerId,
        label: name.trim(),
        parameters: cleanParameters(
          transformer.parameterSchema,
          transformer.parameterUi ?? [],
          values
        ),
        defaultView: view,
      })
      await refresh()
      setSelectedId(saved.id)
      setName(saved.label)
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
      <label className="grid gap-1.5 text-xs font-semibold">
        Saved setup
        <select
          aria-label="Saved setup"
          className={controlClass}
          value={selectedId}
          onChange={event => choose(event.target.value)}
        >
          <option value="">Create a setup</option>
          {setups.map(item => (
            <option key={item.id} value={item.id}>
              {item.label}
              {!item.available ? ' — unavailable' : ''}
            </option>
          ))}
        </select>
      </label>
      {selected && !selected.available && (
        <p
          role="alert"
          className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          This setup is incompatible with the installed operation. You can delete it or create
          another setup.
        </p>
      )}
      {!selected && (
        <label className="grid gap-1.5 text-xs font-semibold">
          Operation
          <select
            className={controlClass}
            value={transformerId}
            onChange={event => {
              setTransformerId(event.target.value)
              setValues({})
              setErrors({})
            }}
          >
            {detail.transformers.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {transformer && (!selected || selected.available) && (
        <>
          <label className="grid gap-1.5 text-xs font-semibold">
            Setup name
            <input
              className={controlClass}
              value={name}
              maxLength={80}
              onChange={event => setName(event.target.value)}
            />
          </label>
          <ParameterForm
            schema={transformer.parameterSchema}
            fields={transformer.parameterUi}
            values={values}
            errors={errors}
            onChange={next => {
              setValues(next)
              setErrors({})
            }}
          />
          <label className="grid gap-1.5 text-xs font-semibold">
            Initial result view
            <select
              className={controlClass}
              value={view}
              onChange={event => setView(event.target.value as typeof view)}
            >
              <option value="result_only">Result</option>
              <option value="compare">Compare</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save(false)}>
              {selected ? 'Save changes' : 'Save setup'}
            </Button>
            {selected && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void save(true)}>
                Save as another setup
              </Button>
            )}
          </div>
        </>
      )}
      {selected && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                'Delete this setup? Its automation rules will be disabled. Existing results stay available.'
              )
            )
              return
            setBusy(true)
            void invoke('delete_extension_transform_setup', { id: selected.id })
              .then(async () => {
                choose('')
                await refresh()
                changed()
                await onChanged()
              })
              .catch(reason => setError(String(reason)))
              .finally(() => setBusy(false))
          }}
        >
          Delete setup
        </Button>
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
  const [applicationId, setApplicationId] = useState('')
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
    setApplicationId(
      current => current || (apps[0] ? `${apps[0].platform}\u0000${apps[0].id}` : '')
    )
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
              old.setupRef === rule.setupRef
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
          `Allow ${detail.package?.displayName ?? packageId} to process ${formats} copied from ${newlyEnabled.map(rule => rule.application.displayName).join(', ')} using ${capabilities || 'local processing'} and store attached results? Automatic work never copies or pastes.`
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
      <label className="grid gap-1.5 text-xs font-semibold">
        Operation
        <select
          aria-label="Automation operation"
          className={controlClass}
          value={activationId}
          onChange={event => {
            setActivationId(event.target.value)
            setSetupRef('')
          }}
        >
          {detail.activations.map(item => (
            <option key={item.id} value={item.id}>
              {detail.transformers.find(transformer => transformer.localId === item.transformerId)
                ?.label ?? humanLabel(item.transformerId)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-semibold">
        Source application
        <select
          aria-label="Source application"
          className={controlClass}
          value={applicationId}
          onChange={event => setApplicationId(event.target.value)}
        >
          <option value="">Choose an observed application</option>
          {applications.map(item => (
            <option key={`${item.platform}:${item.id}`} value={`${item.platform}\u0000${item.id}`}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      {!applications.length && (
        <p className="text-[11px] text-slate-500">
          Copy something from an application first so ClipsX can observe its identity.
        </p>
      )}
      <label className="grid gap-1.5 text-xs font-semibold">
        Setup
        <select
          aria-label="Automation setup"
          className={controlClass}
          value={setupRef}
          onChange={event => setSetupRef(event.target.value)}
        >
          <option value="">Choose a setup</option>
          <optgroup label="Built-in setups">
            {builtin.map(item => (
              <option key={item.value} value={item.value} disabled={!item.available}>
                {item.label}
                {!item.available ? ' — configure and save first' : ''}
              </option>
            ))}
          </optgroup>
          <optgroup label="Saved setups">
            {saved.map(item => (
              <option key={item.value} value={item.value} disabled={!item.available}>
                {item.label}
                {!item.available ? ' — unavailable' : ''}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
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
            const application = applications.find(
              item => `${item.platform}\u0000${item.id}` === applicationId
            )
            if (!application || !selected) return
            const split = setupRef.indexOf(':')
            const existing = automation.rules.find(
              rule =>
                rule.activationId === activationId &&
                rule.application.platform === application.platform &&
                rule.application.id === application.id
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
              ariaLabel={`Enable ${rule.application.displayName} rule`}
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
              <span className="block font-semibold">{rule.application.displayName}</span>
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
