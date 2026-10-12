import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Brain, Check, ChevronDown, Globe2, Settings2, Wrench } from 'lucide-react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuItemIndicator,
  DropdownMenuSeparator,
} from '../../shared/components/ui'
import { SearchableSelect } from '../../shared/components/ui/SearchableSelect'
import { dropdownItemClass } from '../../shared/components/ui/dropdownStyles'
import { ProviderIcon } from '../intelligence/ProviderIcon'
import { useUIStore } from '../../stores/uiStore'
import type {
  AiConfiguration,
  AiModelPreset,
  AssistantModelOptions,
  ReasoningSelection,
  RecallThread,
} from './contracts.generated'

export function RecallOptions({
  configuration,
  preset,
  presetId,
  thread,
  disabled,
  onPreset,
  onReasoning,
  onWeb,
}: {
  configuration: AiConfiguration | null
  preset: AiModelPreset | null
  presetId: string | null
  thread: RecallThread | null
  disabled: boolean
  onPreset: (id: string) => void
  onReasoning: (selection: ReasoningSelection | null) => void
  onWeb: (enabled: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const connection = configuration?.connections.find(c => c.id === preset?.connectionId)
  const key = JSON.stringify([preset, connection])
  const [observation, setObservation] = useState<{
    key: string
    options: AssistantModelOptions | null
  }>({ key: '', options: null })
  useEffect(() => {
    if (!presetId) return
    let active = true
    void invoke<AssistantModelOptions>('assistant_model_options', { presetId })
      .then(options => {
        if (active) setObservation({ key, options })
      })
      .catch(() => {
        if (active) setObservation({ key, options: null })
      })
    return () => {
      active = false
    }
  }, [key, presetId])
  const options = observation.key === key ? observation.options : null
  const loading = Boolean(presetId) && observation.key !== key
  const selection = thread?.reasoning ?? null
  const selected = selection ? JSON.stringify(selection) : 'default'
  const label = (value: ReasoningSelection | null) => {
    if (!value) return t('recallOptions.presetDefault')
    if (value.kind === 'thinking')
      return t(value.enabled ? 'recallOptions.on' : 'recallOptions.off')
    if (value.kind === 'budget')
      return t('recallOptions.tokenBudget', {
        count: value.tokens,
        value: value.tokens.toLocaleString(i18n.language),
      })
    return t(`recallOptions.efforts.${value.value}`, { defaultValue: value.value })
  }
  const configuredModels =
    configuration?.connections.flatMap(c =>
      configuration.presets
        .filter(p => p.connectionId === c.id && p.purpose === 'chat')
        .map(p => ({
          value: p.id,
          label: `${p.name} · ${p.modelId}`,
          group: c.name,
          icon: <ProviderIcon provider={c.provider} className="h-3.5 w-3.5" />,
          disabled: !c.enabled,
        }))
    ) ?? []
  const settings = () => useUIStore.getState().setActiveView('intelligence')
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-0.5"
      aria-label={t('recallOptions.options')}
    >
      <SearchableSelect
        compact
        label={t('recallPage.model')}
        value={presetId ?? ''}
        options={configuredModels}
        onChange={onPreset}
        disabled={disabled}
        leading={
          connection && <ProviderIcon provider={connection.provider} className="h-3.5 w-3.5" />
        }
        placeholder={t('recallPage.selectModel')}
        searchLabel={t('recallOptions.searchModels')}
        emptyLabel={t('recallOptions.noModels')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="max-w-48 gap-1.5 px-2"
            disabled={disabled || !preset}
            aria-label={t('recallOptions.reasoning')}
            title={t('recallOptions.reasoning') + ': ' + label(selection)}
          >
            <Brain size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">{label(selection)}</span>
            <ChevronDown size={11} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-1rem)]">
          <p className="px-3 py-2 text-[10px] font-semibold text-slate-500">
            {t('recallOptions.reasoning')}
          </p>
          <Menu.RadioGroup
            value={selected}
            onValueChange={id =>
              onReasoning(options?.reasoning.find(value => JSON.stringify(value) === id) ?? null)
            }
          >
            {[null, ...(options?.reasoning ?? [])].map(value => (
              <Menu.RadioItem
                key={value ? JSON.stringify(value) : 'default'}
                value={value ? JSON.stringify(value) : 'default'}
                className={`${dropdownItemClass} pl-8`}
              >
                <DropdownMenuItemIndicator className="absolute left-2">
                  <Check size={13} aria-hidden="true" />
                </DropdownMenuItemIndicator>
                {label(value)}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <DropdownMenuSeparator />
          <p role="status" className="px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            {loading
              ? t('common.loading')
              : options?.reasoning.length
                ? t('recallOptions.reasoningHelp')
                : t('recallOptions.reasoningUnknown')}
          </p>
          {selection &&
            !options?.reasoning.some(value => JSON.stringify(value) === selected) &&
            !loading && (
              <p className="px-3 pb-2 text-[11px] text-amber-600 dark:text-amber-300">
                {t('recallOptions.savedUnavailable')}
              </p>
            )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 px-2"
            disabled={disabled}
            aria-label={t('recallOptions.tools')}
          >
            <Wrench size={13} className="text-slate-400" aria-hidden="true" />
            {t('recallOptions.tools')}
            {thread?.webEnabled && (
              <Globe2 size={12} className="text-violet-500" aria-label={t('recallOptions.webOn')} />
            )}
            <ChevronDown size={11} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-1rem)]">
          <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            {t(
              preset?.capabilities.tools === false
                ? 'recallOptions.clipboardUnsupported'
                : preset?.capabilities.tools === true
                  ? 'recallOptions.clipboardAutomatic'
                  : 'recallOptions.clipboardUnverified'
            )}
          </p>
          <DropdownMenuCheckboxItem
            checked={thread?.webEnabled ?? false}
            disabled={!thread || !preset}
            onCheckedChange={onWeb}
          >
            <DropdownMenuItemIndicator className="absolute left-2">
              <Check size={13} aria-hidden="true" />
            </DropdownMenuItemIndicator>
            <Globe2 size={13} aria-hidden="true" />
            {t('recallPage.webResearch')}
          </DropdownMenuCheckboxItem>
          <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            {t('recallOptions.webHelp')}
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={settings}>
            <Settings2 size={13} aria-hidden="true" />
            {t('recallPage.configureModels')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!preset && (
        <Button size="sm" variant="ghost" onClick={settings}>
          {t('recallPage.configureModels')}
        </Button>
      )}
    </div>
  )
}
