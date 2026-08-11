import type { ClipSummary } from '../../../shared/types/v2'
import { ClipboardGridItem } from '../components'

type ClipboardGridViewProps = {
  readonly clips: ClipSummary[]
  readonly onCopy: (text: string, clipId: string) => void
  readonly onSelect?: (text: string, clipId: string) => void
  readonly onDoubleClick?: (text: string, clipId: string) => void
  readonly infiniteScrollTrigger?: React.ReactNode
  readonly scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  readonly selectedIndex?: number
}

export const ClipboardGridView = ({
  clips,
  onCopy,
  onSelect,
  onDoubleClick,
  infiniteScrollTrigger,
  scrollContainerRef,
  selectedIndex,
}: ClipboardGridViewProps) => (
  <div ref={scrollContainerRef} className="custom-scrollbar flex-1 overflow-y-auto p-3">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {clips.map((clip, index) => (
        <ClipboardGridItem
          key={clip.id}
          clip={clip}
          onCopy={onCopy}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
          isSelected={index === selectedIndex}
          index={index}
        />
      ))}
    </div>
    {infiniteScrollTrigger}
  </div>
)
