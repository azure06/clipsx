import type { Transformer } from './useTransformState'
import { cleanParameters, parameterErrors } from '../extensions/parameters'
export type QuickCopyCandidate = {
  key: string
  transformer: Transformer
  setup: Transformer['setups'][number]
  sourceId: string
  parameters: Record<string, unknown>
}
export function quickCopyCandidates(transformers: Transformer[]): QuickCopyCandidate[] {
  return transformers
    .flatMap(transformer =>
      transformer.setups.flatMap(setup => {
        const decision = transformer.setupAvailability[setup.id]
        if (
          !setup.copyAs ||
          transformer.execution !== 'local' ||
          transformer.consentRequired ||
          !transformer.providerAvailable ||
          !transformer.resultControls.includes('copy') ||
          decision?.state !== 'ready'
        )
          return []
        const parameters = cleanParameters(
          transformer.parameterSchema,
          transformer.parameterUi ?? [],
          setup.parameters
        )
        if (
          Object.keys(
            parameterErrors(transformer.parameterSchema, transformer.parameterUi ?? [], parameters)
          ).length
        )
          return []
        return [
          {
            key: `${transformer.id}:${setup.id}`,
            transformer,
            setup,
            sourceId: decision.sourceId ?? transformer.sourceId,
            parameters,
          },
        ]
      })
    )
    .sort((a, b) => a.key.localeCompare(b.key))
}
