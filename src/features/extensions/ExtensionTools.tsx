import { invoke } from '@tauri-apps/api/core'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Pin, Play, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../shared/components/ui'
import { useUIStore } from '../../stores/uiStore'
import { ExtensionOperationIcon, type PinnedOperation } from '../clipboard/ExtensionOperationIcon'
import type { ContextAction, Transformer } from '../clipboard/useTransformState'
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

type Selection = {
  transformer: Transformer
  builtinId?: string
  saved?: SavedSetup
  sourceId?: string | null
}
type Entry = {
  id: string
  packageId: string
  label: string
  transformer?: Transformer
  action?: ContextAction
  icon: PinnedOperation
}

export function ExtensionTools({
  clipId,
  sourceId,
  transformers,
  actions,
  runAction,
  onClose,
  onQueued,
  pinnedIds = [],
  onTogglePin,
  initialOperationId,
}: {
  clipId: string
  sourceId: string
  transformers: Transformer[]
  actions: ContextAction[]
  runAction: (id: string) => void
  onClose: () => void
  onQueued: (id: string) => void
  pinnedIds?: string[]
  onTogglePin?: (operation: PinnedOperation) => void
  initialOperationId?: string | null
}) {
  const openSettings = useUIStore(state => state.openExtensionSettings)
  const setActiveView = useUIStore(state => state.setActiveView)
  const [setups, setSetups] = useState<SavedSetup[]>([])
  const [packageId, setPackageId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [defaultView, setDefaultView] = useState<'result_only' | 'compare'>('result_only')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveMode, setSaveMode] = useState<'new' | 'automation' | null>(null)
  const [name, setName] = useState('')
  const handledPin = useRef<string | null>(null)
  const refresh = useCallback(
    async () => setSetups(await invoke<SavedSetup[]>('list_extension_transform_setups')),
    []
  )
  useEffect(() => {
    void refresh().catch(reason => setError(String(reason)))
  }, [refresh])
  const entries = useMemo<Entry[]>(
    () => [
      ...transformers.map(transformer => ({
        id: transformer.id,
        packageId: transformer.packageId,
        label: transformer.label,
        transformer,
        icon: {
          id: `custom:${transformer.id}`,
          packageId: transformer.packageId,
          label: transformer.label,
          kind: 'transformer' as const,
          icon: transformer.icon ?? null,
          iconSvg: transformer.iconSvg ?? null,
          iconSvgDark: transformer.iconSvgDark ?? null,
          iconScale: transformer.iconScale ?? 1,
        },
      })),
      ...actions.map(action => ({
        id: action.id,
        packageId: action.packageId,
        label: action.label,
        action,
        icon: {
          id: `action:${action.id}`,
          packageId: action.packageId,
          label: action.label,
          kind: 'action' as const,
          icon: action.icon,
          iconSvg: action.iconSvg,
          iconSvgDark: action.iconSvgDark,
          iconScale: action.iconScale,
        },
      })),
    ],
    [transformers, actions]
  )
  const choose = useCallback(
    (transformer: Transformer, reference?: string) => {
      const saved = reference?.startsWith('saved:')
        ? setups.find(item => item.id === reference.slice(6))
        : undefined
      const builtin =
        transformer.setups.find(item => item.id === reference) ??
        (!reference
          ? transformer.setups.find(
              item => transformer.setupAvailability[item.id]?.state !== 'hidden'
            )
          : undefined)
      const decision = saved
        ? transformer.setupAvailability[`saved:${saved.id}`]
        : builtin
          ? transformer.setupAvailability[builtin.id]
          : transformer.customAvailability
      setPackageId(transformer.packageId)
      setSelection({
        transformer,
        saved,
        builtinId: builtin?.id,
        sourceId: decision?.sourceId ?? transformer.sourceId,
      })
      setValues(
        cleanParameters(
          transformer.parameterSchema,
          transformer.parameterUi ?? [],
          saved?.parameters ?? builtin?.parameters ?? {}
        )
      )
      setDefaultView(saved?.defaultView ?? builtin?.defaultView ?? transformer.defaultView)
      setName(saved?.label ?? '')
      setSaveMode(null)
      setErrors({})
      setError(null)
    },
    [setups]
  )
  useEffect(() => {
    if (!initialOperationId || handledPin.current === initialOperationId) return
    const transformer = transformers.find(
      item =>
        initialOperationId.startsWith(`setup:${item.id}:`) ||
        initialOperationId === `custom:${item.id}` ||
        setups.some(
          saved => initialOperationId === `saved:${saved.id}` && saved.transformerId === item.id
        )
    )
    if (transformer) {
      handledPin.current = initialOperationId
      choose(
        transformer,
        initialOperationId.startsWith('saved:')
          ? initialOperationId
          : initialOperationId.startsWith('setup:')
            ? initialOperationId.slice(`setup:${transformer.id}:`.length)
            : undefined
      )
    }
  }, [initialOperationId, transformers, setups, choose])
  const groups = [...new Set(entries.map(item => item.packageId))]
    .map(id => {
      const children = entries.filter(item => item.packageId === id)
      const transformer = children.find(item => item.transformer)?.transformer
      return {
        id,
        label: transformer?.packageLabel ?? humanLabel(id.split('.').at(-1) ?? id),
        children,
      }
    })
    .filter(group =>
      [
        group.label,
        ...group.children.flatMap(item => [
          item.label,
          ...(item.transformer?.setups.map(setup => setup.displayName) ?? []),
          ...setups.filter(setup => setup.transformerId === item.id).map(setup => setup.label),
        ]),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase())
    )
  const openPackage = (id: string) => {
    const children = entries.filter(item => item.packageId === id)
    setPackageId(id)
    if (children.length === 1 && children[0]?.transformer) choose(children[0].transformer)
    else setSelection(null)
  }
  const transformer =
    transformers.find(item => item.id === selection?.transformer.id) ?? selection?.transformer
  const builtin = transformer?.setups.find(item => item.id === selection?.builtinId)
  const label = selection?.saved?.label ?? builtin?.displayName ?? transformer?.label ?? ''
  const baseline = transformer
    ? cleanParameters(
        transformer.parameterSchema,
        transformer.parameterUi ?? [],
        selection?.saved?.parameters ?? builtin?.parameters ?? {}
      )
    : {}
  const clean = transformer
    ? cleanParameters(transformer.parameterSchema, transformer.parameterUi ?? [], values)
    : {}
  const dirty =
    !sameParameters(clean, baseline) ||
    defaultView !==
      (selection?.saved?.defaultView ?? builtin?.defaultView ?? transformer?.defaultView)
  const identity = selection?.saved
    ? `saved:${selection.saved.id}`
    : builtin
      ? `setup:${transformer?.id}:${builtin.id}`
      : `custom:${transformer?.id}`
  const selectedEntry = entries.find(item => item.id === transformer?.id)
  const pin = selectedEntry ? { ...selectedEntry.icon, id: identity, label } : null
  const decision = transformer
    ? (transformer.setupAvailability[
        selection?.saved ? `saved:${selection.saved.id}` : (selection?.builtinId ?? '')
      ] ?? transformer.customAvailability)
    : null
  const validate = () => {
    if (!transformer) return false
    const next = parameterErrors(transformer.parameterSchema, transformer.parameterUi ?? [], values)
    setErrors(next)
    return Object.keys(next).length === 0
  }
  const navigateAutomation = (kind: 'builtin' | 'saved', reference: string) => {
    if (!transformer) return
    openSettings({
      packageId: transformer.packageId,
      section: 'automation',
      transformerId: transformer.id,
      setupKind: kind,
      setupRef: reference,
    })
    onClose()
  }
  const save = async (copy: boolean, automation = false) => {
    if (!transformer || !validate()) return
    if (!name.trim()) {
      setError('Enter a setup name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await invoke<SavedSetup>('save_extension_transform_setup', {
        id: !copy ? (selection?.saved?.id ?? null) : null,
        expectedRevision: !copy ? (selection?.saved?.revision ?? null) : null,
        transformerId: transformer.id,
        label: name.trim(),
        parameters: clean,
        defaultView,
      })
      await refresh()
      setSelection({ ...selection, transformer, saved, builtinId: undefined })
      setSaveMode(null)
      window.dispatchEvent(new Event('clipsx-extension-permissions-changed'))
      if (automation) navigateAutomation('saved', saved.id)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  const run = async () => {
    if (!transformer || !validate()) return
    setBusy(true)
    setError(null)
    try {
      if (transformer.consentRequired) {
        if (
          !window.confirm(
            `${transformer.label} will use its declared capabilities with the selected clip. Allow this package release?`
          )
        )
          return
        await invoke('grant_extension_transformer_permissions', { transformerId: transformer.id })
        window.dispatchEvent(new Event('clipsx-extension-permissions-changed'))
      }
      const boundSource = selection?.sourceId ?? transformer.sourceId ?? sourceId
      const invocation =
        transformer.execution === 'capability_backed'
          ? await invoke<{ token: string }>('issue_extension_transformer_invocation', {
              transformerId: transformer.id,
              clipId,
              sourceId: boundSource,
            })
          : null
      const result = await invoke<{ jobId: string }>('enqueue_extension_transform', {
        request: {
          clipId,
          sourceId: boundSource,
          transformerId: transformer.id,
          parameters: clean,
          setupId: selection?.saved && !dirty ? selection.saved.id : null,
          defaultView,
          requestId: crypto.randomUUID(),
          invocationToken: invocation?.token ?? null,
        },
      })
      onQueued(result.jobId)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  const manageAutomation = () => {
    if (!transformer || !validate()) return
    if (!dirty && selection?.saved) navigateAutomation('saved', selection.saved.id)
    else if (!dirty && builtin) navigateAutomation('builtin', builtin.id)
    else {
      setSaveMode('automation')
      setName(selection?.saved?.label ?? '')
      setError(null)
    }
  }
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Clip tools">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/65 px-3 py-2 dark:border-white/10 dark:bg-white/[.035]">
        {packageId && (
          <button
            type="button"
            aria-label="Back to tools"
            onClick={() => {
              setPackageId(null)
              setSelection(null)
            }}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {packageId
            ? (groups.find(group => group.id === packageId)?.label ??
              humanLabel(packageId.split('.').at(-1) ?? packageId))
            : 'Tools'}
        </Dialog.Title>
        <Dialog.Close
          aria-label="Close tools"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <X className="h-4 w-4" />
        </Dialog.Close>
      </header>
      <Dialog.Description className="sr-only">
        Choose an extension, configure a setup, and run it on this clip.
      </Dialog.Description>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!packageId ? (
          <>
            <label className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 px-2 dark:border-white/10">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                aria-label="Search tools"
                placeholder="Search extensions or setups…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
              />
            </label>
            {groups.length ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
                {groups.map(group => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => openPackage(group.id)}
                    className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/70 p-3 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:border-white/10 dark:bg-white/[.035] dark:hover:bg-violet-400/[.06]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
                      <ExtensionOperationIcon operation={group.children[0]!.icon} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                        {group.label}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-500">
                        {group.children.length === 1
                          ? group.children[0]?.transformer
                            ? 'Choose a setup'
                            : group.children[0]?.label
                          : `${group.children.length} operations`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-slate-500">
                No tools match this clip or search.
              </p>
            )}
          </>
        ) : !transformer ? (
          <div className="space-y-2">
            {entries
              .filter(entry => entry.packageId === packageId)
              .map(entry => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-white/10"
                >
                  <button
                    type="button"
                    disabled={entry.action ? !entry.action.available : false}
                    onClick={() =>
                      entry.transformer
                        ? choose(entry.transformer)
                        : entry.action && runAction(entry.action.id)
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50"
                  >
                    <ExtensionOperationIcon operation={entry.icon} />
                    <span>
                      <span className="block font-semibold">{entry.label}</span>
                      {entry.action?.unavailableReason && (
                        <span className="text-[11px] text-slate-500">
                          {entry.action.unavailableReason}
                        </span>
                      )}
                    </span>
                  </button>
                  {entry.action && onTogglePin && (
                    <button
                      type="button"
                      aria-label={`${pinnedIds.includes(entry.icon.id) ? 'Unpin' : 'Pin'} ${entry.label}`}
                      onClick={() => onTogglePin(entry.icon)}
                      aria-pressed={pinnedIds.includes(entry.icon.id)}
                      className={`rounded p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${pinnedIds.includes(entry.icon.id) ? 'text-amber-500' : 'text-slate-500'}`}
                    >
                      <Pin className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {!transformer.providerAvailable && (
              <p
                role="alert"
                className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200"
              >
                A generation model is not configured.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setActiveView('intelligence')
                    onClose()
                  }}
                >
                  Configure Local Text Generation
                </button>
              </p>
            )}
            {transformer.consentRequired && (
              <p className="text-[11px] text-slate-500">
                Permission is required for this package release. ClipsX will ask before running.
              </p>
            )}
            {decision?.state === 'disabled' && (
              <p role="alert" className="text-xs text-amber-700 dark:text-amber-200">
                {decision.reason}
              </p>
            )}
            <SetupConfiguration
              transformer={{
                ...transformer,
                setups: transformer.setups.filter(
                  setup => transformer.setupAvailability[setup.id]?.state !== 'hidden'
                ),
              }}
              setups={setups.filter(
                setup =>
                  setup.transformerId === transformer.id &&
                  transformer.setupAvailability[`saved:${setup.id}`]?.state !== 'hidden'
              )}
              reference={
                selection?.saved
                  ? `saved:${selection.saved.id}`
                  : (selection?.builtinId ?? 'default')
              }
              values={values}
              view={defaultView}
              errors={errors}
              disabled={busy}
              onSelect={reference => {
                if (allowSetupChange(dirty))
                  choose(transformer, reference === 'default' ? undefined : reference)
              }}
              onChange={next => {
                setValues(next)
                setErrors({})
              }}
              onViewChange={setDefaultView}
              accessory={
                pin && onTogglePin ? (
                  <button
                    type="button"
                    aria-label={`${pinnedIds.includes(pin.id) ? 'Unpin' : 'Pin'} ${label}`}
                    disabled={dirty}
                    title={dirty ? 'Save these choices before pinning them' : `Pin ${label}`}
                    aria-pressed={pinnedIds.includes(pin.id)}
                    onClick={() => onTogglePin(pin)}
                    className={`rounded-lg p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40 ${pinnedIds.includes(pin.id) ? 'text-amber-500' : 'text-slate-500'}`}
                  >
                    <Pin className="h-4 w-4" />
                  </button>
                ) : undefined
              }
            />
            {saveMode ? (
              <div className="grid gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                <p className="text-[11px] text-slate-500">
                  {saveMode === 'automation'
                    ? 'Save these choices so automation can reuse them.'
                    : 'Create a reusable setup.'}
                </p>
                <label className="grid gap-1.5 text-xs font-semibold">
                  Setup name
                  <input
                    aria-label="Saved setup name"
                    className={controlClass}
                    maxLength={80}
                    value={name}
                    onChange={event => setName(event.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !name.trim()}
                    onClick={() =>
                      void save(saveMode === 'new' || !selection?.saved, saveMode === 'automation')
                    }
                  >
                    {saveMode === 'automation' ? 'Save and continue' : 'Save setup'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSaveMode(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selection?.saved ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void save(false)}
                    >
                      Save changes
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSaveMode('new')
                        setName('')
                      }}
                    >
                      Save as another setup
                    </Button>
                    <button
                      type="button"
                      aria-label="Delete saved setup"
                      className="rounded-lg p-2 text-slate-500 hover:text-red-600"
                      onClick={() => {
                        if (
                          !window.confirm(
                            'Delete this setup? Its automation rules will be disabled. Existing results stay available.'
                          )
                        )
                          return
                        void invoke('delete_extension_transform_setup', { id: selection.saved?.id })
                          .then(async () => {
                            await refresh()
                            choose(transformer)
                            window.dispatchEvent(new Event('clipsx-extension-permissions-changed'))
                          })
                          .catch(reason => setError(String(reason)))
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSaveMode('new')
                      setName('')
                    }}
                  >
                    Save setup
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={manageAutomation}>
                  Manage automation
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {transformer && (
        <footer className="flex shrink-0 items-center justify-between border-t border-slate-200/70 px-3 py-2 dark:border-white/10">
          <span className="text-[11px] text-slate-500">Original clip stays unchanged</span>
          <Button
            size="sm"
            leftIcon={<Play className="h-3.5 w-3.5" />}
            isLoading={busy}
            disabled={busy || !transformer.providerAvailable || decision?.state === 'disabled'}
            onClick={() => void run()}
          >
            Run
          </Button>
        </footer>
      )}
      {error && (
        <p
          role="alert"
          className="border-t border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </section>
  )
}
