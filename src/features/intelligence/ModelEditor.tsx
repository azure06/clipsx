import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { Button, Input, Select, Switch } from '../../shared/components/ui'
import type { AiConnection, AiDiscoveredModel, AiModelPreset } from '../recall/contracts.generated'
import { ModelSettingsDialog } from './ModelSettingsDialog'
import { emptyPreset } from './modelConfiguration'

export function ModelEditor({
  initial,
  connection,
  busy,
  error,
  models,
  onDiscover,
  onSave,
  onClose,
}: {
  initial: AiModelPreset
  connection: AiConnection
  busy: boolean
  error: string | null
  models: AiDiscoveredModel[]
  onDiscover: () => Promise<void>
  onSave: (preset: AiModelPreset) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [preset, setPreset] = useState(initial)
  const embedding = preset.options.embedding
  const setEmbedding = (patch: Partial<NonNullable<typeof embedding>>) =>
    setPreset({ ...preset, options: { ...preset.options, embedding: { ...embedding!, ...patch } } })
  const purposeOptions = [
    { value: 'chat' as const, label: t('aiConfig.chat') },
    {
      value: 'embedding' as const,
      label: t('aiConfig.embedding'),
      disabled: connection.provider === 'anthropic',
    },
    {
      value: 'decision' as const,
      label: t('modelsWorkspace.decision'),
      disabled: connection.provider !== 'ollama',
    },
  ]
  return (
    <ModelSettingsDialog
      title={t('modelsWorkspace.modelEditorTitle', { name: connection.name })}
      description={t('modelsWorkspace.modelDescription')}
      onClose={onClose}
      busy={busy}
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          void onSave({ ...preset, name: preset.name.trim(), modelId: preset.modelId.trim() })
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              required
              autoFocus
              label={t('aiConfig.presetName')}
              value={preset.name}
              maxLength={128}
              onChange={name => setPreset({ ...preset, name })}
            />
            <Select
              label={t('aiConfig.purpose')}
              value={preset.purpose}
              options={purposeOptions}
              onChange={purpose =>
                setPreset({
                  ...preset,
                  purpose,
                  options: {
                    ...emptyPreset(connection.id).options,
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
                  capabilities: emptyPreset(connection.id).capabilities,
                })
              }
            />
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/55 p-3 dark:border-white/10 dark:bg-white/[.025]">
            <Input
              required
              label={t('aiConfig.modelId')}
              value={preset.modelId}
              maxLength={256}
              placeholder={preset.purpose === 'decision' ? 'laya' : undefined}
              onChange={modelId =>
                setPreset({
                  ...preset,
                  modelId,
                  capabilities: emptyPreset(connection.id).capabilities,
                })
              }
            />
            <div className="mt-3 flex items-end gap-2">
              {models.length > 0 && (
                <div className="min-w-0 flex-1">
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
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => void onDiscover()}
              >
                {t('aiConfig.discover')}
              </Button>
            </div>
          </div>
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
            {t(
              preset.purpose === 'decision'
                ? 'modelsWorkspace.decisionHelp'
                : preset.purpose === 'embedding'
                  ? 'aiConfig.embeddingHelp'
                  : 'aiConfig.capabilityHelp'
            )}
          </p>
          {preset.purpose === 'decision' && (
            <div className="rounded-xl bg-amber-500/8 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
              {t('modelsWorkspace.decisionSetup')}{' '}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5">
                {t('modelsWorkspace.decisionInstallCommand')}
              </code>
            </div>
          )}
          {embedding && connection.provider !== 'ollama' && (
            <Switch
              label={t('aiConfig.hostedIndexing')}
              checked={embedding.hostedIndexingEnabled}
              onChange={hostedIndexingEnabled => setEmbedding({ hostedIndexingEnabled })}
            />
          )}
          {preset.purpose !== 'decision' && (
            <details className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">
                {t('modelsWorkspace.advanced')}
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
                {embedding ? (
                  <>
                    <Input
                      label={t('aiConfig.dimensions')}
                      type="number"
                      min={1}
                      max={65536}
                      value={embedding.dimensions === null ? '' : String(embedding.dimensions)}
                      disabled={connection.provider === 'ollama'}
                      helperText={t('aiConfig.dimensionsHelp')}
                      onChange={value => setEmbedding({ dimensions: value ? Number(value) : null })}
                    />
                    <Select
                      label={t('aiConfig.taskPolicy')}
                      value={embedding.taskPolicy}
                      options={(connection.provider === 'gemini'
                        ? ['gemini_retrieval_v1', 'gemini_prefix_v2']
                        : connection.provider === 'openrouter'
                          ? ['symmetric', 'retrieval']
                          : ['symmetric']
                      ).map(value => ({
                        value,
                        label: t(`aiConfig.policies.${value}`, { defaultValue: value }),
                      }))}
                      onChange={taskPolicy => setEmbedding({ taskPolicy })}
                    />
                  </>
                ) : (
                  <>
                    <Input
                      label={t('modelsWorkspace.temperature')}
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={
                        preset.options.temperature === null
                          ? ''
                          : String(preset.options.temperature)
                      }
                      helperText={t('modelsWorkspace.providerDefault')}
                      onChange={value =>
                        setPreset({
                          ...preset,
                          options: { ...preset.options, temperature: value ? Number(value) : null },
                        })
                      }
                    />
                    {['openai', 'openrouter'].includes(connection.provider) && (
                      <Select
                        label={t('modelsWorkspace.reasoningEffort')}
                        value={preset.options.openai?.reasoningEffort ?? 'default'}
                        options={[
                          'default',
                          'none',
                          'minimal',
                          'low',
                          'medium',
                          'high',
                          'xhigh',
                        ].map(value => ({
                          value,
                          label: t(`modelsWorkspace.effort.${value}`, { defaultValue: value }),
                        }))}
                        onChange={value =>
                          setPreset({
                            ...preset,
                            options: {
                              ...preset.options,
                              openai: value === 'default' ? null : { reasoningEffort: value },
                            },
                          })
                        }
                      />
                    )}
                    {['anthropic', 'gemini'].includes(connection.provider) && (
                      <Input
                        label={t('modelsWorkspace.thinkingBudget')}
                        type="number"
                        min={connection.provider === 'anthropic' ? 1024 : 0}
                        max={32768}
                        value={String(
                          (connection.provider === 'anthropic'
                            ? preset.options.anthropic
                            : preset.options.gemini
                          )?.thinkingBudget ?? ''
                        )}
                        helperText={t('modelsWorkspace.providerDefault')}
                        onChange={value =>
                          setPreset({
                            ...preset,
                            options: {
                              ...preset.options,
                              [connection.provider]: value
                                ? { thinkingBudget: Number(value) }
                                : null,
                            },
                          })
                        }
                      />
                    )}
                  </>
                )}
              </div>
            </details>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-4 dark:border-white/10">
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            isLoading={busy}
            disabled={!preset.name.trim() || !preset.modelId.trim()}
          >
            {t('aiConfig.savePreset')}
          </Button>
        </div>
      </form>
    </ModelSettingsDialog>
  )
}
