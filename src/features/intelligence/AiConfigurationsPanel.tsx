import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button, Input, Select, Switch } from '../../shared/components/ui'
import type {
  AiConfiguration,
  AiConfigurationState,
  AiConnection,
  AiDiscoveredModel,
  AiModelPreset,
  AiProviderKind,
} from '../recall/contracts.generated'

const endpoints: Record<AiProviderKind, string> = {
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  tavily: 'https://api.tavily.com',
}
const providers: AiProviderKind[] = [
  'ollama',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'tavily',
]
const emptyConnection = (): AiConnection => ({
  id: crypto.randomUUID(),
  name: '',
  provider: 'ollama',
  baseUrl: endpoints.ollama,
  enabled: true,
  options: { organization: null, project: null },
})
const emptyPreset = (connectionId: string): AiModelPreset => ({
  id: crypto.randomUUID(),
  name: '',
  connectionId,
  modelId: '',
  purpose: 'chat',
  contextLimit: 32768,
  outputLimit: 4096,
  options: { temperature: null, openai: null, anthropic: null, gemini: null, embedding: null },
  capabilities: { tools: null, vision: null, webSearch: null, source: null },
})

export function AiConfigurationsPanel() {
  const { t } = useTranslation()
  const [state, setState] = useState<AiConfigurationState | null>(null)
  const [connection, setConnection] = useState(emptyConnection)
  const [preset, setPreset] = useState(() => emptyPreset(''))
  const [credential, setCredential] = useState('')
  const [models, setModels] = useState<AiDiscoveredModel[]>([])
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const refresh = useCallback(async () => {
    const next = await invoke<AiConfigurationState>('ai_configuration_state')
    setState(next)
    return next
  }, [])
  useEffect(() => {
    void refresh().catch(() => setError(true))
  }, [refresh])
  const perform = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      await operation()
      await refresh()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const apply = (configuration: AiConfiguration) =>
    invoke<AiConfigurationState>('ai_configuration_import', { configuration })
  const current = state?.configuration
  const savedConnection = current?.connections.find(c => c.id === connection.id)
  const connectionState = state?.connectionStates.find(c => c.connectionId === connection.id)
  const chooseConnection = (item: AiConnection) => {
    setConnection(item)
    setCredential('')
    setModels([])
    setPreset(emptyPreset(item.id))
  }
  const saveConnection = () =>
    perform(async () => {
      if (!current) return
      const connections = [...current.connections.filter(c => c.id !== connection.id), connection]
      await apply({ ...current, connections })
      if (credential) {
        const value = credential
        setCredential('')
        await invoke('ai_set_credential', { connectionId: connection.id, value })
      }
      setPreset(emptyPreset(connection.id))
    })
  const savePreset = () =>
    perform(async () => {
      if (current)
        await apply({
          ...current,
          presets: [...current.presets.filter(p => p.id !== preset.id), preset],
        })
    })
  const selectPreset = (id: string, kind: 'defaultChat' | 'activeEmbedding') =>
    perform(async () => {
      if (current)
        await apply({
          ...current,
          selections: { ...current.selections, [kind]: id === 'none' ? null : id },
        })
    })
  if (!current)
    return (
      <p role="status" className="text-xs text-gray-500">
        {t(error ? 'aiConfig.error' : 'aiConfig.loading')}
      </p>
    )
  const chats = current.presets.filter(p => p.purpose === 'chat')
  const embeddings = current.presets.filter(p => p.purpose === 'embedding')
  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-gray-500">{t('aiConfig.description')}</p>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t('aiConfig.error')}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={t('aiConfig.defaultChat')}
          value={current.selections.defaultChat ?? 'none'}
          options={[
            { value: 'none', label: t('aiConfig.none') },
            ...chats.map(p => ({ value: p.id, label: p.name })),
          ]}
          disabled={busy}
          onChange={id => void selectPreset(id, 'defaultChat')}
        />
        <Select
          label={t('aiConfig.activeEmbedding')}
          value={current.selections.activeEmbedding ?? 'none'}
          options={[
            { value: 'none', label: t('aiConfig.none') },
            ...embeddings.map(p => ({ value: p.id, label: p.name })),
          ]}
          disabled={busy}
          onChange={id => void selectPreset(id, 'activeEmbedding')}
          helpText={t('aiConfig.embeddingHelp')}
        />
        <Select
          label={t('aiConfig.webConnection')}
          value={current.selections.webSearch ?? 'none'}
          options={[
            { value: 'none', label: t('aiConfig.none') },
            ...current.connections
              .filter(c => c.provider === 'tavily')
              .map(c => ({ value: c.id, label: c.name })),
          ]}
          disabled={busy}
          onChange={id =>
            void perform(async () =>
              apply({
                ...current,
                selections: { ...current.selections, webSearch: id === 'none' ? null : id },
              })
            )
          }
        />
      </div>
      <section className="space-y-3 rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('aiConfig.connections')}</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => chooseConnection(emptyConnection())}
          >
            {t('aiConfig.newConnection')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {current.connections.map(item => (
            <Button
              key={item.id}
              size="sm"
              variant={item.id === connection.id ? 'primary' : 'ghost'}
              onClick={() => chooseConnection(item)}
              disabled={busy}
            >
              {item.name}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t('aiConfig.name')}
            value={connection.name}
            maxLength={128}
            onChange={value => setConnection({ ...connection, name: value })}
          />
          <Select
            label={t('aiConfig.provider')}
            value={connection.provider}
            disabled={Boolean(savedConnection) || busy}
            options={providers.map(value => ({
              value,
              label:
                value === 'openai'
                  ? 'OpenAI'
                  : value === 'openrouter'
                    ? 'OpenRouter'
                    : value.charAt(0).toUpperCase() + value.slice(1),
            }))}
            onChange={provider => {
              setModels([])
              setConnection({
                ...connection,
                provider,
                baseUrl: endpoints[provider],
                options: { organization: null, project: null },
              })
            }}
          />
          <Input
            label={t('aiConfig.endpoint')}
            value={connection.baseUrl}
            onChange={value => setConnection({ ...connection, baseUrl: value })}
          />
          <Input
            label={t('aiConfig.credential')}
            type="password"
            autoComplete="new-password"
            value={credential}
            onChange={value => setCredential(value)}
            helperText={t(
              connectionState?.credentialConfigured
                ? 'aiConfig.credentialSaved'
                : 'aiConfig.credentialHelp'
            )}
          />
          {connection.provider === 'openai' && (
            <>
              <Input
                label={t('aiConfig.organization')}
                value={connection.options.organization ?? ''}
                onChange={value =>
                  setConnection({
                    ...connection,
                    options: { ...connection.options, organization: value || null },
                  })
                }
              />
              <Input
                label={t('aiConfig.project')}
                value={connection.options.project ?? ''}
                onChange={value =>
                  setConnection({
                    ...connection,
                    options: { ...connection.options, project: value || null },
                  })
                }
              />
            </>
          )}
        </div>
        <Switch
          label={t('aiConfig.enabled')}
          checked={connection.enabled}
          onChange={enabled => setConnection({ ...connection, enabled })}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            isLoading={busy}
            disabled={!connection.name.trim() || !connection.baseUrl.trim()}
            onClick={() => void saveConnection()}
          >
            {t('aiConfig.saveConnection')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !savedConnection || connection.provider === 'tavily'}
            onClick={() =>
              void perform(async () =>
                setModels(
                  await invoke<AiDiscoveredModel[]>('ai_discover_models', {
                    connectionId: connection.id,
                  })
                )
              )
            }
          >
            {t('aiConfig.discover')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !connectionState?.credentialConfigured}
            onClick={() =>
              void perform(async () => {
                setCredential('')
                await invoke('ai_set_credential', { connectionId: connection.id, value: null })
              })
            }
          >
            {t('aiConfig.removeCredential')}
          </Button>
        </div>
        {connectionState?.diagnostic && (
          <p className="text-xs text-gray-500">
            {t(`aiConfig.diagnostics.${connectionState.diagnostic}`, {
              defaultValue: t('aiConfig.error'),
            })}
          </p>
        )}
      </section>
      {savedConnection && connection.provider !== 'tavily' && (
        <section className="space-y-3 rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('aiConfig.presets')}</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreset(emptyPreset(connection.id))}
            >
              {t('aiConfig.newPreset')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {current.presets
              .filter(p => p.connectionId === connection.id)
              .map(p => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={p.id === preset.id ? 'primary' : 'ghost'}
                  onClick={() => setPreset(p)}
                >
                  {p.name}
                </Button>
              ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('aiConfig.presetName')}
              value={preset.name}
              onChange={value => setPreset({ ...preset, name: value })}
            />
            <Input
              label={t('aiConfig.modelId')}
              value={preset.modelId}
              onChange={value => setPreset({ ...preset, modelId: value })}
            />
            {models.length > 0 && (
              <Select
                label={t('aiConfig.discoveredModels')}
                value={models.some(m => m.id === preset.modelId) ? preset.modelId : 'none'}
                options={[
                  { value: 'none', label: t('aiConfig.manualModel') },
                  ...models.map(m => ({ value: m.id, label: m.id })),
                ]}
                onChange={modelId => {
                  const model = models.find(m => m.id === modelId)
                  if (model)
                    setPreset({
                      ...preset,
                      modelId,
                      name: preset.name || modelId,
                      capabilities: model.capabilities,
                    })
                }}
              />
            )}
            <Select
              label={t('aiConfig.purpose')}
              value={preset.purpose}
              options={[
                { value: 'chat', label: t('aiConfig.chat') },
                {
                  value: 'embedding',
                  label: t('aiConfig.embedding'),
                  disabled: connection.provider === 'anthropic',
                },
              ]}
              onChange={purpose =>
                setPreset({
                  ...preset,
                  purpose,
                  options: {
                    ...preset.options,
                    embedding:
                      purpose === 'embedding'
                        ? {
                            dimensions: null,
                            taskPolicy:
                              connection.provider === 'gemini'
                                ? 'gemini_retrieval_v1'
                                : 'symmetric',
                            hostedIndexingEnabled: false,
                          }
                        : null,
                  },
                })
              }
            />
            <Input
              label={t('aiConfig.contextLimit')}
              type="number"
              min={1024}
              max={2097152}
              value={String(preset.contextLimit)}
              onChange={value => setPreset({ ...preset, contextLimit: Number(value) })}
            />
            <Input
              label={t('aiConfig.outputLimit')}
              type="number"
              min={1}
              max={131072}
              value={String(preset.outputLimit)}
              onChange={value => setPreset({ ...preset, outputLimit: Number(value) })}
            />
          </div>
          {preset.options.embedding && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('aiConfig.dimensions')}
                type="number"
                min={1}
                max={65536}
                value={
                  preset.options.embedding.dimensions === null
                    ? ''
                    : String(preset.options.embedding.dimensions)
                }
                onChange={value =>
                  setPreset({
                    ...preset,
                    options: {
                      ...preset.options,
                      embedding: {
                        ...preset.options.embedding!,
                        dimensions: value ? Number(value) : null,
                      },
                    },
                  })
                }
                disabled={connection.provider === 'ollama'}
                helperText={t('aiConfig.dimensionsHelp')}
              />
              <Select
                label={t('aiConfig.taskPolicy')}
                value={preset.options.embedding.taskPolicy}
                options={(connection.provider === 'gemini'
                  ? ['gemini_retrieval_v1', 'gemini_prefix_v2']
                  : connection.provider === 'openrouter'
                    ? ['symmetric', 'retrieval']
                    : ['symmetric']
                ).map(value => ({
                  value,
                  label: t(`aiConfig.policies.${value}`, { defaultValue: value }),
                }))}
                onChange={taskPolicy =>
                  setPreset({
                    ...preset,
                    options: {
                      ...preset.options,
                      embedding: { ...preset.options.embedding!, taskPolicy },
                    },
                  })
                }
              />
              {connection.provider !== 'ollama' && (
                <Switch
                  label={t('aiConfig.hostedIndexing')}
                  checked={preset.options.embedding.hostedIndexingEnabled}
                  onChange={hostedIndexingEnabled =>
                    setPreset({
                      ...preset,
                      options: {
                        ...preset.options,
                        embedding: { ...preset.options.embedding!, hostedIndexingEnabled },
                      },
                    })
                  }
                />
              )}
            </div>
          )}
          {preset.purpose === 'chat' && (
            <p className="text-xs text-gray-500">{t('aiConfig.capabilityHelp')}</p>
          )}
          <Button
            size="sm"
            isLoading={busy}
            disabled={!preset.name.trim() || !preset.modelId.trim()}
            onClick={() => void savePreset()}
          >
            {t('aiConfig.savePreset')}
          </Button>
        </section>
      )}
      <details className="space-y-2 rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
        <summary className="cursor-pointer text-xs font-semibold">{t('aiConfig.json')}</summary>
        <p className="mt-2 text-xs text-gray-500">{t('aiConfig.jsonHelp')}</p>
        <textarea
          aria-label={t('aiConfig.jsonDocument')}
          value={json}
          onChange={value => setJson(value.target.value)}
          spellCheck={false}
          className="mt-2 h-48 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50 dark:border-white/10 dark:bg-black/10"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void perform(async () =>
                setJson(
                  JSON.stringify(await invoke<AiConfiguration>('ai_configuration_export'), null, 2)
                )
              )
            }
          >
            {t('aiConfig.export')}
          </Button>
          <Button
            size="sm"
            disabled={busy || !json.trim()}
            onClick={() =>
              void perform(async () => {
                if (new TextEncoder().encode(json).length > 1048576) throw new Error('input_limit')
                await apply(JSON.parse(json) as AiConfiguration)
              })
            }
          >
            {t('aiConfig.import')}
          </Button>
        </div>
      </details>
    </div>
  )
}
