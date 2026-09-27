export type ParameterField = {
  field: string
  label: string
  description?: string | null
  control?: 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | null
  when?: { field: string; equals: string | number | boolean } | null
  required?: boolean
}
export type ParameterSchema = Record<string, unknown>
export const controlClass =
  'w-full rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition-colors focus:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-100'
export const humanLabel = (value: string) => {
  const text = value.replaceAll('_', ' ').replaceAll('-', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
export const properties = (schema: ParameterSchema) =>
  (schema['properties'] ?? {}) as Record<string, ParameterSchema>
export const parameterFields = (
  schema: ParameterSchema,
  ui: ParameterField[] = []
): ParameterField[] => {
  const fields = properties(schema)
  return [
    ...ui,
    ...Object.keys(fields)
      .filter(key => !ui.some(field => field.field === key))
      .map(field => ({
        field,
        label:
          typeof fields[field]?.['title'] === 'string' ? fields[field]['title'] : humanLabel(field),
      })),
  ]
}
export const visibleField = (field: ParameterField, values: Record<string, unknown>) =>
  !field.when || values[field.when.field] === field.when.equals
export const cleanParameters = (
  schema: ParameterSchema,
  ui: ParameterField[],
  values: Record<string, unknown>
) => {
  const result = { ...values }
  for (const [name, field] of Object.entries(properties(schema)))
    if (result[name] === undefined && field['default'] !== undefined)
      result[name] = field['default']
  for (const field of ui) if (!visibleField(field, result)) delete result[field.field]
  for (const key of Object.keys(result)) if (result[key] === undefined) delete result[key]
  return result
}
export const parameterErrors = (
  schema: ParameterSchema,
  ui: ParameterField[],
  values: Record<string, unknown>
) => {
  const cleaned = cleanParameters(schema, ui, values)
  const errors: Record<string, string> = {}
  const required = Array.isArray(schema['required']) ? schema['required'] : []
  for (const field of parameterFields(schema, ui).filter(field => visibleField(field, cleaned))) {
    const value = cleaned[field.field]
    const definition = properties(schema)[field.field] ?? {}
    const empty =
      value === undefined || value === null || (typeof value === 'string' && !value.trim())
    if (empty && (field.required || required.includes(field.field)))
      errors[field.field] = `${field.label} is required.`
    else if (!empty) {
      if (definition['type'] === 'string' && typeof value !== 'string')
        errors[field.field] = 'Enter text.'
      if (
        typeof value === 'string' &&
        typeof definition['maxLength'] === 'number' &&
        [...value].length > definition['maxLength']
      )
        errors[field.field] = `Use at most ${definition['maxLength']} characters.`
      if (definition['type'] === 'boolean' && typeof value !== 'boolean')
        errors[field.field] = 'Choose Yes or No.'
      if (definition['type'] === 'number' || definition['type'] === 'integer') {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (definition['type'] === 'integer' && !Number.isInteger(value))
        )
          errors[field.field] = 'Enter a valid number.'
        else if (
          (typeof definition['minimum'] === 'number' && value < definition['minimum']) ||
          (typeof definition['maximum'] === 'number' && value > definition['maximum'])
        )
          errors[field.field] = 'Enter a number within the allowed range.'
      }
      if (Array.isArray(definition['enum']) && !definition['enum'].includes(value))
        errors[field.field] = 'Choose a listed value.'
    }
  }
  return errors
}

export type SavedSetup = {
  id: string
  packageId: string
  transformerId: string
  label: string
  parameters: Record<string, unknown>
  defaultView: 'result_only' | 'compare'
  revision: number
  available: boolean
}
export type TransformerConfiguration = {
  id: string
  localId?: string
  label: string
  parameterSchema: ParameterSchema
  parameterUi?: ParameterField[]
  setups: Array<{
    id: string
    displayName: string
    parameters: Record<string, unknown>
    defaultView?: 'result_only' | 'compare' | null
  }>
  defaultView: 'result_only' | 'compare'
  providerAvailable: boolean
}
