import type { ClipItem } from '../../../shared/types'
import { ClipboardGridItem } from '../components'

type ClipboardGridViewProps = {
  readonly clips: ClipItem[]
  readonly onCopy: (text: string, clipId: string) => void
  readonly onDelete: (id: string) => void
  readonly onToggleFavorite: (id: string) => void
  readonly onTogglePin: (id: string) => void
  readonly infiniteScrollTrigger?: React.ReactNode
  readonly scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  readonly selectedIndex?: number
}

export const ClipboardGridView = ({
  clips,
  onCopy,
  onDelete,
  onToggleFavorite,
  onTogglePin,
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
          onCopy={text => void onCopy(text, clip.id)}
          onDelete={() => void onDelete(clip.id)}
          onToggleFavorite={() => void onToggleFavorite(clip.id)}
          onTogglePin={() => void onTogglePin(clip.id)}
          isSelected={index === selectedIndex}
          index={index}
        />
      ))}
    </div>
    {infiniteScrollTrigger}
  </div>
)

