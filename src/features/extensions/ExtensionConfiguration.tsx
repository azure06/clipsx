import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../i18n/index'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { Button, Select } from '../../shared/components/ui'
import type { PackageDetail } from '../settings/extensions/types'
import { SetupConfiguration } from './SetupConfiguration'
import {
  cleanParameters,
  allowSetupChange,
  sameParameters,
  controlClass,
  parameterErrors,
  type SavedSetup,
} from './parameters'

type SourceApplication = { platform: string; id: string; displayName: string }
export type AutomationRule = {
  conditionQuestion?: string | null
  order?: number
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
  useTranslation()

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
      if (!label) setError(i18n.t('desktopUi.enterASetupName'))
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
    if (!window.confirm(i18n.t('desktopUi.deleteThisSetupItsAutomationRulesWillBeDisabled'))) return
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
        <Trans i18nKey="desktopUi.savedSetupsAreReusableChoicesChangesApplyToFuture" />
      </p>
      {detail.transformers.length > 1 && (
        <Select
          label={i18n.t('desktopUi.operation')}
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
              <Trans i18nKey="desktopUi.setupName" />
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
              {selected && !copyMode
                ? i18n.t('desktopUi.saveChanges')
                : i18n.t('desktopUi.saveSetup')}
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
                  <Trans i18nKey="desktopUi.saveAsAnotherSetup" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove(selected)}
                >
                  <Trans i18nKey="desktopUi.deleteSetup" />
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
                <Trans i18nKey="desktopUi.cancel" />
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          <Trans i18nKey="desktopUi.thisExtensionHasNoConfigurableTransformations" />
        </p>
      )}
      {setups.some(item => !item.available) && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold text-slate-500">
            <Trans i18nKey="desktopUi.unavailableSetups" />
          </p>
          {setups
            .filter(item => !item.available)
            .map(item => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1">
                  {item.label} <Trans i18nKey="desktopUi.incompatibleWithTheInstalledOperation" />
                </span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(item)}>
                  <Trans i18nKey="desktopUi.delete" /> {item.label}
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

export { AutomationEditor } from './AutomationEditor'
