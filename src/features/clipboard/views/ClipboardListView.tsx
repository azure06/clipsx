import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ClipSummary } from '../../../shared/types/v2'
import { ClipboardListItem } from '../components'

type ClipboardListViewProps = {
  readonly clips: ClipSummary[]
  readonly onCopy: (text: string, clipId: string) => void
  readonly onSelect?: (text: string, clipId: string) => void
  readonly onDoubleClick?: (text: string, clipId: string) => void
  readonly infiniteScrollTrigger?: React.ReactNode
  readonly scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  readonly selectedIndex?: number
}

export const ClipboardListView = ({
  clips,
  onCopy,
  onSelect,
  onDoubleClick,
  infiniteScrollTrigger,
  scrollContainerRef,
  selectedIndex,
}: ClipboardListViewProps) => {
  const parentRef = useRef<HTMLDivElement>(null)
  // TanStack Virtual intentionally owns mutable measurement state; the React
  // compiler must not memoize the hook's returned functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: clips.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    getItemKey: index => clips[index]?.id ?? index,
    overscan: 8,
    initialRect: { width: 0, height: 600 },
  })

  useEffect(() => {
    if (selectedIndex !== undefined && selectedIndex >= 0) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    }
  }, [selectedIndex, virtualizer])

  const setScrollContainer = (node: HTMLDivElement | null) => {
    parentRef.current = node
    if (scrollContainerRef) scrollContainerRef.current = node
  }
  const virtualItems = virtualizer.getVirtualItems()
  const bootstrapClip = virtualItems.length === 0 ? clips[0] : undefined

  return (
    <div ref={setScrollContainer} className="custom-scrollbar flex-1 overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() || (bootstrapClip ? 52 : 0) }}
      >
        {bootstrapClip && (
          <div className="absolute top-0 left-0 w-full">
            <ClipboardListItem
              clip={bootstrapClip}
              onCopy={onCopy}
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
              isSelected={selectedIndex === 0}
              index={0}
            />
          </div>
        )}
        {virtualItems.map(item => {
          const clip = clips[item.index]
          if (!clip) return null
          return (
            <div
              key={clip.id}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <ClipboardListItem
                clip={clip}
                onCopy={onCopy}
                onSelect={onSelect}
                onDoubleClick={onDoubleClick}
                isSelected={item.index === selectedIndex}
                index={item.index}
              />
            </div>
          )
        })}
      </div>
      {infiniteScrollTrigger}
    </div>
  )
}
