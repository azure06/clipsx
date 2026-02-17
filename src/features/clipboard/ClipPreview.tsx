import { useMemo } from 'react'
import type { ClipItem } from '../../shared/types'
import { ContentPreview, clipToContent, getTypeColor } from '../content'
import { ClipActions } from './ClipActions'

interface ClipPreviewProps {
    clip: ClipItem
}

export const ClipPreview = ({ clip }: ClipPreviewProps) => {
    // Convert ClipItem to unified Content
    const content = useMemo(() => clipToContent(clip), [clip])

    return (
        <div className="flex flex-col h-full gap-4">
            <div className="w-full flex-1 flex flex-col min-h-0 border border-white/5 rounded-2xl bg-white/5 shadow-xl shadow-black/20 overflow-hidden">
                {/* Compact Header with inline metadata */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0 bg-white/[0.02]">
                    <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${getTypeColor(content.type)}`} />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                            {content.type}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500">
                        <span>{new Date(clip.createdAt).toLocaleString()}</span>
                        <span className="text-gray-600">·</span>
                        <span className="text-gray-600">{content.text.length} chars</span>
                    </div>
                </div>

                {/* Main Content Preview (Scrollable) - More space for content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                    <ContentPreview content={content} />
                </div>
            </div>

            {/* Smart Actions Grid - Fixed at bottom */}
            <div className="shrink-0">
                <ClipActions content={content} />
            </div>
        </div>
    )
}
