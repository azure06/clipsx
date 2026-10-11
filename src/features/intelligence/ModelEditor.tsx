import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { Button, Input, Select, Switch } from '../../shared/components/ui'
import type { AiConnection, AiDiscoveredModel, AiModelPreset } from '../recall/contracts.generated'
import { ModelSettingsPanel } from './ModelSettingsPanel'
import { ProviderIcon } from './ProviderIcon'
import { SearchableSelect } from '../../shared/components/ui/SearchableSelect'
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
  const [manual, setManual] = useState(false)
  const [showUnknown, setShowUnknown] = useState(false)
  const availableModels = models.filter(
    model => model.purposes?.includes(preset.purpose) || (showUnknown && model.purposes == null)
  )
  const selectedModel = models.find(model => model.id === preset.modelId)
  const compatible =
    selectedModel?.purposes?.includes(preset.purpose) ||
    (showUnknown && selectedModel && selectedModel.purposes == null)
  const canSave = Boolean(preset.name.trim() && preset.modelId.trim() && (manual || compatible))
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
    <ModelSettingsPanel
      icon={<ProviderIcon provider={connection.provider} />}
      title={t('modelsWorkspace.modelEditorTitle', { name: connection.name })}
      description={t('modelsWorkspace.modelDescription')}
      onClose={onClose}
      busy={busy}
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          if (!canSave) return
          void onSave({ ...preset, name: preset.name.trim(), modelId: preset.modelId.trim() })
        }}
      >
        <fieldset disabled={busy} className="space-y-4 [&>div]:w-full">
          <div className="rounded-xl bg-violet-500/5 px-4 py-3">
            <p className="text-[10px] font-medium text-slate-500">{t('aiConfig.provider')}</p>
            <p className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
              {connection.name}
            </p>
          </div>
          <Select
            label={t('aiConfig.purpose')}
            value={preset.purpose}
            options={purposeOptions}
            onChange={purpose => {
              setPreset({
                ...preset,
                purpose,
                modelId: '',
                name: preset.name === preset.modelId ? '' : preset.name,
                options: {
                  ...emptyPreset(connection.id).options,
                  embedding:
                    purpose === 'embedding'
                      ? {
                          dimensions: null,
                          taskPolicy:
                            connection.provider === 'gemini' ? 'gemini_retrieval_v1' : 'symmetric',
                          hostedIndexingEnabled: false,
                        }
                      : null,
                },
                capabilities: emptyPreset(connection.id).capabilities,
              })
            }}
          />
          <div className="space-y-3 [&>div]:w-full">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t(
                  connection.provider === 'ollama'
                    ? 'modelsWorkspace.installedModels'
                    : 'modelsWorkspace.availableModels'
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => void onDiscover()}
              >
                {t('aiConfig.discover')}
              </Button>
            </div>
            {!manual && (
              <>
                <SearchableSelect
                  label={t('modelsWorkspace.chooseModel')}
                  value={preset.modelId}
                  disabled={busy}
                  placeholder={t('modelsWorkspace.selectModel')}
                  searchLabel={t('modelsWorkspace.filterModels')}
                  emptyLabel={t('modelsWorkspace.noCompatibleModels')}
                  options={availableModels.map(model => ({ value: model.id, label: model.id }))}
                  onChange={modelId => {
                    const model = models.find(item => item.id === modelId)
                    setPreset({
                      ...preset,
                      modelId: model?.id ?? '',
                      name:
                        !preset.name || preset.name === preset.modelId
                          ? (model?.id ?? '')
                          : preset.name,
                      capabilities: model?.capabilities ?? emptyPreset(connection.id).capabilities,
                    })
                  }}
                />
                {!availableModels.length && (
                  <p role="status" className="text-xs text-slate-500">
                    {t(busy ? 'aiConfig.loading' : 'modelsWorkspace.noCompatibleModels')}
                  </p>
                )}
                {preset.modelId && !compatible && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('modelsWorkspace.savedModelUnavailable', { model: preset.modelId })}
                  </p>
                )}
                {models.some(model => model.purposes == null) && (
                  <Switch
                    label={t('modelsWorkspace.showUnknownModels')}
                    checked={showUnknown}
                    onChange={setShowUnknown}
                  />
                )}
                {selectedModel && (
                  <p className="text-[11px] text-slate-500">
                    {t(
                      selectedModel.purposes == null
                        ? 'modelsWorkspace.unknownPurpose'
                        : selectedModel.capabilities.source === 'clipsx_model_family'
                          ? 'modelsWorkspace.catalogInferred'
                          : 'modelsWorkspace.catalogReported'
                    )}
                  </p>
                )}
              </>
            )}
            <Switch
              label={t('modelsWorkspace.enterManualModel')}
              checked={manual}
              onChange={setManual}
            />
            {manual && (
              <Input
                required
                label={t('aiConfig.modelId')}
                value={preset.modelId}
                maxLength={256}
                helperText={t('modelsWorkspace.manualModelHelp')}
                onChange={modelId =>
                  setPreset({
                    ...preset,
                    modelId,
                    capabilities: emptyPreset(connection.id).capabilities,
                  })
                }
              />
            )}
          </div>
          <Input
            required
            label={t('aiConfig.presetName')}
            value={preset.name}
            maxLength={128}
            onChange={name => setPreset({ ...preset, name })}
          />
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
          <Button type="submit" size="sm" isLoading={busy} disabled={!canSave}>
            {t('aiConfig.savePreset')}
          </Button>
        </div>
      </form>
    </ModelSettingsPanel>
  )
}
