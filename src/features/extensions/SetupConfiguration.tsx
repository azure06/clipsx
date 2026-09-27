import type { ReactNode } from 'react'
import { Select } from '../../shared/components/ui'
import { ParameterForm } from './ParameterForm'
import {
  controlClass,
  humanLabel,
  type SavedSetup,
  type TransformerConfiguration,
} from './parameters'

export function SetupConfiguration({
  transformer,
  setups,
  reference,
  values,
  view,
  errors,
  onSelect,
  onChange,
  onViewChange,
  disabled = false,
  accessory,
}: {
  transformer: TransformerConfiguration
  setups: SavedSetup[]
  reference: string
  values: Record<string, unknown>
  view: 'result_only' | 'compare'
  errors?: Record<string, string>
  onSelect: (reference: string) => void
  onChange: (values: Record<string, unknown>) => void
  onViewChange: (view: 'result_only' | 'compare') => void
  disabled?: boolean
  accessory?: ReactNode
}) {
  const binding = transformer.setupSelectorParameter
  const selectorValue = binding ? values[binding] : undefined
  const base =
    reference.startsWith('saved:') &&
    (typeof selectorValue === 'string' ||
      typeof selectorValue === 'number' ||
      typeof selectorValue === 'boolean')
      ? humanLabel(String(selectorValue))
      : undefined
  return (
    <div className="grid gap-3">
      <div className="flex items-end gap-2">
        <div className="grid min-w-0 flex-1">
          <Select
            label="Setup"
            ariaLabel="Setup"
            value={reference}
            onChange={onSelect}
            disabled={disabled}
            className={controlClass}
            placeholder="Choose a setup"
            options={!transformer.setups.length ? [{ value: 'default', label: 'Default' }] : []}
            groups={[
              {
                label: 'Built-in setups',
                options: transformer.setups.map(setup => ({
                  value: setup.id,
                  label: setup.displayName,
                })),
              },
              {
                label: 'Saved setups',
                options: setups.map(setup => ({
                  value: `saved:${setup.id}`,
                  label: setup.label + (!setup.available ? ' — unavailable' : ''),
                  disabled: !setup.available,
                })),
              },
            ]}
            helpText={base ? `Based on ${base}` : undefined}
          />
        </div>
        {accessory}
      </div>
      <ParameterForm
        schema={transformer.parameterSchema}
        fields={transformer.parameterUi}
        hiddenFields={binding ? [binding] : []}
        values={values}
        errors={errors}
        onChange={onChange}
      />
      <Select
        label="Initial result view"
        className={controlClass}
        value={view}
        onChange={onViewChange}
        disabled={disabled}
        options={[
          { value: 'result_only', label: 'Result' },
          { value: 'compare', label: 'Compare' },
        ]}
      />
    </div>
  )
}
