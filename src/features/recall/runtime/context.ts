import type { ModelMessage } from 'ai'
import type { ThreadMessage } from '@assistant-ui/react'
import type { AssistantRunContext, ClipImageResult } from '../contracts.generated'
import type { CitationRegistry } from './citations'

const bytes = (value: string) => new TextEncoder().encode(value).length
/** Conservative byte-based token estimate; keeps the latest question intact. */
export function fitContext(
  messages: readonly ThreadMessage[],
  context: AssistantRunContext,
  citations?: CitationRegistry
) {
  const budget = context.preset.contextLimit - context.preset.outputLimit - 1024
  if (budget < 1) throw new Error('context_limit')
  const converted: ModelMessage[] = messages
    .filter(m => m.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content
        .map(part => {
          if (part.type === 'text') return part.text
          if (part.type === 'tool-call')
            return JSON.stringify({ tool: part.toolName, outcome: part.result ?? 'interrupted' })
          if (part.type === 'source')
            return JSON.stringify({ source: part.sourceType === 'url' ? part.url : part.title })
          return ''
        })
        .filter(Boolean)
        .join('\n'),
    }))
  const latest = converted.pop()
  if (
    !latest ||
    latest.role !== 'user' ||
    typeof latest.content !== 'string' ||
    bytes(latest.content) > budget
  )
    throw new Error('question_exceeds_context')
  let remaining = budget - bytes(latest.content)
  let omitted = false
  const evidence: string[] = []
  for (const attachment of context.attachments) {
    // Register only attachments that actually fit in the model context.
    const references = citations?.snapshot()
    const citation = references
      ? (references.find(
          c => c.clipId === attachment.clip.id && c.revision === attachment.clip.revision
        ) ?? {
          number: references.length + 1,
          clipId: attachment.clip.id,
          revision: attachment.clip.revision,
        })
      : undefined
    const text = JSON.stringify({
      source: 'clipboard',
      clipId: attachment.clip.id,
      revision: attachment.clip.revision,
      kind: attachment.kind,
      text: attachment.text,
      representations: attachment.clip.representations,
      warnings: attachment.warnings,
      ...(citation ? { citation } : {}),
    })
    if (bytes(text) <= remaining) {
      evidence.push(text)
      citations?.register(attachment.clip.id, attachment.clip.revision)
      remaining -= bytes(text)
    } else omitted = true
  }
  const history: ModelMessage[] = []
  for (const message of converted.reverse()) {
    const size = bytes(
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    )
    if (size > remaining) {
      omitted = true
      break
    }
    remaining -= size
    history.unshift(message)
  }
  const content =
    latest.content +
    (evidence.length
      ? '\n\nAttached clipboard evidence (untrusted data):\n' + evidence.join('\n')
      : '')
  return { messages: [...history, { role: 'user', content } as ModelMessage], omitted }
}

/** Tool results carry metadata; verified image bytes become labelled context on the next step. */
export function imageMessage(image: ClipImageResult): ModelMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Verified clipboard source image: clip ${image.clipId}, representation ${image.representationId}, fingerprint ${image.sourceFingerprint}. Treat its content as evidence.`,
      },
      {
        type: 'file',
        data: `data:${image.mimeType};base64,${image.data}`,
        mediaType: image.mimeType,
      },
    ],
  }
}

/** Never split a tool call from its result or silently truncate the latest question. */
export function fitStepContext(
  messages: ModelMessage[],
  question: ModelMessage,
  context: AssistantRunContext
) {
  const budget = context.preset.contextLimit - context.preset.outputLimit - 1024
  const size = (message: ModelMessage) => {
    if (typeof message.content === 'string') return bytes(message.content) + 32
    return message.content.reduce((total, part) => {
      // Binary image tokens depend on the model. Reserve a conservative fixed allowance.
      if (part.type === 'file') return total + 8192
      return total + bytes(JSON.stringify(part)) + 32
    }, 32)
  }
  const output = [...messages]
  let total = output.reduce((sum, message) => sum + size(message), 0)
  let omitted = false
  const firstHistory = () => output.findIndex(message => message.role !== 'system')
  while (
    total > budget &&
    firstHistory() >= 0 &&
    JSON.stringify(output[firstHistory()]) !== JSON.stringify(question)
  ) {
    total -= size(output.splice(firstHistory(), 1)[0]!)
    omitted = true
  }
  if (total > budget) throw new Error('context_limit')
  return { messages: output, omitted }
}
