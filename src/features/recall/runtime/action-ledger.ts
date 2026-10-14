import type { ThreadMessage } from '@assistant-ui/react'
import type { ClipboardActivity } from '../contracts.generated'
import { isRecord } from './tools'

/** Recorded receipts establish past execution; current presence still requires a fresh read. */
export function actionLedger(messages: readonly ThreadMessage[], activity: ClipboardActivity[]) {
  return messages.flatMap(message =>
    message.content.flatMap(part => {
      if (
        part.type !== 'tool-call' ||
        !['create_clip', 'organize_clips', 'undo_clipboard_action'].includes(part.toolName) ||
        !isRecord(part.result)
      )
        return []
      const result = part.result
      const observed = activity.find(
        item => item.actorId === 'clipsx' && item.actionId === result['actionId']
      )
      return [
        {
          tool: part.toolName,
          recordedResult: result,
          latestRecordedState: observed
            ? observed.operation !== 'undo' && !observed.undoAvailable
              ? 'undone'
              : 'committed_at_time'
            : 'historical_state_unavailable',
          currentClipPresence: 'requires_fresh_read',
        },
      ]
    })
  )
}
