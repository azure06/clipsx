import { ToolLoopAgent, generateText, isStepCount, tool } from 'ai'
import type { ChatModelAdapter } from '@assistant-ui/react'
import { z } from 'zod'
import { createChatModel } from '../providers'
import type { ChatConnection } from '../providers'

export const FIXTURE_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII='

/** The real SDK agent loop is the only tool executor; assistant-ui renders its output. */
export function createFixtureAdapter(
  connection: ChatConnection,
  transport: typeof fetch,
  search: () => Promise<{ evidence: string }>
): ChatModelAdapter {
  return {
    async *run({ abortSignal }) {
      const agent = new ToolLoopAgent({
        model: createChatModel(connection, 'fixture-model', transport),
        stopWhen: isStepCount(3),
        maxRetries: 0,
        maxOutputTokens: 1024,
        tools: {
          search_clips: tool({
            inputSchema: z.object({ query: z.literal('fixture') }),
            execute: search,
          }),
        },
        providerOptions:
          connection.provider === 'openai' ? { openai: { store: false } } : undefined,
      })
      const result = await agent.stream({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Find the fixture clip and inspect this source image.' },
              {
                type: 'file',
                data: `data:image/png;base64,${FIXTURE_IMAGE}`,
                mediaType: 'image/png',
              },
            ],
          },
        ],
        abortSignal,
      })
      let text = ''
      for await (const part of result.fullStream) {
        if (part.type === 'error')
          throw new Error('Provider fixture stream failed', { cause: part.error })
        if (part.type === 'text-delta') {
          text += part.text
          yield { content: [{ type: 'text', text }] }
        }
      }
      const steps = await result.steps
      if (steps.length !== 2 || text !== 'Recall verified')
        throw new Error('Provider fixture round trip failed')
      // Compaction and citation repair use this non-streaming route through the same bridge.
      const summary = await generateText({
        model: createChatModel(connection, 'fixture-model', transport),
        prompt: 'Summarize the verified fixture context.',
        abortSignal,
        maxRetries: 0,
        maxOutputTokens: 1024,
        providerOptions:
          connection.provider === 'openai' ? { openai: { store: false } } : undefined,
      })
      if (summary.text !== 'Context verified' || summary.finishReason !== 'stop')
        throw new Error('Provider fixture context operation failed')
    },
  }
}
