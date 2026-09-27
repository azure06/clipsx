import { useId } from 'react'
import { Switch } from '../../shared/components/ui'
import {
  controlClass,
  humanLabel,
  parameterFields,
  properties,
  visibleField,
  type ParameterField,
  type ParameterSchema,
} from './parameters'

export function ParameterForm({
  schema,
  fields = [],
  values,
  errors = {},
  onChange,
}: {
  schema: ParameterSchema
  fields?: ParameterField[]
  values: Record<string, unknown>
  errors?: Record<string, string>
  onChange: (values: Record<string, unknown>) => void
}) {
  const prefix = useId()
  return (
    <div className="grid gap-3">
      {parameterFields(schema, fields)
        .filter(field => visibleField(field, values))
        .map(field => {
          const definition = properties(schema)[field.field] ?? {}
          const value = values[field.field]
          const id = `${prefix}-${field.field}`
          const change = (next: unknown) => {
            const result = { ...values, [field.field]: next }
            for (const dependent of fields)
              if (!visibleField(dependent, result)) delete result[dependent.field]
            onChange(result)
          }
          const control =
            field.control ??
            (Array.isArray(definition['enum'])
              ? 'select'
              : definition['type'] === 'boolean'
                ? 'checkbox'
                : definition['type'] === 'number' || definition['type'] === 'integer'
                  ? 'number'
                  : 'text')
          const error = errors[field.field]
          const describedBy =
            `${field.description ? `${id}-help ` : ''}${error ? `${id}-error` : ''}`.trim() ||
            undefined
          return (
            <div key={field.field} className="grid gap-1.5">
              <label
                htmlFor={id}
                className="text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                {field.label}
              </label>
              {control === 'select' ? (
                <select
                  id={id}
                  aria-invalid={!!error}
                  aria-describedby={describedBy}
                  className={controlClass}
                  value={value === undefined ? '' : JSON.stringify(value)}
                  onChange={event =>
                    change(
                      event.target.value ? (JSON.parse(event.target.value) as unknown) : undefined
                    )
                  }
                >
                  <option value="">Choose…</option>
                  {((definition['enum'] as unknown[]) ?? []).map(option => (
                    <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
                      {humanLabel(String(option))}
                    </option>
                  ))}
                </select>
              ) : control === 'checkbox' ? (
                <Switch id={id} checked={value === true} onChange={change} size="sm" />
              ) : control === 'textarea' ? (
                <textarea
                  id={id}
                  aria-invalid={!!error}
                  aria-describedby={describedBy}
                  className={`${controlClass} min-h-24 resize-y`}
                  value={typeof value === 'string' ? value : ''}
                  maxLength={
                    typeof definition['maxLength'] === 'number'
                      ? definition['maxLength']
                      : undefined
                  }
                  onChange={event => change(event.target.value)}
                />
              ) : (
                <input
                  id={id}
                  aria-invalid={!!error}
                  aria-describedby={describedBy}
                  className={controlClass}
                  type={control === 'number' ? 'number' : 'text'}
                  step={definition['type'] === 'integer' ? 1 : 'any'}
                  min={
                    typeof definition['minimum'] === 'number' ? definition['minimum'] : undefined
                  }
                  max={
                    typeof definition['maximum'] === 'number' ? definition['maximum'] : undefined
                  }
                  maxLength={
                    typeof definition['maxLength'] === 'number'
                      ? definition['maxLength']
                      : undefined
                  }
                  value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                  onChange={event =>
                    change(
                      control === 'number'
                        ? event.target.value === ''
                          ? undefined
                          : Number(event.target.value)
                        : event.target.value
                    )
                  }
                />
              )}
              {field.description && (
                <p id={`${id}-help`} className="text-[11px] leading-4 text-slate-500">
                  {field.description}
                </p>
              )}
              {error && (
                <p
                  id={`${id}-error`}
                  role="alert"
                  className="text-[11px] text-red-600 dark:text-red-400"
                >
                  {error}
                </p>
              )}
            </div>
          )
        })}
    </div>
  )
}
