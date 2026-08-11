import type { ClipItem } from '../../../shared/types'
import { ClipboardListItem } from '../components'

type ClipboardListViewProps = {
  readonly clips: ClipItem[]
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
}: ClipboardListViewProps) => (
  <div ref={scrollContainerRef} className="custom-scrollbar flex-1 overflow-y-auto">
    {clips.map((clip, index) => (
      <ClipboardListItem
        key={clip.id}
        clip={clip}
        onCopy={onCopy}
        onSelect={onSelect}
        onDoubleClick={onDoubleClick}
        isSelected={index === selectedIndex}
        index={index}
      />
    ))}
    {infiniteScrollTrigger}
  </div>
)
