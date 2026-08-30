import { ArrowLeft, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../shared/components/ui/Button'
import {
  parameterProperties,
  type ContributionParameterSchema as Schema,
} from './contributionParameters'

export type ParameterRequest = {
  kind: 'transformer' | 'action'
  id: string
  label: string
  schema: Schema
}

const initialValues = (schema: Schema): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(parameterProperties(schema)).map(([id, property]) => [
      id,
      property['default'] ?? (property['type'] === 'boolean' ? false : ''),
    ])
  )

const scalarString = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

export const ContributionParametersPanel = ({
  request,
  onCancel,
  onSubmit,
}: {
  request: ParameterRequest
  onCancel: () => void
  onSubmit: (values: Record<string, unknown>) => void
}) => {
  const properties = useMemo(() => parameterProperties(request.schema), [request.schema])
  const required = useMemo(
    () => new Set(Array.isArray(request.schema['required']) ? request.schema['required'] : []),
    [request.schema]
  )
  const [values, setValues] = useState(() => initialValues(request.schema))

  const setValue = (id: string, value: unknown) =>
    setValues(current => ({ ...current, [id]: value }))

  return (
    <form
      aria-label={`${request.label} parameters`}
      className="flex h-full min-h-0 flex-col"
      onSubmit={event => {
        event.preventDefault()
        onSubmit(values)
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200/60 px-2 dark:border-white/7">
        <button
          type="button"
          aria-label="Back to actions"
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-500/10 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 dark:hover:text-slate-200"
          onClick={onCancel}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
            {request.label}
          </h2>
          <p className="truncate text-[9px] text-gray-500">Configure and run</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        {Object.entries(properties).map(([id, property]) => {
          const label = typeof property['title'] === 'string' ? property['title'] : id
          const description =
            typeof property['description'] === 'string' ? property['description'] : null
          const enumValues = Array.isArray(property['enum']) ? property['enum'] : null
          return (
            <label
              key={id}
              className="block space-y-1 text-[11px] text-gray-700 dark:text-gray-300"
            >
              <span className="font-medium">
                {label}
                {required.has(id) ? ' *' : ''}
              </span>
              {property['type'] === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[id])}
                  onChange={event => setValue(id, event.target.checked)}
                />
              ) : enumValues ? (
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white/40 px-2 py-1.5 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10 dark:border-white/10 dark:bg-white/5"
                  required={required.has(id)}
                  value={scalarString(values[id])}
                  onChange={event => setValue(id, event.target.value)}
                >
                  {!required.has(id) && <option value="">Default</option>}
                  {enumValues.map(value => (
                    <option key={String(value)} value={String(value)}>
                      {String(value)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white/40 px-2 py-1.5 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10 dark:border-white/10 dark:bg-white/5"
                  type={
                    property['type'] === 'number' || property['type'] === 'integer'
                      ? 'number'
                      : 'text'
                  }
                  required={required.has(id)}
                  min={typeof property['minimum'] === 'number' ? property['minimum'] : undefined}
                  max={typeof property['maximum'] === 'number' ? property['maximum'] : undefined}
                  minLength={
                    typeof property['minLength'] === 'number' ? property['minLength'] : undefined
                  }
                  maxLength={
                    typeof property['maxLength'] === 'number' ? property['maxLength'] : undefined
                  }
                  step={
                    property['type'] === 'integer'
                      ? 1
                      : property['type'] === 'number'
                        ? 'any'
                        : undefined
                  }
                  value={scalarString(values[id])}
                  onChange={event =>
                    setValue(
                      id,
                      property['type'] === 'number' || property['type'] === 'integer'
                        ? event.target.valueAsNumber
                        : event.target.value
                    )
                  }
                />
              )}
              {description && (
                <span className="block text-[10px] text-gray-500">{description}</span>
              )}
            </label>
          )
        })}
      </div>
      <div className="flex shrink-0 justify-end border-t border-slate-200/60 p-2 dark:border-white/7">
        <Button type="submit" size="sm" className="gap-1.5">
          <Play className="h-3 w-3 fill-current" />
          Run
        </Button>
      </div>
    </form>
  )
}
