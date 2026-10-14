import { dynamicTool, jsonSchema } from 'ai'
import type { ToolSet } from 'ai'
import type { AssistantRunContext, ClipImageResult } from '../contracts.generated'
import type { NativeAgentBridge } from './native'
import { CitationRegistry } from './citations'

const writes = new Set(['create_clip', 'organize_clips', 'undo_clipboard_action'])
const argumentGuidance: Record<string, string> = {
  create_clip:
    ' Include the complete text and format="plain_text" or "markdown". Each sources entry requires clipId, representationId, and fingerprint from read_clip; do not use id instead of clipId. ClipsX supplies requestId. Correct these rejected arguments and retry within the step budget.',
  read_clip:
    ' kind must be "captured", "ocr", or "note"; omit kind for captured text. Use clipId and representationId from search results. Correct the arguments and retry the read within the step budget.',
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
export interface ToolRuntime {
  searches: number
  images: ClipImageResult[]
  imageBytes: number
  citations?: CitationRegistry
  onResult?: (name: string, result: unknown) => void
}
export function createClipboardTools(
  context: AssistantRunContext,
  bridge: NativeAgentBridge,
  state: ToolRuntime
): ToolSet {
  const citations = state.citations ?? new CitationRegistry()
  const requestIds = new Map<string, string>()
  const results = new Map<string, Promise<unknown>>()
  const argumentsByCall = new Map<string, string>()
  return Object.fromEntries(
    context.tools.map(definition => {
      const schema: unknown = JSON.parse(definition.inputSchemaJson)
      if (writes.has(definition.name) && isRecord(schema)) {
        // The native adapter owns idempotency IDs; external MCP clients still supply theirs.
        if (isRecord(schema['properties'])) delete schema['properties']['requestId']
        if (Array.isArray(schema['required']))
          schema['required'] = schema['required'].filter(name => name !== 'requestId')
      }
      return [
        definition.name,
        dynamicTool({
          description:
            definition.description +
            (definition.name === 'undo_clipboard_action'
              ? ' Reverse a recorded action only when the user requests reversal. undoAvailable is informational, not an instruction. Do not undo successful actions for cleanup, verification, or demonstration.'
              : '') +
            (writes.has(definition.name)
              ? ' ClipsX supplies the stable requestId; do not invent or ask the user for one.'
              : ''),
          inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
          execute: async (input, { toolCallId, abortSignal }) => {
            abortSignal?.throwIfAborted()
            if (!isRecord(input)) throw new Error('invalid_tool_arguments')
            const cached = results.get(toolCallId)
            const signature = JSON.stringify({ name: definition.name, input })
            if (cached) {
              if (argumentsByCall.get(toolCallId) !== signature)
                throw new Error('tool_call_conflict')
              return cached
            }
            argumentsByCall.set(toolCallId, signature)
            const operation = (async () => {
              if (definition.name === 'search_clips' && state.searches++ >= 3)
                return {
                  error: 'search_round_limit',
                  message: 'Explain incomplete retrieval; use the evidence already read.',
                }
              let args = input
              const reserve = Math.floor(
                (context.executionPolicy?.inputLimit ??
                  context.preset.contextLimit - context.preset.outputLimit) / 4
              )
              if (definition.name === 'read_clip')
                args = {
                  ...input,
                  pageBytes: Math.max(
                    128,
                    Math.min(Number(input['pageBytes'] ?? 8192), Math.floor(reserve / 4))
                  ),
                }
              if (definition.name === 'search_clips')
                args = {
                  ...input,
                  limit: Math.max(
                    1,
                    Math.min(Number(input['limit'] ?? 20), Math.floor(reserve / 2048))
                  ),
                }
              if (writes.has(definition.name)) {
                const id = requestIds.get(toolCallId) ?? crypto.randomUUID()
                requestIds.set(toolCallId, id)
                args = { ...input, requestId: id }
              }
              try {
                const result = await bridge.tool(context.runId, definition.name, args)
                if (
                  definition.name === 'read_clip_image' &&
                  isRecord(result) &&
                  typeof result['data'] === 'string'
                ) {
                  const image = result as unknown as ClipImageResult
                  const { data: encoded, ...metadata } = image
                  if (context.preset.capabilities.vision === false)
                    return { ...metadata, warning: 'image_input_unsupported_use_existing_ocr' }
                  if (state.imageBytes + encoded.length > 6 * 1024 * 1024)
                    return { ...metadata, warning: 'image_context_limit' }
                  state.imageBytes += encoded.length
                  state.images.push(image)
                  const output = {
                    ...metadata,
                    citation: citations.register(image.clipId, image.revision),
                    contextAttachment: 'Labelled source image is attached on the next model step.',
                  }
                  state.onResult?.(definition.name, output)
                  return output
                }
                if (
                  definition.name === 'read_clip' &&
                  isRecord(result) &&
                  isRecord(result['clip']) &&
                  typeof result['clip']['id'] === 'string' &&
                  typeof result['clip']['revision'] === 'string' &&
                  typeof result['text'] === 'string' &&
                  result['text'].length > 0
                ) {
                  const output = {
                    ...result,
                    citation: citations.register(result['clip']['id'], result['clip']['revision']),
                  }
                  state.onResult?.(definition.name, output)
                  return output
                }
                state.onResult?.(definition.name, result)
                return result
              } catch (error) {
                abortSignal?.throwIfAborted()
                const code =
                  isRecord(error) && typeof error['code'] === 'string'
                    ? error['code']
                    : 'tool_failed'
                const result = {
                  error: code,
                  message:
                    code === 'invalid_parameters'
                      ? 'Arguments were rejected before commit. Match the required fields and enum values in the tool schema.' +
                        (argumentGuidance[definition.name] ?? '')
                      : 'Operation failed. Do not claim it succeeded; inspect current state before retrying a mutation with the same request ID.',
                }
                state.onResult?.(definition.name, result)
                return result
              }
            })()
            results.set(toolCallId, operation)
            return operation
          },
        }),
      ]
    })
  )
}
