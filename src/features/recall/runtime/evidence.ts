import type { ModelMessage } from 'ai'

const retrieval = new Set(['search_clips', 'read_clip', 'read_clip_image'])

/** Keep call/result pairs intact, replacing only exact duplicate read payloads with references. */
export function reduceDuplicateEvidence(messages: readonly ModelMessage[]): ModelMessage[] {
  const retained = new Map<string, string>()
  return messages.map(message => {
    // A reference must not cross an exchange boundary that a planner may summarize.
    if (message.role === 'user') retained.clear()
    if (message.role !== 'tool') return message
    return {
      ...message,
      content: message.content.map(part => {
        if (
          part.type !== 'tool-result' ||
          !retrieval.has(part.toolName) ||
          part.output.type !== 'json'
        )
          return part
        const key = JSON.stringify([part.toolName, part.output.value])
        const previous = retained.get(key)
        if (!previous) {
          retained.set(key, part.toolCallId)
          return part
        }
        return {
          ...part,
          output: {
            type: 'json' as const,
            value: {
              contextNote:
                'Exact duplicate retrieval payload; evidence remains in the referenced tool result.',
              retainedToolCallId: previous,
            },
          },
        }
      }),
    }
  })
}
