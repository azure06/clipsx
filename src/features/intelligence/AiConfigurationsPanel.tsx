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
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Upload,
  Wand2,
  Zap,
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

const surface =
  'rounded-2xl border border-slate-200/70 bg-white/55 shadow-[0_6px_24px_-16px_rgba(15,23,42,.12)] dark:border-white/10 dark:bg-white/[.025]'
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70'

export function AiConfigurationsPanel() {
  const { t } = useTranslation()
  const [state, setState] = useState<AiConfigurationState | null>(null)
  const [selected, setSelected] = useState('usage')
  const [connectionEditor, setConnectionEditor] = useState<AiConnection | null>(null)
  const [modelEditor, setModelEditor] = useState<AiModelPreset | null>(null)
  const [transfer, setTransfer] = useState<'import' | 'export' | null>(null)
  const [models, setModels] = useState<AiDiscoveredModel[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
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
      const code =
        typeof failure === 'object' && failure && 'code' in failure ? String(failure.code) : ''
      setError(t(`modelsWorkspace.failures.${code}`, { defaultValue: t('aiConfig.error') }))
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
      icon: Wand2,
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
      key: 'webSearch',
      icon: Globe2,
      title: t('aiConfig.webConnection'),
      help: t('modelsWorkspace.webHelp'),
    },
  ]
  const navigate = (id: string) => {
    setSelected(id)
    setError(null)
    setFeedback(null)
    setModels([])
  }
  const openConnection = (item: AiConnection) => {
    setError(null)
    setConnectionEditor(item)
  }
  const openModel = (item: AiModelPreset) => {
    setError(null)
    setModels([])
    setModelEditor(item)
  }
  const statusLabel = !connection?.enabled
    ? t('modelsWorkspace.disabled')
    : connection.provider !== 'ollama' && !observation?.credentialConfigured
      ? t('modelsWorkspace.needsCredential')
      : observation?.diagnostic === 'ready'
        ? t('modelsWorkspace.checked')
        : observation?.diagnostic
          ? t('modelsWorkspace.needsAttention')
          : t('modelsWorkspace.notTested')
  return (
    <div role="tabpanel" aria-label={t('desktopUi.models')} className="space-y-4 text-sm">
      <header className="relative overflow-hidden rounded-2xl border border-violet-300/40 bg-linear-to-br from-violet-500/12 via-fuchsia-500/5 to-white/35 p-5 dark:border-violet-400/15 dark:to-white/[.02]">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-violet-400/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500/20 to-fuchsia-500/15 text-violet-600 ring-1 ring-violet-500/15 dark:text-violet-300">
              <Layers3 className="h-5 w-5" strokeWidth={1.5} />
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
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              onClick={() => {
                setError(null)
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
                setTransfer('export')
              }}
            >
              {t('modelsWorkspace.export')}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => openConnection(emptyConnection())}
            >
              {t('modelsWorkspace.addProvider')}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-medium text-violet-700 dark:text-violet-300">
          <span>{t('modelsWorkspace.providersStep')}</span>
          <ArrowRight className="h-3 w-3 opacity-50" />
          <span>{t('modelsWorkspace.modelsStep')}</span>
          <ArrowRight className="h-3 w-3 opacity-50" />
          <span>{t('modelsWorkspace.featuresStep')}</span>
        </div>
      </header>
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
      <div className="grid items-start gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
        <div className="md:hidden [&>div]:w-full">
          <Select
            label={t('modelsWorkspace.navigation')}
            value={selected}
            disabled={busy}
            options={[
              { value: 'usage', label: t('modelsWorkspace.usage') },
              ...current.connections.map(c => ({ value: c.id, label: c.name })),
            ]}
            onChange={navigate}
          />
        </div>
        <nav
          aria-label={t('modelsWorkspace.navigation')}
          className={`${surface} hidden space-y-1 p-2 md:block`}
        >
          <button
            type="button"
            disabled={busy}
            aria-current={selected === 'usage' ? 'page' : undefined}
            onClick={() => navigate('usage')}
            className={`${focus} flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-xs font-medium transition-colors ${selected === 'usage' ? 'bg-linear-to-r from-violet-500/14 to-fuchsia-500/8 text-violet-700 dark:text-violet-200' : 'text-slate-500 hover:bg-slate-500/5'}`}
          >
            <Settings2 className="h-4 w-4 shrink-0" />
            {t('modelsWorkspace.usage')}
          </button>
          <p className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">
            {t('aiConfig.connections')}{' '}
            <span className="ml-1 tabular-nums opacity-60">{current.connections.length}</span>
          </p>
          {current.connections.map(item => (
            <button
              key={item.id}
              type="button"
              disabled={busy}
              aria-current={selected === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
              className={`${focus} flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${selected === item.id ? 'bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'text-slate-600 hover:bg-slate-500/5 dark:text-slate-300'}`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.enabled ? 'bg-violet-400' : 'bg-slate-400'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{item.name}</span>
                <span className="mt-0.5 block text-[10px] text-slate-400">
                  {providerNames[item.provider]}
                </span>
              </span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => openConnection(emptyConnection())}
            className={`${focus} flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-xs text-slate-400 hover:bg-violet-500/5 hover:text-violet-600`}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('modelsWorkspace.addProvider')}
          </button>
        </nav>
        <div className="min-w-0 space-y-4">
          {selected === 'usage' && (
            <section className={`${surface} overflow-hidden`}>
              <div className="border-b border-slate-200/70 p-5 dark:border-white/10">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t('modelsWorkspace.usageTitle')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {t('modelsWorkspace.usageHelp')}
                </p>
              </div>
              <div className="divide-y divide-slate-200/60 dark:divide-white/8">
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
                    <div key={key} className="flex gap-3 p-5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/8 text-violet-500 dark:text-violet-300">
                        <Icon className="h-4 w-4" strokeWidth={1.6} />
                      </span>
                      <div className="min-w-0 flex-1 [&>div]:w-full">
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
                                version: 2,
                                selections: {
                                  ...current.selections,
                                  [key]: id === 'none' ? null : id,
                                },
                              })
                            )
                          }
                        />
                        {!options.length && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const candidate = current.connections.find(c =>
                                purpose === 'decision'
                                  ? c.provider === 'ollama'
                                  : purpose === 'embedding'
                                    ? !['tavily', 'anthropic'].includes(c.provider)
                                    : purpose === 'chat'
                                      ? c.provider !== 'tavily'
                                      : c.provider === 'tavily'
                              )
                              if (candidate) navigate(candidate.id)
                              else {
                                const next = emptyConnection()
                                if (!purpose) {
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
          )}
          {connection && (
            <>
              <section className={`${surface} p-5`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500 dark:text-violet-300">
                    <Server className="h-5 w-5" strokeWidth={1.5} />
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
                        await invoke('ai_discover_models', { connectionId: connection.id })
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
                        {p.purpose === 'decision' && (
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
          {current.connections.length === 0 && (
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
                  version: 2,
                  connections: [...current.connections.filter(c => c.id !== item.id), item],
                })
                if (credential)
                  await invoke('ai_set_credential', { connectionId: item.id, value: credential })
              })
            ) {
              setConnectionEditor(null)
              setSelected(item.id)
              setFeedback(t('modelsWorkspace.saved'))
            }
          }}
        />
      )}
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
                  version: 2,
                  presets: [...current.presets.filter(p => p.id !== preset.id), preset],
                })
              )
            ) {
              setModelEditor(null)
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
      )}
    </div>
  )
}
