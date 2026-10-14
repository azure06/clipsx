import { wrapLanguageModel } from 'ai'
import type { ModelMessage } from 'ai'
import { transportFailure } from './failures'

type Model = Parameters<typeof wrapLanguageModel>[0]['model']
type Prompt = Parameters<ReturnType<typeof wrapLanguageModel>['doStream']>[0]['prompt']

/** Retry only a request rejected before its stream exists; the agent/tool loop is never restarted. */
export function withContextRecovery(
  model: Model,
  options: {
    questionText: string
    summarize: (older: ModelMessage[]) => Promise<ModelMessage>
    onRecovered: () => void
  }
) {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      wrapStream: async ({ doStream, model: underlying, params }) => {
        try {
          return await doStream()
        } catch (error) {
          if (transportFailure(error) !== 'context_overflow' || params.abortSignal?.aborted)
            throw error
          const anchor = params.prompt.findLastIndex(
            message =>
              message.role === 'user' &&
              message.content.some(
                part => part.type === 'text' && part.text === options.questionText
              )
          )
          if (anchor < 1) throw error
          const older = params.prompt.slice(0, anchor).filter(m => m.role !== 'system')
          if (!older.length) throw error
          const summary = await options.summarize(
            older.map(message => ({
              role: message.role === 'assistant' ? 'assistant' : 'user',
              content: JSON.stringify(message.content),
            }))
          )
          if (typeof summary.content !== 'string')
            throw new Error('invalid_context_summary', { cause: error })
          const prompt: Prompt = [
            ...params.prompt.filter(m => m.role === 'system'),
            { role: 'user', content: [{ type: 'text', text: summary.content }] },
            ...params.prompt.slice(anchor),
          ]
          if (JSON.stringify(prompt).length >= JSON.stringify(params.prompt).length)
            throw new Error('context_limit', { cause: error })
          options.onRecovered()
          return underlying.doStream({ ...params, prompt })
        }
      },
    },
  })
}
