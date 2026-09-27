import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClipExtensionJobs } from './useClipExtensionJobs'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }))
afterEach(() => {
  vi.useRealTimers()
  invoke.mockReset()
})
describe('persisted extension status refresh', () => {
  it('discovers automatic jobs and failures without a completion event and stops polling on unmount', async () => {
    vi.useFakeTimers()
    invoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ jobId: 'auto', status: 'running' }])
      .mockResolvedValueOnce([{ jobId: 'auto', status: 'failed' }])
    const { result, unmount } = renderHook(() => useClipExtensionJobs('clip'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.jobs).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current.jobs[0]?.status).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current.jobs[0]?.status).toBe('failed')
    unmount()
    await vi.advanceTimersByTimeAsync(4000)
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
