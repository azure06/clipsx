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

export const ContributionParametersDialog = ({
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
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      role="presentation"
    >
      <form
        aria-label={`${request.label} parameters`}
        className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-900"
        onSubmit={event => {
          event.preventDefault()
          onSubmit(values)
        }}
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {request.label}
          </h2>
          <p className="mt-1 text-xs text-gray-500">Configure this operation before it runs.</p>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-auto">
          {Object.entries(properties).map(([id, property]) => {
            const label = typeof property['title'] === 'string' ? property['title'] : id
            const description =
              typeof property['description'] === 'string' ? property['description'] : null
            const enumValues = Array.isArray(property['enum']) ? property['enum'] : null
            return (
              <label key={id} className="block space-y-1 text-xs text-gray-700 dark:text-gray-300">
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
                    className="w-full rounded-md border border-slate-200 bg-transparent px-2 py-1.5 dark:border-white/10"
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
                    className="w-full rounded-md border border-slate-200 bg-transparent px-2 py-1.5 dark:border-white/10"
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
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Run</Button>
        </div>
      </form>
    </div>
  )
}
