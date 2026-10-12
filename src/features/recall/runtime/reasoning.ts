import type { AssistantRunContext } from '../contracts.generated'

/** Translate host-validated controls at the provider boundary, away from UI code. */
export function reasoningProviderOptions(
  context: Pick<AssistantRunContext, 'connection' | 'preset' | 'reasoning'>
): Record<
  string,
  Record<string, string | number | boolean | Record<string, string | number | boolean>>
> {
  const { connection, preset, reasoning } = context
  const effort = reasoning?.kind === 'effort' ? reasoning.value : undefined
  const budget = reasoning?.kind === 'budget' ? reasoning.tokens : undefined
  switch (connection.provider) {
    case 'openai': {
      const value = effort ?? preset.options.openai?.reasoningEffort
      return {
        openai: {
          store: false,
          ...(value
            ? { reasoningEffort: value, ...(value !== 'none' ? { reasoningSummary: 'auto' } : {}) }
            : {}),
        },
      }
    }
    case 'anthropic': {
      if (effort) return { anthropic: { thinking: { type: 'adaptive' }, effort } }
      const value = budget ?? preset.options.anthropic?.thinkingBudget
      return value ? { anthropic: { thinking: { type: 'enabled', budgetTokens: value } } } : {}
    }
    case 'gemini': {
      if (effort)
        return { google: { thinkingConfig: { thinkingLevel: effort, includeThoughts: true } } }
      const value = budget ?? preset.options.gemini?.thinkingBudget
      return value !== null && value !== undefined
        ? { google: { thinkingConfig: { thinkingBudget: value, includeThoughts: true } } }
        : {}
    }
    case 'ollama': {
      // Ollama's compatibility API maps recognized efforts to boolean thinking controls.
      const value = reasoning?.kind === 'thinking' ? (reasoning.enabled ? 'low' : 'none') : effort
      return value ? { ollama: { reasoningEffort: value } } : {}
    }
    case 'tavily':
      return {}
    case 'openrouter':
      return effort
        ? { openrouter: { reasoning: { effort } } }
        : budget
          ? { openrouter: { reasoning: { max_tokens: budget } } }
          : {}
  }
}
