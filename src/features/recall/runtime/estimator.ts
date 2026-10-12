import type { ModelMessage } from 'ai'

export interface RequestEstimate {
  tokens: number
  estimated: true
}
export interface RequestInput {
  messages: readonly ModelMessage[]
  instructions: string
  tools: readonly unknown[]
}
export type RequestEstimator = (input: RequestInput) => RequestEstimate
export const utf8Size = (value: string): number => new TextEncoder().encode(value).length

/** Deliberately conservative; bytes are not claimed to be exact model tokens. */
export const estimateRequest: RequestEstimator = ({ messages, instructions, tools }) => {
  let tokens = utf8Size(instructions) + utf8Size(JSON.stringify(tools)) + 128
  for (const message of messages) {
    tokens += 32
    if (typeof message.content === 'string') tokens += utf8Size(message.content)
    else
      for (const part of message.content) {
        // Base64 byte length is not an image-token count. Reserve a bounded image allowance.
        tokens +=
          part.type === 'file' || part.type === 'image' ? 8192 : utf8Size(JSON.stringify(part))
      }
  }
  return { tokens, estimated: true }
}
