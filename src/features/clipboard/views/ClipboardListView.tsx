import { memo, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ClipSummary } from '../../../shared/types/v2'
import { ClipboardListItem } from '../components'

type ClipboardListViewProps = {
  readonly clips: ClipSummary[]
  readonly pinnedHeader?: React.ReactNode
  readonly pinnedCount?: number
  readonly relatedClipIds?: string[]
  readonly onCopy: (text: string, clipId: string) => void
  readonly onSelect?: (text: string, clipId: string) => void
  readonly onDoubleClick?: (text: string, clipId: string) => void
  readonly infiniteScrollTrigger?: React.ReactNode
  readonly scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  readonly selectedIndex?: number
}

export const ClipboardListView = memo(function ClipboardListView({
  clips,
  pinnedHeader,
  pinnedCount = 0,
  onCopy,
  onSelect,
  onDoubleClick,
  infiniteScrollTrigger,
  scrollContainerRef,
  selectedIndex,
  relatedClipIds,
}: ClipboardListViewProps) {
  const { t } = useTranslation()
  const relatedStart = relatedClipIds?.length
    ? clips.findIndex(clip => relatedClipIds.includes(clip.id))
    : -1
  const relatedHeading = (
    <div className="px-4 pt-3 pb-1 text-[11px] font-semibold text-slate-500">
      {t('recallPage.relatedMatches')}
    </div>
  )
  const hasPinnedHeader = Boolean(pinnedHeader)
  // Section headings are measured rows in the same scroll surface as clips.
  const rows = useMemo(() => {
    const result: { key: string; clipIndex?: number; heading?: 'pinned' | 'recent' }[] = []
    if (hasPinnedHeader) result.push({ key: 'section:pinned', heading: 'pinned' })
    clips.forEach((clip, index) => {
      if (hasPinnedHeader && index === pinnedCount)
        result.push({ key: 'section:recent', heading: 'recent' })
      result.push({ key: `clip:${clip.id}`, clipIndex: index })
    })
    return result
  }, [clips, hasPinnedHeader, pinnedCount])
  const selectedRow =
    selectedIndex === undefined ? -1 : rows.findIndex(row => row.clipIndex === selectedIndex)
  const parentRef = useRef<HTMLDivElement>(null)
  // TanStack Virtual intentionally owns mutable measurement state; the React
  // compiler must not memoize the hook's returned functions.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: index => (rows[index]?.heading ? 40 : 52),
    getItemKey: index => rows[index]?.key ?? index,
    overscan: 8,
    initialRect: { width: 0, height: 600 },
  })

  useEffect(() => {
    if (selectedRow >= 0) {
      virtualizer.scrollToIndex(selectedRow, { align: 'auto' })
    }
  }, [selectedRow, virtualizer])

  const setScrollContainer = useCallback(
    (node: HTMLDivElement | null) => {
      parentRef.current = node
      if (scrollContainerRef) scrollContainerRef.current = node
    },
    [scrollContainerRef]
  )
  const virtualItems = virtualizer.getVirtualItems()
  let estimatedStart = 0
  const renderedItems = virtualItems.length
    ? virtualItems
    : rows.slice(0, 12).map((row, index) => {
        const start = estimatedStart
        estimatedStart += row.heading ? 40 : 52
        return { index, start }
      })

  return (
    <div ref={setScrollContainer} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() || (rows.length ? 52 : 0) }}
      >
        {renderedItems.map(item => {
          const row = rows[item.index]
          if (!row) return null
          const clip = row.clipIndex === undefined ? undefined : clips[row.clipIndex]
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.heading === 'pinned' ? (
                pinnedHeader
              ) : row.heading === 'recent' ? (
                <div className="px-4 pt-3 pb-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {t('clipboard.recentClips')}
                </div>
              ) : clip ? (
                <>
                  {row.clipIndex === relatedStart && relatedHeading}
                  <ClipboardListItem
                    clip={clip}
                    onCopy={onCopy}
                    onSelect={onSelect}
                    onDoubleClick={onDoubleClick}
                    isSelected={row.clipIndex === selectedIndex}
                    index={row.clipIndex}
                  />
                </>
              ) : null}
            </div>
          )
        })}
      </div>
      {infiniteScrollTrigger}
    </div>
  )
})
