import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchController } from './SearchController'
import { useClipboardStore } from '../../stores/clipboardStore'
import { useUIStore } from '../../stores/uiStore'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

beforeEach(() => {
  vi.useFakeTimers()
  useClipboardStore.setState(useClipboardStore.getInitialState(), true)
  useClipboardStore.getState().resetPagination()
  useClipboardStore.setState(useClipboardStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
  invokeMock.mockReset().mockResolvedValue({ items: [], nextCursor: null, sourceOutcomes: [] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('search input scheduling', () => {
  it('shows every character immediately but submits only after 300 ms idle', async () => {
    render(<SearchController />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'd' } })
    expect(input).toHaveValue('d')
    expect(useClipboardStore.getState().resultsStale).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(250))
    fireEvent.change(input, { target: { value: 'doc' } })
    expect(input).toHaveValue('doc')
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(invokeMock).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('search_clips', {
      request: expect.objectContaining({ query: 'doc', cursor: null }) as unknown,
    })
  })

  it('does not submit intermediate IME composition text', async () => {
    render(<SearchController />)
    const input = screen.getByRole('combobox')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '検索' } })
    expect(input).toHaveValue('検索')
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(invokeMock).not.toHaveBeenCalled()
    act(() => useUIStore.getState().setSemanticActive(false))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(invokeMock).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(invokeMock).toHaveBeenCalledWith('search_clips', {
      request: expect.objectContaining({ query: '検索' }) as unknown,
    })
  })

  it('handles external clear and cancels a scheduled query on unmount', async () => {
    const { unmount } = render(<SearchController />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'old' } })
    act(() => useUIStore.getState().resetSearch())
    expect(screen.getByRole('combobox')).toHaveValue('')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(invokeMock).toHaveBeenCalledWith('list_clips', expect.anything())
    invokeMock.mockClear()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'never submitted' } })
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('uses the current draft when a source change commits before the debounce', async () => {
    render(<SearchController />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'latest' } })
    act(() => useUIStore.getState().setSemanticActive(false))
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('search_clips', {
      request: expect.objectContaining({
        query: 'latest',
        enabledSourceIds: ['builtin.search.fts'],
      }) as unknown,
    })
  })
})
