import type { ClipItem } from '../../shared/types'
import type { Content, ContentMetadata, ContentType } from './types'

// Parse backend metadata JSON string
export const parseMetadata = (metadataJson?: string | null): ContentMetadata => {
  if (!metadataJson) return {}

  try {
    return JSON.parse(metadataJson) as ContentMetadata
  } catch {
    return {}
  }
}

// Get content type from clip
export const getContentType = (clip: ClipItem): ContentType => {
  if (clip.contentType === 'office') return 'office'
  if (clip.contentType === 'image') return 'image'
  if (clip.contentType === 'files') return 'files'

  const detected = clip.detectedType?.toLowerCase() || 'text'
  return detected as ContentType
}

// Convert ClipItem to unified Content
export const clipToContent = (clip: ClipItem): Content => {
  const baseMetadata = parseMetadata(clip.metadata)

  // Add Office-specific fields to metadata if present
  const metadata: ContentMetadata =
    clip.contentType === 'office'
      ? {
          ...baseMetadata,
          svg: clip.svgPath ?? undefined,
          pdf: clip.pdfPath ?? undefined,
          attachment_path: clip.attachmentPath ?? undefined,
          source_app: clip.appName ?? undefined,
        }
      : baseMetadata

  return {
    type: getContentType(clip),
    text: clip.contentText || '',
    metadata,
    clip,
  }
}

// Get type color for UI
export const getTypeColor = (type: ContentType): string => {
  const colors: Record<ContentType, string> = {
    text: 'bg-slate-500',
    url: 'bg-blue-500',
    email: 'bg-amber-500',
    color: 'bg-purple-500',
    code: 'bg-green-500',
    json: 'bg-emerald-500',
    csv: 'bg-lime-500',
    jwt: 'bg-violet-500',
    timestamp: 'bg-cyan-500',
    secret: 'bg-red-500',
    path: 'bg-indigo-500',
    image: 'bg-pink-500',
    files: 'bg-blue-600',
    office: 'bg-blue-400',
    math: 'bg-orange-500',
    phone: 'bg-teal-500',
    date: 'bg-rose-500',
  }
  return colors[type] || colors.text
}

// Get type icon (emoji fallback, can be replaced with lucide icons)
export const getTypeIcon = (type: ContentType): string => {
  const icons: Record<ContentType, string> = {
    text: '📄',
    url: '🔗',
    email: '✉️',
    color: '🎨',
    code: '⚡',
    json: '{ }',
    csv: '📊',
    jwt: '🔑',
    timestamp: '⏰',
    secret: '🔒',
    path: '📁',
    image: '🖼️',
    files: '📦',
    office: '📊',
    math: '🧮',
    phone: '📞',
    date: '📅',
  }
  return icons[type] || icons.text
}
