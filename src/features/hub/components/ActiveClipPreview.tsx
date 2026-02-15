
import { useMemo } from 'react'
import type { ClipItem } from '../../../shared/types'
import type { DetectedContent } from '../../intelligence/types'
import { ActionGrid } from './ActionGrid'

interface ActiveClipPreviewProps {
    clip: ClipItem
}

// Helper interface for raw JSON metadata from backend
interface ParsedMetadata {
    url?: string
    domain?: string
    protocol?: string
    original?: string
    hex?: string
    value?: string
    type?: string
    language?: string
    score?: number
    email?: string
    word_count?: number
    line_count?: number
}

export const ActiveClipPreview = ({ clip }: ActiveClipPreviewProps) => {
    // const { getActions } = useIntelligence() // UNUSED

    // 1. Construct Content Object from Backend Data (Instant)
    const content = useMemo<DetectedContent>(() => {
        const text = clip.contentText || ''
        let metadata: ParsedMetadata = {}

        try {
            if (clip.metadata) {
                metadata = JSON.parse(clip.metadata) as ParsedMetadata
            }
        } catch (e) {
            console.error("Failed to parse clip metadata", e)
        }

        // Map backend types to frontend DetectedContent structure
        switch (clip.detectedType) {
            case 'url':
                return {
                    type: 'url',
                    originalText: text,
                    score: 1,
                    metadata: {
                        url: metadata.url || text,
                        domain: metadata.domain,
                        protocol: metadata.protocol
                    }
                }
            case 'color':
                return {
                    type: 'color',
                    originalText: text,
                    score: 1,
                    metadata: {
                        value: metadata.value || metadata.original || text,
                        hex: metadata.hex || text,
                        rgb: metadata.type === 'rgb' ? text : '',
                        hsl: ''
                    }
                }
            case 'code':
                return {
                    type: 'code',
                    originalText: text,
                    score: metadata.score || 1,
                    metadata: {
                        language: metadata.language || 'text',
                        lineCount: text.split('\n').length
                    }
                }
            case 'email':
                return {
                    type: 'email',
                    originalText: text,
                    score: 1,
                    metadata: {
                        email: metadata.email || text,
                        domain: metadata.domain
                    }
                }
            default:
                // Default / Fallback
                return {
                    type: 'text',
                    originalText: text,
                    score: 1,
                    metadata: {
                        wordCount: metadata.word_count || 0,
                        lines: metadata.line_count || 0
                    }
                }
        }
    }, [clip])

    if (!content) return null

    return (
        <div className="flex flex-col h-full gap-6">
            <div className="w-full flex-1 flex flex-col min-h-0 border border-white/5 rounded-2xl bg-white/5 shadow-xl shadow-black/20 overflow-hidden">
                {/* Header (Fixed) */}
                <div className="flex items-center justify-between p-6 pb-4 shrink-0">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${getTypeColor(content.type)}`} />
                        {content.type.toUpperCase()} DETECTED
                    </div>
                </div>

                {/* Main Content Renderers (Scrollable) */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 pt-0">
                    <div className="text-2xl font-light text-white/90 break-words min-h-16">
                        {renderPreview(content)}
                    </div>
                </div>

                {/* Metadata Footer (Fixed) */}
                <div className="p-6 pt-4 border-t border-white/5 text-xs text-gray-500 flex items-center justify-between shrink-0 bg-white/5">
                    <span>{new Date(clip.createdAt).toLocaleString()}</span>
                    {renderMetadata(content)}
                </div>
            </div>

            {/* Smart Actions Grid - Fixed at bottom */}
            <div className="shrink-0">
                <ActionGrid content={content} />
            </div>
        </div>
    )
}

// Helper: Type Color Indicator
const getTypeColor = (type: string) => {
    switch (type) {
        case 'url': return 'bg-blue-400'
        case 'color': return 'bg-purple-400'
        case 'code': return 'bg-yellow-400'
        case 'email': return 'bg-green-400'
        default: return 'bg-gray-400'
    }
}

// Helper: Render Content Body
const renderPreview = (content: DetectedContent) => {
    switch (content.type) {
        case 'url':
            return (
                <a
                    href={content.metadata.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline underline-offset-4 decoration-blue-400/30 transition-colors"
                >
                    {content.originalText}
                </a>
            )
        case 'color':
            return (
                <div className="flex items-center gap-4">
                    <div
                        className="w-16 h-16 rounded-xl shadow-lg border-2 border-white/10"
                        style={{ backgroundColor: content.metadata.value }}
                    />
                    <div className="flex flex-col">
                        <span className="font-mono text-3xl font-bold tracking-tight">{content.metadata.value}</span>
                        <span className="text-sm text-gray-500 uppercase">{content.metadata.hex}</span>
                    </div>
                </div>
            )
        case 'code':
            return (
                <div className="font-mono text-sm bg-black/30 p-4 rounded-lg border border-white/5 overflow-x-auto">
                    <pre>{content.originalText}</pre>
                </div>
            )
        default:
            return content.originalText
    }
}

// Helper: Render Metadata Badges
const renderMetadata = (content: DetectedContent) => {
    if (content.type === 'url') {
        return <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-[10px] uppercase">{content.metadata.domain}</span>
    }
    if (content.type === 'code') {
        return <span className="bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded text-[10px] uppercase">{content.metadata.language}</span>
    }
    return null
}
