import type { AssistantRunContext } from '../../contracts.generated'
import type { ChatProvider } from '../providers'

export function fixtureContext(provider: ChatProvider = 'ollama'): AssistantRunContext {
  return {
    runId: 'fixture',
    connection: {
      id: provider,
      name: provider,
      provider,
      baseUrl: 'https://fixture.invalid/v1/',
      enabled: true,
      options: { organization: null, project: null },
    },
    preset: {
      id: 'preset',
      name: 'Fixture',
      connectionId: provider,
      modelId: 'fixture-model',
      purpose: 'chat',
      contextLimit: 32768,
      outputLimit: 1024,
      options: { temperature: null, openai: null, anthropic: null, gemini: null, embedding: null },
      capabilities: { tools: true, vision: true, webSearch: false, source: 'fixture' },
    },
    filters: {
      scope: null,
      tagId: null,
      capturedAfter: null,
      capturedBefore: null,
      sourceAppIds: [],
      excludedClipIds: [],
      representationFamilies: [],
      facetIds: [],
    },
    attachments: [],
    status: {
      apiVersion: 1,
      now: 1,
      timezone: 'UTC',
      keywordReady: true,
      semanticReady: false,
      tools: ['search_clips'],
      resultLimit: 50,
      organizationLimit: 50,
      defaultTextPageBytes: 8192,
      maxTextPageBytes: 32768,
      maxImageBytes: 4194304,
    },
    tools: [
      {
        name: 'search_clips',
        description: 'Search eligible clipboard evidence',
        inputSchemaJson: JSON.stringify({
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        }),
      },
    ],
    webRoute: 'off',
    reasoning: null,
  }
}
