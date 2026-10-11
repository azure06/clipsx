import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type {
  ClipFilters,
  ClipMatch,
  ClipSearchRequest,
  ClipSearchResult,
} from './contracts.generated'

export const emptyFilters: ClipFilters = {
  scope: null,
  tagId: null,
  capturedAfter: null,
  capturedBefore: null,
  sourceAppIds: [],
  excludedClipIds: [],
  representationFamilies: [],
  facetIds: [],
}
type Search = (request: ClipSearchRequest) => Promise<ClipSearchResult>
const nativeSearch: Search = request => invoke('assistant_search_clips', { request })
export function useProgressiveSearch(
  query: string,
  filters: ClipFilters,
  semanticReady: boolean,
  search: Search = nativeSearch,
  enabled = true
) {
  const [keyword, setKeyword] = useState<ClipSearchResult | null>(null)
  const [related, setRelated] = useState<ClipMatch[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const [paging, setPaging] = useState(false)
  const [composing, setComposing] = useState(false)
  const epoch = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const context = JSON.stringify({ query, filters })
  const [exclusionContext, setExclusionContext] = useState(context)
  const currentExcluded = exclusionContext === context ? excluded : []
  const filterKey = JSON.stringify(filters)
  const exclusionKey = JSON.stringify(currentExcluded)
  const frozenFilters = useMemo(() => JSON.parse(filterKey) as ClipFilters, [filterKey])
  const frozenExcluded = useMemo(() => JSON.parse(exclusionKey) as string[], [exclusionKey])
  const invalidate = useCallback(() => {
    epoch.current++
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])
  useLayoutEffect(invalidate, [context, enabled, invalidate])
  const run = useCallback(
    async (mode: 'keyword' | 'hybrid', token: number, requestFilters: ClipFilters) => {
      try {
        const response = await search({
          query,
          filters: requestFilters,
          mode,
          limit: 20,
          cursor: null,
        })
        if (epoch.current !== token) return
        if (mode === 'keyword') {
          setKeyword(response)
          setError(false)
          setPending(false)
          setSelectedId(current => current ?? response.items[0]?.clip.id ?? null)
        } else
          setRelated(
            response.items.filter(item => item.sources.some(source => source.includes('semantic')))
          )
      } catch {
        if (epoch.current !== token) return
        if (mode === 'keyword') {
          setError(true)
          setPending(false)
        } else setRelated([])
      }
    },
    [query, search]
  )
  const begin = useCallback(
    (immediate = false) => {
      invalidate()
      setRelated([])
      setPaging(false)
      if (composing) return
      const token = epoch.current
      const requestFilters = {
        ...frozenFilters,
        excludedClipIds: [...new Set([...frozenFilters.excludedClipIds, ...frozenExcluded])],
      }
      setPending(true)
      if (immediate) void run('keyword', token, requestFilters)
      else timers.current.push(setTimeout(() => void run('keyword', token, requestFilters), 75))
      if (semanticReady && query.trim())
        timers.current.push(setTimeout(() => void run('hybrid', token, requestFilters), 250))
    },
    [query, frozenFilters, frozenExcluded, semanticReady, composing, run, invalidate]
  )
  useEffect(() => {
    if (enabled) begin()
    else {
      invalidate()
      setPending(false)
      setPaging(false)
    }
    return invalidate
  }, [begin, invalidate, enabled])
  const keywordIds = new Set(keyword?.items.map(item => item.clip.id) ?? [])
  const relatedOnly = related.filter(
    item => !keywordIds.has(item.clip.id) && !currentExcluded.includes(item.clip.id)
  )
  const loadMore = async () => {
    if (!keyword?.nextCursor || pending || paging || composing) return
    const token = epoch.current
    setPaging(true)
    try {
      const response = await search({
        query,
        mode: 'keyword',
        filters: {
          ...frozenFilters,
          excludedClipIds: [...new Set([...frozenFilters.excludedClipIds, ...frozenExcluded])],
        },
        limit: 20,
        cursor: keyword.nextCursor,
      })
      if (token !== epoch.current) return
      setKeyword(current =>
        current
          ? {
              ...response,
              items: [
                ...current.items,
                ...response.items.filter(
                  item => !current.items.some(existing => existing.clip.id === item.clip.id)
                ),
              ],
            }
          : response
      )
    } catch {
      if (token === epoch.current) setError(true)
    } finally {
      if (token === epoch.current) setPaging(false)
    }
  }
  return {
    keyword,
    invalidate,
    related: relatedOnly,
    selectedId,
    setSelectedId,
    pending,
    paging,
    loadMore,
    error,
    composing,
    compositionStart: () => {
      invalidate()
      setComposing(true)
      setPending(false)
    },
    compositionEnd: () => setComposing(false),
    retrieve: () => begin(true),
    dismiss: (id: string) => {
      invalidate()
      setExclusionContext(context)
      setExcluded([...currentExcluded, id])
      setKeyword(current =>
        current ? { ...current, items: current.items.filter(item => item.clip.id !== id) } : current
      )
      setRelated(current => current.filter(item => item.clip.id !== id))
      if (selectedId === id) setSelectedId(null)
    },
    filters: {
      ...filters,
      excludedClipIds: [...new Set([...filters.excludedClipIds, ...currentExcluded])],
    },
  }
}
