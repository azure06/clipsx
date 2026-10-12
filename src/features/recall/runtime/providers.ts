import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel, ToolSet } from 'ai'

export type ChatProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openrouter'

// This is deliberately not a credential. Rust replaces it at the network boundary.
export const TRANSPORT_PLACEHOLDER = 'clipsx-host-transport'

export interface ChatConnection {
  id: string
  provider: ChatProvider
  baseUrl: string
}

/** Called only from the lazy Recall runtime; no provider performs direct browser fetches. */
export function createChatModel(
  connection: ChatConnection,
  modelId: string,
  transport: typeof fetch
): LanguageModel {
  const options = { baseURL: connection.baseUrl, apiKey: TRANSPORT_PLACEHOLDER, fetch: transport }
  switch (connection.provider) {
    case 'openai':
      return createOpenAI(options).responses(modelId)
    case 'anthropic':
      return createAnthropic(options)(modelId)
    case 'gemini':
      return createGoogleGenerativeAI(options)(modelId)
    case 'openrouter':
      return createOpenRouter(options).chat(modelId)
    case 'ollama':
      return createOpenAICompatible({ ...options, name: 'ollama', includeUsage: true }).chatModel(
        modelId
      )
  }
}

export function createNativeWebTools(connection: ChatConnection, transport: typeof fetch): ToolSet {
  const options = { baseURL: connection.baseUrl, apiKey: TRANSPORT_PLACEHOLDER, fetch: transport }
  switch (connection.provider) {
    case 'openai':
      return { web_search: createOpenAI(options).tools.webSearch({ searchContextSize: 'low' }) }
    case 'anthropic':
      return { web_search: createAnthropic(options).tools.webSearch_20250305({ maxUses: 3 }) }
    case 'gemini':
      return { google_search: createGoogleGenerativeAI(options).tools.googleSearch({}) }
    default:
      return {}
  }
}
