import i18n from '../../i18n/index'
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
      errors[field.field] = i18n.t('desktopUi.fieldRequired', { label: field.label })
    else if (!empty) {
      if (definition['type'] === 'string' && typeof value !== 'string')
        errors[field.field] = i18n.t('desktopUi.enterText')
      if (
        typeof value === 'string' &&
        typeof definition['maxLength'] === 'number' &&
        [...value].length > definition['maxLength']
      )
        errors[field.field] = i18n.t('desktopUi.maximumCharacters', {
          count: definition['maxLength'],
        })
      if (definition['type'] === 'boolean' && typeof value !== 'boolean')
        errors[field.field] = i18n.t('desktopUi.chooseYesOrNo')
      if (definition['type'] === 'number' || definition['type'] === 'integer') {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (definition['type'] === 'integer' && !Number.isInteger(value))
        )
          errors[field.field] = i18n.t('desktopUi.enterAValidNumber')
        else if (
          (typeof definition['minimum'] === 'number' && value < definition['minimum']) ||
          (typeof definition['maximum'] === 'number' && value > definition['maximum'])
        )
          errors[field.field] = i18n.t('desktopUi.enterANumberWithinTheAllowedRange')
      }
      if (Array.isArray(definition['enum']) && !definition['enum'].includes(value))
        errors[field.field] = i18n.t('desktopUi.chooseAListedValue')
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
  setupSelectorParameter?: string | null
  setups: Array<{
    id: string
    displayName: string
    parameters: Record<string, unknown>
    defaultView?: 'result_only' | 'compare' | null
  }>
  defaultView: 'result_only' | 'compare'
  providerAvailable: boolean
}

// Presentation stays independent of schema validation and execution eligibility.
export const parameterControl = (field: ParameterField, schema: ParameterSchema) =>
  field.control ??
  (Array.isArray(schema['enum'])
    ? 'select'
    : schema['type'] === 'boolean'
      ? 'checkbox'
      : schema['type'] === 'number' || schema['type'] === 'integer'
        ? 'number'
        : 'text')
export const sameParameters = (left: Record<string, unknown>, right: Record<string, unknown>) => {
  const canonical = (values: Record<string, unknown>) =>
    JSON.stringify(values, (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value
    )
  return canonical(left) === canonical(right)
}
export const allowSetupChange = (dirty: boolean) =>
  !dirty || window.confirm(i18n.t('desktopUi.discardYourUnsavedChangesAndChooseAnotherSetup'))
