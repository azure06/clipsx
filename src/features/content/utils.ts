import type { ClipItem } from '../../shared/types'
import { resolveOfficeContent } from './office'
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
  if (clip.contentType === 'office') {
    return resolveOfficeContent(clip, parseMetadata(clip.metadata)).type
  }
  if (clip.contentType === 'image') return 'image'
  if (clip.contentType === 'files') return 'files'

  const detected = clip.detectedType?.toLowerCase() || 'text'
  return detected as ContentType
}

// Convert ClipItem to unified Content
export const clipToContent = (clip: ClipItem): Content => {
  const baseMetadata = parseMetadata(clip.metadata)
  const resolvedOfficeContent =
    clip.contentType === 'office' ? resolveOfficeContent(clip, baseMetadata) : null

  const metadata: ContentMetadata = resolvedOfficeContent?.metadata ?? baseMetadata
  const text = resolvedOfficeContent?.text ?? (clip.contentText || '')
  const type = resolvedOfficeContent?.type ?? getContentType(clip)

  return {
    type,
    text,
    metadata,
    clip,
  }
}

export const getContentDisplayLabel = (content: Content): string => {
  if (content.type !== 'office') return content.type

  switch (content.metadata.office_kind) {
    case 'spreadsheet':
      return 'spreadsheet'
    case 'document':
      return 'document'
    case 'slides':
      return 'slides'
    default:
      return 'office'
  }
}

export const getContentDisplayAccentType = (content: Content): ContentType => {
  if (content.type === 'office' && content.metadata.office_kind === 'spreadsheet') {
    return 'csv'
  }

  return content.type
}

export const getContentSourceLabel = (content: Content): string | undefined => {
  switch (content.metadata.office_app) {
    case 'word':
      return 'Microsoft Word'
    case 'excel':
      return 'Microsoft Excel'
    case 'powerpoint':
      return 'Microsoft PowerPoint'
    default:
      return content.metadata.source_app ?? content.clip.appName ?? undefined
  }
}

// Get type color for UI
export const getTypeColor = (type: ContentType): string => {
  const colors: Record<ContentType, string> = {
    text: 'bg-slate-500',
    url: 'bg-blue-500',
    email: 'bg-amber-500',
    color: 'bg-purple-500',
    markdown: 'bg-cyan-500',
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
    markdown: '📝',
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
