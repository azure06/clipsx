import { convertFileSrc } from '@tauri-apps/api/core'
import { memo, useMemo } from 'react'
import type { Content } from '../types'

export const ImagePreview = memo(({ content }: { content: Content }) => {
  const src = useMemo(() => {
    // 1. If we have a local file path from backend, convert it to asset URL
    if (content.clip.imagePath) {
      return convertFileSrc(content.clip.imagePath)
    }
    // 2. Fallback to metadata URL (external)
    if (content.metadata.url) {
      return content.metadata.url
    }
    // 3. Last resort: use text content if it looks like a data URI
    if (content.text.startsWith('data:image')) {
      return content.text
    }
    return null
  }, [content])

  if (!src) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-gray-500 text-sm gap-2">
        <span>No image source found</span>
        <span className="text-xs opacity-50 font-mono">{content.text}</span>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex items-center justify-center min-h-50 p-4">
      <img
        src={src}
        alt="Clip Preview"
        className="max-w-full max-h-full object-contain rounded shadow-sm bg-black/20"
        onError={e => {
          console.error('Failed to load image:', src)
          e.currentTarget.style.display = 'none'
        }}
      />
    </div>
  )
})
