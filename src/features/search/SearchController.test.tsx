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
  it('selects a tag by keyboard and searches within it while preserving preceding text', async () => {
    invokeMock.mockImplementation(command =>
      Promise.resolve(
        command === 'list_tags'
          ? [
              { id: 'archive', name: 'Archives', color: null },
              { id: 'project', name: 'Project archive', color: null },
            ]
          : { items: [], nextCursor: null, sourceOutcomes: [] }
      )
    )
    render(<SearchController />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'invoice @ARCH' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(invokeMock).toHaveBeenCalledWith('list_tags')
    expect(screen.getByRole('option', { name: 'Archives' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(useClipboardStore.getState().tagFilter).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(input).toHaveValue('invoice')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith('search_clips', {
      request: expect.objectContaining({ query: 'invoice', tagId: 'project' }) as unknown,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear Project archive tag filter' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(invokeMock).toHaveBeenLastCalledWith('search_clips', {
      request: expect.objectContaining({ query: 'invoice', tagId: null }) as unknown,
    })
  })

  it('shares the selected filter with History and browses tagged clips without a text query', async () => {
    const tags = [{ id: 'projects', name: 'Projects', color: null }]
    useClipboardStore.setState({ availableTags: tags })
    invokeMock.mockImplementation(command =>
      Promise.resolve(command === 'list_tags' ? tags : { items: [], nextCursor: null })
    )
    render(<SearchController />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '@' } })
    fireEvent.click(screen.getByRole('option', { name: 'Projects' }))
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(input).toHaveValue('')
    expect(invokeMock).toHaveBeenLastCalledWith('list_clips', {
      request: expect.objectContaining({ tagId: 'projects' }) as unknown,
    })
    fireEvent.keyDown(input, { key: 'Backspace' })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(useClipboardStore.getState().tagFilter).toBeNull()
    await act(() => useClipboardStore.getState().setTagFilter('projects'))
    expect(screen.getByRole('button', { name: 'Clear Projects tag filter' })).toBeVisible()
  })

  it('leaves email addresses in the search query and can dismiss tag suggestions', async () => {
    invokeMock.mockImplementation(command =>
      Promise.resolve(
        command === 'list_tags' ? [] : { items: [], nextCursor: null, sourceOutcomes: [] }
      )
    )
    render(<SearchController />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'name@example.com' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(invokeMock).toHaveBeenCalledWith('search_clips', {
      request: expect.objectContaining({ query: 'name@example.com', tagId: null }) as unknown,
    })
    fireEvent.change(input, { target: { value: '@literal' } })
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveFocus()
    expect(screen.queryByRole('listbox')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(invokeMock).toHaveBeenLastCalledWith('search_clips', {
      request: expect.objectContaining({ query: '@literal', tagId: null }) as unknown,
    })
  })

  it('shows every character immediately but submits only after 75 ms idle', async () => {
    render(<SearchController />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'd' } })
    expect(input).toHaveValue('d')
    expect(useClipboardStore.getState().resultsStale).toBe(true)
    expect(input.parentElement).toHaveAttribute('aria-busy', 'true')
    expect(input.parentElement?.querySelector('.search-loading-beam')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(50))
    fireEvent.change(input, { target: { value: 'doc' } })
    expect(input).toHaveValue('doc')
    await act(() => vi.advanceTimersByTimeAsync(74))
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
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(invokeMock).toHaveBeenCalledWith('search_clips', {
      request: expect.objectContaining({ query: '検索' }) as unknown,
    })
  })

  it('handles external clear and cancels a scheduled query on unmount', async () => {
    const { unmount } = render(<SearchController />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'old' } })
    act(() => useUIStore.getState().resetSearch())
    expect(screen.getByRole('combobox')).toHaveValue('')
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(invokeMock).toHaveBeenCalledWith('list_clips', expect.anything())
    invokeMock.mockClear()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'never submitted' } })
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('uses the current draft when a source change commits before the debounce', async () => {
    render(<SearchController />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'latest' } })
    act(() => useUIStore.getState().setSemanticActive(false))
    await act(() => vi.advanceTimersByTimeAsync(75))
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('search_clips', {
      request: expect.objectContaining({
        query: 'latest',
        enabledSourceIds: ['builtin.search.fts'],
      }) as unknown,
    })
  })
})
