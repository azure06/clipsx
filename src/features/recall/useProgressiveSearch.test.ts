import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyFilters, useProgressiveSearch } from './useProgressiveSearch'
import type { ClipMatch, ClipSearchRequest, ClipSearchResult } from './contracts.generated'
const match = (id: string, semantic = false): ClipMatch => ({
  clip: {
    id,
    revision: 'revision',
    capturedAt: 1,
    sourceAppId: 'app',
    sourceAppName: 'App',
    favorite: false,
    pinned: false,
    tags: [],
    representations: [],
    ocrStatus: 'unavailable',
  },
  snippet: id,
  rank: 1,
  sources: [semantic ? 'builtin.search.semantic_text' : 'keyword'],
})
const page = (items: ClipMatch[]): ClipSearchResult => ({
  apiVersion: 1,
  items,
  nextCursor: null,
  exhaustive: true,
  sourceOutcomes: [],
  warnings: [],
})
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
afterEach(() => vi.useRealTimers())
describe('Progressive Recall retrieval', () => {
  it('returns keywords before semantic enrichment while keeping keyword order and selection', async () => {
    vi.useFakeTimers()
    const search = vi.fn((request: ClipSearchRequest) =>
      Promise.resolve(
        page(
          request.mode === 'hybrid'
            ? [match('a', true), match('related', true)]
            : [match('a'), match('b')]
        )
      )
    )
    const { result } = renderHook(() => useProgressiveSearch('query', emptyFilters, true, search))
    await advance(74)
    expect(search).not.toHaveBeenCalled()
    await advance(1)
    expect(result.current.keyword?.items.map(i => i.clip.id)).toEqual(['a', 'b'])
    expect(result.current.related).toEqual([])
    act(() => result.current.setSelectedId('b'))
    await advance(175)
    expect(result.current.related.map(i => i.clip.id)).toEqual(['related'])
    expect(result.current.keyword?.items.map(i => i.clip.id)).toEqual(['a', 'b'])
    expect(result.current.selectedId).toBe('b')
    expect(search.mock.calls.map(([request]) => request.mode)).toEqual(['keyword', 'hybrid'])
  })
  it('pauses both timers through IME composition and searches only the committed query', async () => {
    vi.useFakeTimers()
    const search = vi.fn(() => Promise.resolve(page([])))
    const { result, rerender } = renderHook(
      ({ query }) => useProgressiveSearch(query, emptyFilters, true, search),
      { initialProps: { query: '' } }
    )
    act(() => result.current.compositionStart())
    rerender({ query: 'に' })
    await advance(500)
    rerender({ query: '日本語' })
    await advance(500)
    expect(search).not.toHaveBeenCalled()
    act(() => result.current.compositionEnd())
    await advance(75)
    expect(search).toHaveBeenCalledOnce()
    await advance(175)
    expect(search).toHaveBeenCalledTimes(2)
  })
  it('ignores late old replies even before the next debounce fires', async () => {
    vi.useFakeTimers()
    const pending = new Map<string, (value: ClipSearchResult) => void>()
    const search = (request: ClipSearchRequest) =>
      new Promise<ClipSearchResult>(resolve => pending.set(request.query, resolve))
    const { result, rerender } = renderHook(
      ({ query }) => useProgressiveSearch(query, emptyFilters, false, search),
      { initialProps: { query: 'old' } }
    )
    await advance(75)
    rerender({ query: 'new' })
    await act(() => {
      pending.get('old')?.(page([match('old')]))
      return Promise.resolve()
    })
    expect(result.current.keyword).toBeNull()
    await advance(75)
    await act(() => {
      pending.get('new')?.(page([match('new')]))
      return Promise.resolve()
    })
    expect(result.current.keyword?.items[0]?.clip.id).toBe('new')
  })
  it('excludes a result only within its current query/filter context', async () => {
    vi.useFakeTimers()
    const search = vi.fn((request: ClipSearchRequest) =>
      Promise.resolve(page(request.filters?.excludedClipIds.includes('a') ? [] : [match('a')]))
    )
    const { result, rerender } = renderHook(
      ({ query }) => useProgressiveSearch(query, emptyFilters, false, search),
      { initialProps: { query: 'first' } }
    )
    await advance(75)
    act(() => result.current.dismiss('a'))
    expect(result.current.keyword?.items).toEqual([])
    await advance(75)
    expect(search.mock.calls.at(-1)?.[0].filters?.excludedClipIds).toEqual(['a'])
    rerender({ query: 'second' })
    await advance(75)
    expect(search.mock.calls.at(-1)?.[0].filters?.excludedClipIds).toEqual([])
    expect(result.current.keyword?.items[0]?.clip.id).toBe('a')
  })
})
