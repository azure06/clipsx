import type { Transformer } from './useTransformState'
import { cleanParameters, parameterErrors, type SavedSetup } from '../extensions/parameters'
export type PreviewTransform = {
  id: string
  label: string
  transformer: Transformer
  sourceId: string
  parameters: Record<string, unknown>
  setupId: string | null
  disabled: boolean
  reason: string | null
  configure: boolean
}
export function previewTransforms(
  transformers: Transformer[],
  saved: SavedSetup[]
): PreviewTransform[] {
  return transformers.flatMap(transformer => {
    const entries = [
      ...transformer.setups.map(setup => ({
        id: `setup:${transformer.id}:${setup.id}`,
        label: setup.displayName,
        parameters: setup.parameters,
        availability: transformer.setupAvailability[setup.id],
        setupId: null as string | null,
        available: true,
        forceConfigure: false,
      })),
      ...saved
        .filter(setup => setup.transformerId === transformer.id)
        .map(setup => ({
          id: `saved:${setup.id}`,
          label: setup.label,
          parameters: setup.parameters,
          availability: transformer.setupAvailability[`saved:${setup.id}`],
          setupId: setup.id,
          available: setup.available,
          forceConfigure: false,
        })),
      ...(transformer.setups.length === 0 ||
      Object.keys(transformer.parameterSchema['properties'] ?? {}).length > 0
        ? [
            {
              id: `custom:${transformer.id}`,
              label: transformer.label,
              parameters: {},
              availability: transformer.customAvailability,
              setupId: null,
              available: true,
              forceConfigure: transformer.setups.length > 0,
            },
          ]
        : []),
    ]
    return entries.flatMap(entry => {
      const assessment = entry.availability
      if (!assessment || assessment.state === 'hidden') return []
      const parameters = cleanParameters(
        transformer.parameterSchema,
        transformer.parameterUi ?? [],
        entry.parameters
      )
      return [
        {
          id: entry.id,
          label: entry.label,
          transformer,
          sourceId: assessment.sourceId ?? transformer.sourceId,
          parameters,
          setupId: entry.setupId,
          disabled:
            assessment.state === 'disabled' || !transformer.providerAvailable || !entry.available,
          reason: assessment.reason,
          configure:
            entry.forceConfigure ||
            transformer.consentRequired ||
            Object.keys(
              parameterErrors(
                transformer.parameterSchema,
                transformer.parameterUi ?? [],
                parameters
              )
            ).length > 0,
        },
      ]
    })
  })
}
