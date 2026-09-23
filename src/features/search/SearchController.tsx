import { forwardRef, useEffect, useRef, type ComponentPropsWithoutRef } from 'react'
import { useClipboardStore } from '../../stores/clipboardStore'
import { useUIStore } from '../../stores/uiStore'
import { SearchBar, type SearchBarHandle } from './SearchBar'
import { parseSearch } from './searchQuery'

type Props = Omit<
  ComponentPropsWithoutRef<typeof SearchBar>,
  'value' | 'onChange' | 'onClear' | 'canRecall'
>

// Only this small subtree subscribes to the raw input. The history renders
// committed pages, never individual keystrokes.
export const SearchController = forwardRef<SearchBarHandle, Props>(
  function SearchController(props, ref) {
    const query = useUIStore(state => state.searchQuery)
    const setQuery = useUIStore(state => state.setSearchQuery)
    const composing = useRef(false)
    const scheduleRef = useRef<(() => void) | null>(null)

    useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const schedule = () => {
        clearTimeout(timer)
        const state = useClipboardStore.getState()
        // Invalidate synchronously, before a previous IPC response can commit
        // during the debounce interval. Do not delay the controlled input.
        state.prepareSearch(useUIStore.getState().searchQuery)
        if (!composing.current && useClipboardStore.getState().searchScheduled) {
          timer = setTimeout(() => void useClipboardStore.getState().commitSearch(), 300)
        }
      }
      scheduleRef.current = schedule
      const unsubscribe = useUIStore.subscribe((next, previous) => {
        if (next.searchQuery !== previous.searchQuery) schedule()
        if (next.isSemanticActive !== previous.isSemanticActive) {
          const state = useClipboardStore.getState()
          if (state.mode === 'search') {
            state.prepareSearch(next.searchQuery, true)
            if (composing.current) schedule()
            else void state.commitSearch()
          }
        }
      })
      schedule()
      return () => {
        clearTimeout(timer)
        unsubscribe()
        scheduleRef.current = null
      }
    }, [])

    return (
      <div
        onCompositionStartCapture={() => {
          composing.current = true
          scheduleRef.current?.()
        }}
        onCompositionEndCapture={() => {
          composing.current = false
          scheduleRef.current?.()
        }}
      >
        <SearchBar
          {...props}
          ref={ref}
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          canRecall={parseSearch(query).query.length > 0}
        />
      </div>
    )
  }
)
