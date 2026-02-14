// Clipboard data types using discriminated unions

export type ClipContentType = 'text' | 'html' | 'rtf' | 'image' | 'files'

export type ClipContent =
  | { type: 'text'; content: string }
  | { type: 'html'; html: string; plain: string }
  | { type: 'rtf'; rtf: string; plain: string }
  | { type: 'image'; path: string }
  | { type: 'files'; paths: string[] }

export type ClipItem = {
  readonly id: string
  readonly contentType: ClipContentType
  readonly contentText: string | null
  readonly contentHtml: string | null
  readonly contentRtf: string | null
  readonly imagePath: string | null
  readonly filePaths: string | null // JSON array
  readonly metadata: string | null // JSON object
  readonly createdAt: number // Unix timestamp
  readonly updatedAt: number // Last access timestamp
  readonly appName: string | null
  readonly isPinned: boolean
  readonly isFavorite: boolean
  readonly accessCount: number
  readonly contentHash: string | null
}

export type Tag = {
  readonly id: number
  readonly name: string
  readonly color: string | null
  readonly createdAt: number
}

export type Collection = {
  readonly id: number
  readonly name: string
  readonly icon: string | null // Emoji or lucide icon name
  readonly description: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type ClipWithTags = ClipItem & {
  readonly tags: Tag[]
  readonly collections: Collection[]
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E }

// Helper functions using functional patterns
export const formatClipPreview = (clip: ClipItem, maxLength = 100): string => {
  const text = clip.contentText ?? ''
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

export const getClipContent = (clip: ClipItem): ClipContent | null => {
  switch (clip.contentType) {
    case 'text':
      return clip.contentText ? { type: 'text', content: clip.contentText } : null
    case 'html':
      if (clip.contentHtml && clip.contentText) {
        return { type: 'html', html: clip.contentHtml, plain: clip.contentText }
      }
      return null
    case 'rtf':
      if (clip.contentRtf && clip.contentText) {
        return { type: 'rtf', rtf: clip.contentRtf, plain: clip.contentText }
      }
      return null
    case 'image':
      return clip.imagePath ? { type: 'image', path: clip.imagePath } : null
    case 'files':
      if (clip.filePaths) {
        try {
          const paths = JSON.parse(clip.filePaths) as string[]
          return { type: 'files', paths }
        } catch {
          return null
        }
      }
      return null
    default:
      return null
  }
}

export const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}
