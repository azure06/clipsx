import { dynamicTool, jsonSchema } from 'ai'
import type { ToolSet } from 'ai'
import type { AssistantRunContext, ClipImageResult } from '../contracts.generated'
import type { NativeAgentBridge } from './native'

const writes = new Set(['create_clip', 'organize_clips', 'undo_clipboard_action'])
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
export interface ToolRuntime {
  searches: number
  images: ClipImageResult[]
  imageBytes: number
  onResult?: (name: string, result: unknown) => void
}
export function createClipboardTools(
  context: AssistantRunContext,
  bridge: NativeAgentBridge,
  state: ToolRuntime
): ToolSet {
  const requestIds = new Map<string, string>()
  const results = new Map<string, Promise<unknown>>()
  const argumentsByCall = new Map<string, string>()
  return Object.fromEntries(
    context.tools.map(definition => {
      const schema: unknown = JSON.parse(definition.inputSchemaJson)
      return [
        definition.name,
        dynamicTool({
          description: definition.description,
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
                  state.onResult?.(definition.name, metadata)
                  return {
                    ...metadata,
                    contextAttachment: 'Labelled source image is attached on the next model step.',
                  }
                }
                state.onResult?.(definition.name, result)
                return result
              } catch (error) {
                abortSignal?.throwIfAborted()
                const result = {
                  error:
                    isRecord(error) && typeof error['code'] === 'string'
                      ? error['code']
                      : 'tool_failed',
                  message:
                    'Operation failed. Do not claim it succeeded; inspect current state before retrying a mutation with the same request ID.',
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
