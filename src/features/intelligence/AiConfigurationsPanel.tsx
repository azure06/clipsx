import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Download,
  Globe2,
  Layers3,
  ListFilter,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  Sparkles,
  Zap,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Button, Select } from '../../shared/components/ui'
import { DocumentationLink } from '../../shared/components/DocumentationLink'
import type {
  AiConfiguration,
  AiConfigurationState,
  AiConnection,
  AiDiscoveredModel,
  AiModelPreset,
  AiModelPurpose,
  AiSelections,
  DecisionTestResult,
} from '../recall/contracts.generated'
import { emptyConnection, emptyPreset, endpoints, providerNames } from './modelConfiguration'
import { ConnectionEditor } from './ConnectionEditor'
import { ModelEditor } from './ModelEditor'
import { ConfigurationTransfer } from './ConfigurationTransfer'
import { ProviderIcon } from './ProviderIcon'
import { connectionFailureMessage } from './connectionFailure'
import { ConfigurationRemoval, type RemovalTarget } from './ConfigurationRemoval'

const surface =
  'rounded-2xl border border-slate-200/70 bg-white/55 shadow-[0_6px_24px_-16px_rgba(15,23,42,.12)] dark:border-white/10 dark:bg-white/[.025]'
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70'

export function AiConfigurationsPanel() {
  const { t } = useTranslation()
  const [state, setState] = useState<AiConfigurationState | null>(null)
  const [selected, setSelected] = useState('usage')
  const [editAssignments, setEditAssignments] = useState(false)
  const [connectionEditor, setConnectionEditor] = useState<AiConnection | null>(null)
  const [modelEditor, setModelEditor] = useState<AiModelPreset | null>(null)
  const [transfer, setTransfer] = useState<'import' | 'export' | null>(null)
  const [models, setModels] = useState<AiDiscoveredModel[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [removal, setRemoval] = useState<RemovalTarget | null>(null)
  const removalTrigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const focusAfterRemoval = useRef<'provider' | 'model' | null>(null)
  useEffect(() => {
    if (!removal && focusAfterRemoval.current) {
      panel.current
        ?.querySelector<HTMLButtonElement>(`[data-add-${focusAfterRemoval.current}]`)
        ?.focus()
      focusAfterRemoval.current = null
    }
  }, [removal])
  const refresh = useCallback(async () => {
    const next = await invoke<AiConfigurationState>('ai_configuration_state')
    setState(next)
    return next
  }, [])
  useEffect(() => {
    let mounted = true
    void invoke<AiConfigurationState>('ai_configuration_state')
      .then(next => {
        if (mounted) setState(next)
      })
      .catch(() => {
        if (mounted) setError(t('aiConfig.error'))
      })
    return () => {
      mounted = false
    }
  }, [t])
  const perform = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      await operation()
      await refresh()
      return true
    } catch (failure) {
      // A saved connection may precede a failed protected-credential update.
      await refresh().catch(() => undefined)
      setError(connectionFailureMessage(failure, t))
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const apply = (configuration: AiConfiguration) =>
    invoke<AiConfigurationState>('ai_configuration_import', { configuration })
  const current = state?.configuration
  if (!current)
    return (
      <div className={`${surface} p-6`}>
        <p role={error ? 'alert' : 'status'} className="text-xs text-slate-500">
          {error ?? t('aiConfig.loading')}
        </p>
        {error && (
          <Button size="sm" variant="outline" onClick={() => void perform(refresh)}>
            {t('desktopUi.retry')}
          </Button>
        )}
      </div>
    )
  const connection = current.connections.find(c => c.id === selected)
  const observation = state.connectionStates.find(c => c.connectionId === selected)
  const editorConnection =
    modelEditor && current.connections.find(c => c.id === modelEditor.connectionId)
  const assignments: Array<{
    key: keyof AiSelections
    icon: LucideIcon
    title: string
    help: string
    purpose?: AiModelPurpose
  }> = [
    {
      key: 'defaultChat',
      icon: MessageSquare,
      title: t('modelsWorkspace.recall'),
      help: t('modelsWorkspace.recallHelp'),
      purpose: 'chat',
    },
    {
      key: 'activeEmbedding',
      icon: Search,
      title: t('aiConfig.activeEmbedding'),
      help: t('aiConfig.embeddingHelp'),
      purpose: 'embedding',
    },
    {
      key: 'extensionGeneration',
      icon: Sparkles,
      title: t('modelsWorkspace.extensionGeneration'),
      help: t('modelsWorkspace.extensionHelp'),
      purpose: 'chat',
    },
    {
      key: 'defaultDecision',
      icon: BrainCircuit,
      title: t('modelsWorkspace.decision'),
      help: t('modelsWorkspace.decisionHelp'),
      purpose: 'decision',
    },
    {
      key: 'activeRerank',
      icon: ListFilter,
      title: t('modelsWorkspace.rerank'),
      help: t('modelsWorkspace.rerankHelp'),
      purpose: 'rerank',
    },
    {
      key: 'webSearch',
      icon: Globe2,
      title: t('aiConfig.webConnection'),
      help: t('modelsWorkspace.webHelp'),
    },
  ]
  const navigate = (id: string) => {
    setRemoval(null)
    setSelected(id)
    setConnectionEditor(null)
    setModelEditor(null)
    setTransfer(null)
    setError(null)
    setFeedback(null)
    setModels([])
  }
  const openConnection = (item: AiConnection) => {
    setRemoval(null)
    setError(null)
    setModelEditor(null)
    setTransfer(null)
    setConnectionEditor(item)
  }
  const openModel = (item: AiModelPreset) => {
    setRemoval(null)
    setError(null)
    setConnectionEditor(null)
    setTransfer(null)
    setModelEditor(item)
    if (!models.length)
      void perform(async () => {
        setModels(
          await invoke<AiDiscoveredModel[]>('ai_discover_models', {
            connectionId: item.connectionId,
          })
        )
      })
  }
  const home = selected === 'usage' && !connectionEditor && !transfer
  const statusLabel = !connection?.enabled
    ? t('modelsWorkspace.disabled')
    : connection.provider !== 'ollama' && !observation?.credentialConfigured
      ? t('modelsWorkspace.needsCredential')
      : observation?.diagnostic === 'ready'
        ? t('modelsWorkspace.checked')
        : observation?.diagnostic
          ? t('modelsWorkspace.needsAttention')
          : t('modelsWorkspace.notTested')
  const removedIds = new Set(
    removal?.kind === 'connection'
      ? [removal.id, ...current.presets.filter(p => p.connectionId === removal.id).map(p => p.id)]
      : removal
        ? [removal.id]
        : []
  )
  return (
    <div
      ref={panel}
      role="tabpanel"
      aria-label={t('desktopUi.models')}
      className="space-y-4 text-sm"
    >
      {home && (
        <header className="relative overflow-hidden rounded-2xl border border-violet-300/40 bg-linear-to-br from-violet-500/12 via-fuchsia-500/5 to-white/35 p-5 dark:border-violet-400/15 dark:to-white/[.02]">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-violet-400/10 blur-3xl"
          />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500/20 to-fuchsia-500/15 text-violet-600 ring-1 ring-violet-500/15 dark:text-violet-300">
                <Sparkles className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t('modelsWorkspace.title')}
                </h2>
                <p className="mt-1 max-w-md text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {t('modelsWorkspace.description')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <DocumentationLink guide="localAi" label={t('documentation.localAiSetup')} />
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => {
                  setError(null)
                  setConnectionEditor(null)
                  setModelEditor(null)
                  setTransfer('import')
                }}
              >
                {t('modelsWorkspace.import')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || !current.connections.length}
                leftIcon={<Download className="h-3.5 w-3.5" />}
                onClick={() => {
                  setError(null)
                  setConnectionEditor(null)
                  setModelEditor(null)
                  setTransfer('export')
                }}
              >
                {t('modelsWorkspace.export')}
              </Button>
            </div>
          </div>
          <section
            aria-label={t('modelsWorkspace.activeTitle')}
            className="relative mt-5 overflow-hidden rounded-2xl border border-slate-200/60 bg-slate-100/30 p-4 dark:border-white/10 dark:bg-slate-100/5"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {t('modelsWorkspace.activeTitle')}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setEditAssignments(!editAssignments)}
              >
                {t(editAssignments ? 'common.close' : 'modelsWorkspace.edit')}
              </Button>
            </div>
            <div className="grid sm:grid-cols-2">
              {assignments.map(({ key, icon: Icon, title, help, purpose }) => {
                const options = purpose
                  ? current.presets
                      .filter(
                        p =>
                          p.purpose === purpose &&
                          current.connections.some(c => c.id === p.connectionId && c.enabled)
                      )
                      .map(p => ({
                        value: p.id,
                        label: `${current.connections.find(c => c.id === p.connectionId)?.name} / ${p.name}`,
                      }))
                  : current.connections
                      .filter(c => c.enabled && c.provider === 'tavily')
                      .map(c => ({ value: c.id, label: c.name }))
                const value = current.selections[key] ?? 'none'
                if (value !== 'none' && !options.some(o => o.value === value))
                  options.push({
                    value,
                    label: t('modelsWorkspace.unavailableAssignment', {
                      name:
                        current.presets.find(p => p.id === value)?.name ??
                        current.connections.find(c => c.id === value)?.name ??
                        value,
                    }),
                  })
                return (
                  <div key={key} className="flex gap-3 p-4">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/8 text-violet-500 dark:text-violet-300">
                      <Icon className="h-4 w-4" strokeWidth={1.6} />
                    </span>
                    <div className="min-w-0 flex-1 [&>div]:w-full">
                      {editAssignments ? (
                        <Select
                          label={title}
                          helpText={help}
                          value={value}
                          disabled={busy}
                          options={[{ value: 'none', label: t('aiConfig.none') }, ...options]}
                          onChange={id =>
                            void perform(() =>
                              apply({
                                ...current,
                                version: 3,
                                selections: {
                                  ...current.selections,
                                  [key]: id === 'none' ? null : id,
                                },
                              })
                            )
                          }
                        />
                      ) : (
                        <div>
                          <p className="text-[11px] font-medium text-slate-500">{title}</p>
                          <p className="mt-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                            {options.find(option => option.value === value)?.label ??
                              t('aiConfig.none')}
                          </p>
                        </div>
                      )}
                      {editAssignments && !options.length && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const candidate = current.connections.find(c =>
                              purpose === 'decision'
                                ? ['ollama', 'openrouter'].includes(c.provider)
                                : purpose === 'rerank'
                                  ? c.provider === 'openrouter'
                                  : purpose === 'embedding'
                                    ? !['tavily', 'anthropic'].includes(c.provider)
                                    : purpose === 'chat'
                                      ? c.provider !== 'tavily'
                                      : c.provider === 'tavily'
                            )
                            if (candidate) navigate(candidate.id)
                            else {
                              const next = emptyConnection()
                              if (purpose === 'rerank') {
                                next.provider = 'openrouter'
                                next.baseUrl = endpoints.openrouter
                              } else if (!purpose) {
                                next.provider = 'tavily'
                                next.baseUrl = endpoints.tavily
                              }
                              openConnection(next)
                            }
                          }}
                          className={`${focus} mt-2 rounded text-xs font-medium text-violet-600 dark:text-violet-300`}
                        >
                          {t('modelsWorkspace.configureModel')} <span aria-hidden>→</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </header>
      )}
      {(connection || connectionEditor || transfer) && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => navigate('usage')}>
          ← {t('modelsWorkspace.allConfigurations')}
        </Button>
      )}{' '}
      {removal && (
        <ConfigurationRemoval
          target={removal}
          busy={busy}
          affectedFeatures={assignments
            .filter(a => removedIds.has(current.selections[a.key] ?? ''))
            .map(a => a.title)}
          modelCount={current.presets.filter(p => p.connectionId === removal.id).length}
          onCancel={() => {
            setRemoval(null)
            removalTrigger.current?.focus()
          }}
          onConfirm={async () => {
            if (
              await perform(() =>
                invoke('ai_configuration_remove', {
                  connectionId: removal.kind === 'connection' ? removal.id : null,
                  presetId: removal.kind === 'preset' ? removal.id : null,
                })
              )
            ) {
              focusAfterRemoval.current = removal.kind === 'connection' ? 'provider' : 'model'
              if (removal.kind === 'connection') navigate('usage')
              else setRemoval(null)
              setFeedback(t('modelsWorkspace.removed'))
            }
          }}
        />
      )}
      {Boolean(state.pendingCredentialRemovals) && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-500/8 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          <p>{t('modelsWorkspace.credentialRemovalPending')}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void perform(() => invoke('ai_configuration_retry_cleanup'))}
          >
            {t('desktopUi.retry')}
          </Button>
        </div>
      )}
      {!connectionEditor && !modelEditor && !transfer && error && (
        <p
          role="alert"
          className="rounded-xl bg-red-500/8 p-3 text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      {feedback && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl bg-emerald-500/8 p-3 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {feedback}
        </p>
      )}
      <div>
        <div className="min-w-0 space-y-4">
          {selected === 'usage' && !connectionEditor && !transfer && (
            <section className={`${surface} overflow-hidden`}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/60 p-5 dark:border-white/10">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t('modelsWorkspace.savedTitle')}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">{t('modelsWorkspace.savedHelp')}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => openConnection(emptyConnection())}
                  data-add-provider
                >
                  {t('modelsWorkspace.addProvider')}
                </Button>
              </div>
              <div className="divide-y divide-slate-200/60 dark:divide-white/8">
                {current.connections.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-4 sm:px-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/8 text-violet-500">
                      <ProviderIcon provider={item.provider} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                        {item.name}{' '}
                        <span className="ml-2 text-[10px] font-normal text-slate-400">
                          {providerNames[item.provider]}
                        </span>
                      </p>
                      <p className="mt-1 truncate text-[11px] text-slate-500">{item.baseUrl}</p>
                      <p className="mt-1 text-[10px] text-violet-500">
                        {t('modelsWorkspace.modelCount', {
                          count: current.presets.filter(p => p.connectionId === item.id).length,
                        })}{' '}
                        · {t(item.enabled ? 'aiConfig.enabled' : 'modelsWorkspace.disabled')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => navigate(item.id)}
                    >
                      {t('modelsWorkspace.manage')} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {connectionEditor && (
            <ConnectionEditor
              key={connectionEditor.id}
              initial={connectionEditor}
              saved={current.connections.some(c => c.id === connectionEditor.id)}
              credentialConfigured={state.connectionStates.some(
                c => c.connectionId === connectionEditor.id && c.credentialConfigured
              )}
              busy={busy}
              error={error}
              onClose={() => {
                setConnectionEditor(null)
                setError(null)
              }}
              onRemoveCredential={() =>
                perform(() =>
                  invoke('ai_set_credential', { connectionId: connectionEditor.id, value: null })
                ).then(() => undefined)
              }
              onSave={async (item, credential) => {
                if (
                  await perform(async () => {
                    await apply({
                      ...current,
                      version: 3,
                      connections: [...current.connections.filter(c => c.id !== item.id), item],
                    })
                    if (credential)
                      await invoke('ai_set_credential', {
                        connectionId: item.id,
                        value: credential,
                      })
                  })
                ) {
                  setConnectionEditor(null)
                  setSelected(item.id)
                  setFeedback(t('modelsWorkspace.saved'))
                }
              }}
            />
          )}
          {transfer && (
            <ConfigurationTransfer
              mode={transfer}
              current={current}
              state={state}
              busy={busy}
              error={error}
              perform={perform}
              onClose={() => {
                setTransfer(null)
                setError(null)
              }}
              onImported={() => {
                setTransfer(null)
                setFeedback(t('modelsWorkspace.imported'))
              }}
            />
          )}{' '}
          {modelEditor && editorConnection && (
            <ModelEditor
              key={modelEditor.id}
              initial={modelEditor}
              connection={editorConnection}
              models={models}
              busy={busy}
              error={error}
              onClose={() => {
                setModelEditor(null)
                setError(null)
              }}
              onDiscover={() =>
                perform(async () => {
                  setModels(
                    await invoke<AiDiscoveredModel[]>('ai_discover_models', {
                      connectionId: editorConnection.id,
                    })
                  )
                }).then(() => undefined)
              }
              onSave={async preset => {
                if (
                  await perform(() =>
                    apply({
                      ...current,
                      version: 3,
                      presets: [...current.presets.filter(p => p.id !== preset.id), preset],
                    })
                  )
                ) {
                  setModelEditor(null)
                  setFeedback(t('modelsWorkspace.saved'))
                }
              }}
            />
          )}{' '}
          {connection && !connectionEditor && !modelEditor && !transfer && (
            <>
              <section className={`${surface} p-5`}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500 dark:text-violet-300">
                    <ProviderIcon provider={connection.provider} className="h-6 w-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {connection.name}
                      </h3>
                      <span className="rounded-md bg-slate-500/7 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {providerNames[connection.provider]}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                      {connection.baseUrl}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={t('modelsWorkspace.editProvider')}
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => openConnection(connection)}
                  >
                    {t('modelsWorkspace.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={t('modelsWorkspace.removeProvider', { name: connection.name })}
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={event => {
                      removalTrigger.current = event.currentTarget
                      setRemoval({ kind: 'connection', id: connection.id, name: connection.name })
                    }}
                  >
                    {t('modelsWorkspace.remove')}
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/60 pt-3 dark:border-white/8">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${observation?.diagnostic === 'ready' ? 'bg-emerald-500' : 'bg-slate-400'}`}
                    />
                    {statusLabel}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !connection.enabled || connection.provider === 'tavily'}
                    onClick={() =>
                      void perform(async () => {
                        setModels(
                          await invoke<AiDiscoveredModel[]>('ai_discover_models', {
                            connectionId: connection.id,
                          })
                        )
                        setFeedback(t('modelsWorkspace.connectionChecked'))
                      })
                    }
                  >
                    {t('modelsWorkspace.testConnection')}
                  </Button>
                </div>
                {connection.provider === 'ollama' && (
                  <div className="mt-3">
                    <DocumentationLink guide="localAi" label={t('documentation.localAiSetup')} />
                  </div>
                )}
                {observation?.diagnostic && observation.diagnostic !== 'ready' && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                    {t(`aiConfig.diagnostics.${observation.diagnostic}`, {
                      defaultValue: t('aiConfig.error'),
                    })}
                  </p>
                )}
              </section>
              {connection.provider !== 'tavily' && (
                <section className={`${surface} overflow-hidden`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 px-5 py-4 dark:border-white/8">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <Zap className="h-3.5 w-3.5 text-violet-500" />
                      {t('modelsWorkspace.configuredModels')}
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      leftIcon={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => openModel(emptyPreset(connection.id))}
                      data-add-model
                    >
                      {t('modelsWorkspace.addModel')}
                    </Button>
                  </div>

                  {current.presets
                    .filter(p => p.connectionId === connection.id)
                    .map(p => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center gap-3 border-b border-slate-200/50 px-5 py-4 last:border-0 dark:border-white/6"
                      >
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {p.name}
                          </h4>
                          <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
                            {p.modelId}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-md bg-violet-500/8 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                              {t(
                                p.purpose === 'decision'
                                  ? 'modelsWorkspace.decision'
                                  : p.purpose === 'rerank'
                                    ? 'modelsWorkspace.rerank'
                                    : `aiConfig.${p.purpose}`
                              )}
                            </span>
                            {p.capabilities.tools && (
                              <span className="text-[10px] text-slate-400">
                                {t('modelsWorkspace.tools')}
                              </span>
                            )}
                            {p.capabilities.vision && (
                              <span className="text-[10px] text-slate-400">
                                {t('modelsWorkspace.vision')}
                              </span>
                            )}
                            {assignments
                              .filter(a => current.selections[a.key] === p.id)
                              .map(a => (
                                <span
                                  key={a.key}
                                  className="rounded-md bg-emerald-500/8 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300"
                                >
                                  {a.title}
                                </span>
                              ))}
                          </div>
                        </div>
                        {p.purpose === 'decision' && connection.provider === 'ollama' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || !connection.enabled}
                            onClick={() =>
                              void perform(async () => {
                                const result = await invoke<DecisionTestResult>(
                                  'ai_test_decision',
                                  { presetId: p.id }
                                )
                                setFeedback(
                                  t('modelsWorkspace.decisionResult', {
                                    choice: t(`modelsWorkspace.choices.${result.choice}`, {
                                      defaultValue: result.choice,
                                    }),
                                    confidence: Math.round(result.confidence * 100),
                                  })
                                )
                              })
                            }
                          >
                            {t('modelsWorkspace.testDecision')}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={t('modelsWorkspace.editModel', { name: p.name })}
                          onClick={() => openModel(p)}
                        >
                          {t('modelsWorkspace.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={t('modelsWorkspace.removeModel', { name: p.name })}
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={event => {
                            removalTrigger.current = event.currentTarget
                            setRemoval({ kind: 'preset', id: p.id, name: p.name })
                          }}
                        >
                          {t('modelsWorkspace.remove')}
                        </Button>
                      </div>
                    ))}
                  {!current.presets.some(p => p.connectionId === connection.id) && (
                    <div className="px-6 py-10 text-center">
                      <Layers3
                        className="mx-auto mb-3 h-7 w-7 text-violet-400/60"
                        strokeWidth={1.3}
                      />
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        {t('modelsWorkspace.noModels')}
                      </p>
                      <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-slate-400">
                        {t('modelsWorkspace.noModelsHelp')}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-3"
                        disabled={busy}
                        onClick={() => openModel(emptyPreset(connection.id))}
                      >
                        {t('modelsWorkspace.addModel')}
                      </Button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          {home && current.connections.length === 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-violet-300/50 bg-violet-500/4 p-4 dark:border-violet-400/20">
              <Plus className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
              <p className="text-xs leading-5 text-slate-500">{t('modelsWorkspace.emptyHelp')}</p>
            </div>
          )}
          <p className="flex items-start gap-2 px-1 text-[10px] leading-4 text-slate-400">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('modelsWorkspace.localConfig')}
          </p>
        </div>
      </div>
    </div>
  )
}
