import { useMemo } from 'react'
import type { ClipItem } from '../../shared/types'
import { ContentPreview, clipToContent, getTypeColor } from '../content'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { useClipboardStore } from '../../stores/clipboardStore'

interface ClipPreviewProps {
  clip: ClipItem
}

export const ClipPreview = ({ clip }: ClipPreviewProps) => {
  const { deleteClip, togglePin, toggleFavorite, generateEmbedding } = useClipboardStore()

  // Convert ClipItem to unified Content
  const content = useMemo(() => clipToContent(clip), [clip])

  const actionContext = useMemo(
    () => ({
      onDelete: (id: string) => deleteClip(id),
      onTogglePin: (id: string) => togglePin(id),
      onToggleFavorite: (id: string) => toggleFavorite(id),
      onGenerateEmbedding: (id: string) => void generateEmbedding(id),
    }),
    [deleteClip, togglePin, toggleFavorite, generateEmbedding]
  )

  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden my-0.5 mr-2 bg-slate-100/10 dark:bg-slate-100/5 backdrop-blur-xl">
      {/* Header: L2 — slightly more opaque */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100/10 dark:border-slate-100/5 shrink-0 bg-slate-100/40 dark:bg-slate-100/5">
        <div className="flex items-center gap-3">
          {/* Type badge: L3 */}
          <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-100/50 dark:bg-slate-100/10">
            <span className={`w-1.5 h-1.5 rounded-full ${getTypeColor(content.type)}`} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-gray-400">
              {content.type}
            </span>
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-500 tabular-nums">
            {new Date(clip.createdAt * 1000).toLocaleString()}
          </span>
        </div>

        {/* Actions Toolbar - Replaces bottom grid */}
        <div className="flex items-center gap-1">
          <ClipActionsToolbar content={content} context={actionContext} />
        </div>
      </div>

      {/* Main Content Body - Maximized */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-0 relative">
        <ContentPreview content={content} />
      </div>

      {/* Status Bar: L2 */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1 bg-slate-100/40 dark:bg-black/20 border-t border-slate-100/10 dark:border-slate-100/5 text-[10px] text-gray-600 dark:text-gray-500 font-mono">
        <div className="flex items-center gap-4">
          <span>{content.text.length} chars</span>
          {content.metadata.line_count && <span>{content.metadata.line_count} lines</span>}
          {content.metadata.language && <span>{content.metadata.language}</span>}
        </div>
        <div>
          {content.clip.appName && (
            <span className="text-gray-600 dark:text-gray-400">
              <span className="opacity-60 mr-1">Source:</span>
              {content.clip.appName}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
