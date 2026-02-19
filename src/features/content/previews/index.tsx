import { memo } from 'react'
import type { Content } from '../types'
import { ColorPreview } from './ColorPreview'
import { URLPreview } from './URLPreview'
import { CodePreview } from './CodePreview'
import { EmailPreview } from './EmailPreview'
import { JSONPreview } from './JSONPreview'
import { TextPreview } from './TextPreview'
import { CSVPreview } from './CSVPreview'
import { MathPreview } from './MathPreview'
import { ImagePreview } from './ImagePreview'

type ContentPreviewProps = {
  readonly content: Content
}

const ContentPreviewComponent = ({ content }: ContentPreviewProps) => {
  // Route to appropriate preview based on type
  switch (content.type) {
    case 'color':
      return <ColorPreview content={content} />

    case 'url':
      return <URLPreview content={content} />

    case 'code':
      return <CodePreview content={content} />

    case 'email':
      return <EmailPreview content={content} />

    case 'json':
      return <JSONPreview content={content} />

    case 'csv':
      return <CSVPreview content={content} />

    case 'math':
      return <MathPreview content={content} />

    case 'image':
      return <ImagePreview content={content} />

    case 'files':
      // TODO: Implement image/files preview
      return <TextPreview content={content} />

    case 'jwt':
    case 'timestamp':
    case 'secret':
    case 'path':
      // For now, these fall back to text preview
      // Can be enhanced with specialized views later
      return <TextPreview content={content} />

    case 'text':
    default:
      return <TextPreview content={content} />
  }
}

export const ContentPreview = memo(ContentPreviewComponent)

// Export all previews
export { ColorPreview } from './ColorPreview'
export { URLPreview } from './URLPreview'
export { CodePreview } from './CodePreview'
export { EmailPreview } from './EmailPreview'
export { JSONPreview } from './JSONPreview'
export { TextPreview } from './TextPreview'
export { CSVPreview } from './CSVPreview'
export { MathPreview } from './MathPreview'
export { ImagePreview } from './ImagePreview'
