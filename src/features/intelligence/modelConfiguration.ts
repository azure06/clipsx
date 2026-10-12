import type { AiConnection, AiModelPreset, AiProviderKind } from '../recall/contracts.generated'

export const providerNames: Record<AiProviderKind, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  tavily: 'Tavily',
}
export const endpoints: Record<AiProviderKind, string> = {
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  tavily: 'https://api.tavily.com',
}
export const emptyConnection = (): AiConnection => ({
  id: crypto.randomUUID(),
  name: '',
  provider: 'ollama',
  baseUrl: endpoints.ollama,
  enabled: true,
  options: { organization: null, project: null },
})
export const emptyPreset = (connectionId: string): AiModelPreset => ({
  id: crypto.randomUUID(),
  name: '',
  connectionId,
  modelId: '',
  purpose: 'chat',
  contextLimit: 32768,
  outputLimit: 4096,
  options: {
    temperature: null,
    openai: null,
    anthropic: null,
    gemini: null,
    embedding: null,
    limitPolicy: 'auto',
  },
  capabilities: { tools: null, vision: null, webSearch: null, source: null },
})
