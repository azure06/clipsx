import type { ModelMessage } from 'ai'
import type { ThreadMessage } from '@assistant-ui/react'
import type {
  AssistantRunContext,
  ClipImageResult,
  ClipReadResult,
  ResolvedExecutionPolicy,
} from '../contracts.generated'
import type { CitationRegistry } from './citations'
import { estimateRequest } from './estimator'

const bytes = (value: string) => new TextEncoder().encode(value).length
/** Smallest excerpt worth sending; a source that cannot show this much is omitted instead. */
const MIN_EXCERPT_BYTES = 256

export interface EvidenceLimits {
  policy: ResolvedExecutionPolicy
  instructions: string
  tools: readonly unknown[]
}

function truncateUtf8(value: string, limit: number) {
  const encoded = new TextEncoder().encode(value)
  if (encoded.length <= limit) return value
  return new TextDecoder().decode(encoded.slice(0, Math.max(0, limit))).replace(/\uFFFD+$/, '')
}

interface Citation {
  number: number
  clipId: string
  revision: string
}
interface Excerpt {
  shownBytes: number
  totalBytes: number
}
const isPartialEvidence = (attachment: ClipReadResult) =>
  attachment.totalBytes > bytes(attachment.text) || Boolean(attachment.nextCursor)
const renderEvidence = (
  attachment: ClipReadResult,
  text: string,
  citation?: Citation,
  excerpt: Excerpt | undefined = isPartialEvidence(attachment)
    ? {
        shownBytes: bytes(text),
        totalBytes: Math.max(attachment.totalBytes, bytes(attachment.text)),
      }
    : undefined
) =>
  JSON.stringify({
    source: 'clipboard',
    clipId: attachment.clip.id,
    revision: attachment.clip.revision,
    kind: attachment.kind,
    text,
    representations: attachment.clip.representations,
    warnings: attachment.warnings,
    ...(citation ? { citation } : {}),
    ...(excerpt ? { truncated: true, ...excerpt } : {}),
  })

/** The whole source when it fits, otherwise an excerpt marked as truncated, or null. */
function fitEvidence(attachment: ClipReadResult, allowed: number, citation?: Citation) {
  const full = renderEvidence(attachment, attachment.text, citation)
  if (bytes(full) <= allowed) return { text: full, shortened: isPartialEvidence(attachment) }
  const textBytes = bytes(attachment.text)
  const totalBytes = Math.max(attachment.totalBytes, textBytes)
  let lower = MIN_EXCERPT_BYTES
  let upper = Math.min(textBytes, allowed)
  let fitted: string | null = null
  // JSON escaping can expand text by up to six times. Search the serialized
  // size instead of subtracting an excess that can skip every useful excerpt.
  while (lower <= upper) {
    const limit = Math.floor((lower + upper) / 2)
    const shown = truncateUtf8(attachment.text, limit)
    const text = renderEvidence(attachment, shown, citation, {
      shownBytes: bytes(shown),
      totalBytes,
    })
    if (bytes(text) <= allowed) {
      if (bytes(shown) >= MIN_EXCERPT_BYTES) fitted = text
      lower = limit + 1
    } else {
      upper = limit - 1
    }
  }
  return fitted ? { text: fitted, shortened: true } : null
}

/** Small sources stay whole; the remaining budget is shared equally by the larger ones. */
function allowances(sizes: number[], budget: number) {
  const result = sizes.map(() => 0)
  let remaining = Math.max(0, budget)
  const order = sizes.map((_, index) => index).sort((a, b) => sizes[a]! - sizes[b]!)
  order.forEach((index, position) => {
    const share = Math.floor(remaining / (order.length - position))
    const granted = Math.min(sizes[index]!, share)
    result[index] = granted
    remaining -= granted
  })
  return result
}

/**
 * Conservative byte-based token estimate; keeps the latest question intact.
 * With limits, attached evidence is shortened (never the question) so the request fits.
 */
export function fitContext(
  messages: readonly ThreadMessage[],
  context: AssistantRunContext,
  citations?: CitationRegistry,
  preserveHistory = false,
  limits?: EvidenceLimits
) {
  const budget = preserveHistory
    ? Number.MAX_SAFE_INTEGER
    : context.preset.contextLimit - context.preset.outputLimit - 1024
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
  let shortenedSources = 0
  let omittedSources = 0
  const evidence: string[] = []
  // Decide up front how much of each source can be sent when the request must fit a limit.
  let allowance: number[] | undefined
  if (limits) {
    const { policy, instructions, tools } = limits
    const estimate = (value: ModelMessage[]) =>
      estimateRequest({ messages: value, instructions, tools })
    const questionCost = estimate([latest]).tokens
    const historyCost = estimate([...converted, latest]).tokens - questionCost
    const available = Math.max(
      0,
      policy.inputLimit - Math.floor(policy.inputLimit / 4) - questionCost
    )
    // Placeholder numbering only sizes the sources; the real citation is applied below.
    const sizes = context.attachments.map(attachment =>
      bytes(
        renderEvidence(attachment, attachment.text, {
          number: 99,
          clipId: attachment.clip.id,
          revision: attachment.clip.revision,
        })
      )
    )
    const total = sizes.reduce((sum, size) => sum + size + 1, 0)
    if (total + historyCost > available)
      allowance = allowances(
        sizes,
        Math.max(available - historyCost, Math.floor(available / 2)) - sizes.length
      )
  }
  context.attachments.forEach((attachment, index) => {
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
    if (allowance) {
      const fitted = fitEvidence(attachment, allowance[index]!, citation)
      if (!fitted) {
        omittedSources++
        return
      }
      if (fitted.shortened) shortenedSources++
      evidence.push(fitted.text)
      citations?.register(attachment.clip.id, attachment.clip.revision)
      remaining -= bytes(fitted.text)
      return
    }
    const text = renderEvidence(attachment, attachment.text, citation)
    if (bytes(text) <= remaining || preserveHistory) {
      evidence.push(text)
      if (isPartialEvidence(attachment)) shortenedSources++
      citations?.register(attachment.clip.id, attachment.clip.revision)
      remaining -= bytes(text)
    } else omitted = true
  })
  const history: ModelMessage[] = []
  for (const message of converted.reverse()) {
    const size = bytes(
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    )
    if (!preserveHistory && size > remaining) {
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
  return {
    messages: [...history, { role: 'user', content } as ModelMessage],
    omitted,
    shortenedSources,
    omittedSources,
  }
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
