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
  it('sorts by run creation rather than completion and rejects an old clip response', async () => {
    let finishOld!: (value: unknown[]) => void
    invoke
      .mockImplementationOnce(
        () =>
          new Promise<unknown[]>(resolve => {
            finishOld = resolve
          })
      )
      .mockResolvedValueOnce([
        { jobId: 'new-run', createdAt: 20, completedAt: 21 },
        { jobId: 'old-run', createdAt: 10, completedAt: 30 },
      ])
    const mounted = renderHook(({ id }) => useClipExtensionJobs(id), {
      initialProps: { id: 'old-clip' },
    })
    const oldRefresh = mounted.result.current.refresh
    mounted.rerender({ id: 'new-clip' })
    await act(async () => {})
    expect(mounted.result.current.jobs.map(job => job.jobId)).toEqual(['new-run', 'old-run'])
    await act(() => Promise.resolve(finishOld([{ jobId: 'stale', createdAt: 999 }])))
    await act(() => oldRefresh())
    expect(mounted.result.current.jobs.map(job => job.jobId)).toEqual(['new-run', 'old-run'])
  })
})
