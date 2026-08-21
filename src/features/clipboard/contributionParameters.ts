export type ContributionParameterSchema = Record<string, unknown>

export const parameterProperties = (
  schema: ContributionParameterSchema
): Record<string, ContributionParameterSchema> => {
  const value = schema['properties']
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, ContributionParameterSchema>)
    : {}
}

export const schemaHasParameters = (
  schema: ContributionParameterSchema | undefined
): schema is ContributionParameterSchema =>
  Boolean(schema && Object.keys(parameterProperties(schema)).length)
