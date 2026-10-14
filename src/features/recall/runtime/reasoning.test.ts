import { expect, it } from 'vitest'
import { reasoningProviderOptions } from './reasoning'
import { fixtureContext } from './fixtures/context'

it('applies saved OpenRouter effort only when the conversation has no override', () => {
  const context = fixtureContext('openrouter')
  context.preset.options.openai = { reasoningEffort: 'high' }
  expect(reasoningProviderOptions(context)).toEqual({
    openrouter: { reasoning: { effort: 'high' } },
  })
  context.reasoning = { kind: 'effort', value: 'none' }
  expect(reasoningProviderOptions(context)).toEqual({
    openrouter: { reasoning: { effort: 'none' } },
  })
  context.reasoning = { kind: 'budget', tokens: 1024 }
  expect(reasoningProviderOptions(context)).toEqual({
    openrouter: { reasoning: { max_tokens: 1024 } },
  })
  context.reasoning = null
  context.preset.options.openai = null
  expect(reasoningProviderOptions(context)).toEqual({})
})
