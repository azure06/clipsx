import { convertFileSrc } from '@tauri-apps/api/core'
import type { ClipItem } from '../../../shared/types'

// View mode discriminated union
export type ViewMode = 'list' | 'grid'

// Partition clips into text and visual categories
export const partitionClips = (clips: ClipItem[]): { text: ClipItem[]; visual: ClipItem[] } => {
  const text: ClipItem[] = []
  const visual: ClipItem[] = []

  for (const clip of clips) {
    if (clip.contentType === 'image' || clip.contentType === 'files') {
      visual.push(clip)
    } else {
      text.push(clip)
    }
  }

  return { text, visual }
}

// Get thumbnail path for visual clips
export const getThumbnailPath = (clip: ClipItem): string | null => {
  if (clip.contentType === 'image' && clip.imagePath) {
    return clip.imagePath
  }
  return null
}

// Convert file path to Tauri asset URL (works in renderer process)
export const getAssetUrl = (filePath: string): string => convertFileSrc(filePath)
