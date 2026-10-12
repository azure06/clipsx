import { expect, it } from 'vitest'
import type { ThreadMessage } from '@assistant-ui/react'
import { actionLedger } from './action-ledger'

const messages = [
  {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolName: 'create_clip',
        result: { actionId: 'a', undoAvailable: true },
      },
    ],
  },
] as unknown as ThreadMessage[]

it('reconciles a historical receipt against the latest recorded reversal', () => {
  const result = actionLedger(messages, [
    { actionId: 'a', actorId: 'clipsx', operation: 'create', undoAvailable: false, createdAt: 1 },
  ])
  expect(result[0]?.latestRecordedState).toBe('undone')
  expect(result[0]?.currentClipPresence).toBe('requires_fresh_read')
  expect(messages[0]?.content[0]).toMatchObject({ result: { undoAvailable: true } })
})

it('does not infer current state from expired or another client’s records', () => {
  expect(
    actionLedger(messages, [
      {
        actionId: 'a',
        actorId: 'mcp:other',
        operation: 'create',
        undoAvailable: false,
        createdAt: 1,
      },
    ])[0]?.latestRecordedState
  ).toBe('historical_state_unavailable')
})
