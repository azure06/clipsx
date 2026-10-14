import { expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { reduceDuplicateEvidence } from './evidence'

it('reduces identical read payloads while retaining tool exchanges and all mutation receipts', () => {
  const message = (id: string, name: string): ModelMessage => ({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: name,
        output: {
          type: 'json',
          value: { text: 'large evidence'.repeat(100), nextCursor: 'real-cursor' },
        },
      },
    ],
  })
  const source = [
    message('a', 'read_clip'),
    message('b', 'read_clip'),
    message('c', 'create_clip'),
    message('d', 'create_clip'),
  ]
  const reduced = reduceDuplicateEvidence(source)
  expect(reduced).toHaveLength(4)
  expect(reduced[0]).toEqual(source[0])
  expect(JSON.stringify(reduced[1])).toContain('retainedToolCallId')
  expect(JSON.stringify(reduced[1])).not.toContain('nextCursor')
  expect(reduced.slice(2)).toEqual(source.slice(2))
  expect(JSON.stringify(source[1])).toContain('real-cursor')
})

it('retains fresh evidence when the previous exchange may be compacted', () => {
  const read: ModelMessage = {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'old',
        toolName: 'read_clip',
        output: { type: 'json', value: { text: 'source evidence' } },
      },
    ],
  }
  const later: ModelMessage = {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'new',
        toolName: 'read_clip',
        output: { type: 'json', value: { text: 'source evidence' } },
      },
    ],
  }
  const messages: ModelMessage[] = [read, { role: 'user', content: 'Follow up' }, later]
  expect(reduceDuplicateEvidence(messages)).toEqual(messages)
})
