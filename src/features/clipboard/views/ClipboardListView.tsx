import type { ClipItem } from '../../../shared/types'
import { ClipboardListItem } from '../components'

type ClipboardListViewProps = {
  readonly clips: ClipItem[]
  readonly onCopy: (text: string, clipId: string) => void
  readonly onDelete: (id: string) => void
  readonly onToggleFavorite: (id: string) => void
  readonly onTogglePin: (id: string) => void
  readonly infiniteScrollTrigger?: React.ReactNode
  readonly scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

export const ClipboardListView = ({
  clips,
  onCopy,
  onDelete,
  onToggleFavorite,
  onTogglePin,
  infiniteScrollTrigger,
  scrollContainerRef,
}: ClipboardListViewProps) => (
  <div ref={scrollContainerRef} className="custom-scrollbar flex-1 overflow-y-auto">
    {clips.map(clip => (
      <ClipboardListItem
        key={clip.id}
        clip={clip}
        onCopy={text => void onCopy(text, clip.id)}
        onDelete={() => void onDelete(clip.id)}
        onToggleFavorite={() => void onToggleFavorite(clip.id)}
        onTogglePin={() => void onTogglePin(clip.id)}
      />
    ))}
    {infiniteScrollTrigger}
  </div>
)
