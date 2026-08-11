import { Copy, Heart, Pin, Trash2 } from 'lucide-react'
import type { ClipItem } from '../../shared/types'
import { TagChips } from './components/TagChips'
import { NoteField } from './components/NoteField'
import { V2ViewPanel } from './V2ViewPanel'
import { TransformControls } from './TransformControls'
import { useClipboardStore } from '../../stores/clipboardStore'

interface ClipPreviewProps {
  clip: ClipItem
}

// The chrome is the archived v1 design; only the content surface is v2 resolver-driven.
export const ClipPreview = ({ clip }: ClipPreviewProps) => {
  const i18n = navigator.language
  const { deleteClip, togglePin, toggleFavorite, performCopy } = useClipboardStore()
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-100/25 my-0.5 mr-2 backdrop-blur-xl dark:border-white/5 dark:bg-slate-100/5">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100/10 bg-slate-100/40 px-4 py-2 dark:border-slate-100/5 dark:bg-slate-100/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md bg-slate-100/50 px-2 py-1 dark:bg-slate-100/10">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-gray-400">
              View
            </span>
          </div>
          <span className="text-xs tabular-nums text-gray-600 dark:text-gray-500">
            {new Date(clip.createdAt * 1000).toLocaleString(i18n)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="Copy"
            className="rounded-md p-1.5 text-gray-500 hover:bg-slate-200/60 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={() => void performCopy('', clip.id)}
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            aria-label="Favorite"
            className="rounded-md p-1.5 text-gray-500 hover:bg-slate-200/60 hover:text-amber-500 dark:text-gray-400 dark:hover:bg-white/10"
            onClick={() => void toggleFavorite(clip.id)}
          >
            <Heart
              className={`h-4 w-4 ${clip.isFavorite ? 'fill-amber-500 text-amber-500' : ''}`}
            />
          </button>
          <button
            aria-label="Pin"
            className="rounded-md p-1.5 text-gray-500 hover:bg-slate-200/60 hover:text-violet-500 dark:text-gray-400 dark:hover:bg-white/10"
            onClick={() => void togglePin(clip.id)}
          >
            <Pin className={`h-4 w-4 ${clip.isPinned ? 'fill-violet-500 text-violet-500' : ''}`} />
          </button>
          <button
            aria-label="Delete"
            className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-500/10"
            onClick={() => void deleteClip(clip.id)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <V2ViewPanel key={clip.id} clipId={clip.id} />
        <TransformControls clipId={clip.id} />
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-slate-200/70 bg-slate-100/45 px-3 py-2 dark:border-slate-100/5 dark:bg-black/10">
        <TagChips clipId={clip.id} tags={clip.tags ?? []} />
        <NoteField clipId={clip.id} />
      </div>
    </div>
  )
}
