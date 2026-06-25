import { memo } from 'react'
import type { Content } from '../types'
import { previewTheme } from './previewTheme'

type TextPreviewProps = {
  readonly content: Content
}

const TextPreviewComponent = ({ content }: TextPreviewProps) => {
  return (
    <div className="w-full h-full p-4">
      <p
        className={`text-sm leading-relaxed whitespace-pre-wrap break-words font-light font-mono ${previewTheme.textPrimary}`}
      >
        {content.text}
      </p>
    </div>
  )
}

export const TextPreview = memo(TextPreviewComponent)
