import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecallEvent } from '../../shared/types/v2'
import { useRecall, type RecallScope } from './useRecall'

const { invokeMock, channels } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  channels: [] as Array<{ onmessage?: (event: RecallEvent) => void }>,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage?: (event: RecallEvent) => void
    constructor() {
      channels.push(this)
    }
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

const scope: RecallScope = {
  scope: 'all',
  tagId: null,
  representationFamilies: [],
  facetIds: [],
  enabledSourceIds: [],
  label: 'All history',
}

beforeEach(() => {
  vi.useFakeTimers()
  channels.length = 0
  invokeMock
    .mockReset()
    .mockImplementation((command: string) =>
      command === 'start_recall_turn' ? new Promise(() => {}) : Promise.resolve()
    )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Recall elapsed time', () => {
  it('advances during a request, stops on completion, and resets for the next request', () => {
    const { result } = renderHook(() => useRecall())

    act(() => {
      void result.current.startRoot('first question', scope)
    })
    expect(result.current.elapsedSeconds).toBe(0)

    act(() => {
      vi.advanceTimersByTime(2_100)
    })
    expect(result.current.elapsedSeconds).toBe(2)

    const requestId = result.current.activeRequestId
    expect(requestId).not.toBeNull()
    act(() => {
      channels[0]?.onmessage?.({
        type: 'completed',
        requestId: requestId!,
        answer: 'Answer',
        completionReason: 'stop',
        providerId: 'local',
        model: 'test',
        executionLocation: 'local',
      })
    })
    expect(result.current.isRunning).toBe(false)

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current.elapsedSeconds).toBe(2)

    act(() => {
      void result.current.startRoot('second question', scope)
    })
    expect(result.current.elapsedSeconds).toBe(0)
    act(() => {
      vi.advanceTimersByTime(1_100)
    })
    expect(result.current.elapsedSeconds).toBe(1)
  })
})
