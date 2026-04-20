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
import { FilePreview } from './FilePreview'
import { OfficePreview } from './OfficePreview'
import { PhonePreview } from './PhonePreview'
import { DatePreview } from './DatePreview'
import { TimestampPreview } from './TimestampPreview'
import { PathPreview } from './PathPreview'
import { JWTPreview } from './JWTPreview'
import { SecretPreview } from './SecretPreview'

type ContentPreviewProps = {
  readonly content: Content
}

const ContentPreviewComponent = ({ content }: ContentPreviewProps) => {
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
      return <FilePreview content={content} />
    case 'office':
      return <OfficePreview content={content} />
    case 'phone':
      return <PhonePreview content={content} />
    case 'date':
      return <DatePreview content={content} />
    case 'timestamp':
      return <TimestampPreview content={content} />
    case 'path':
      return <PathPreview content={content} />
    case 'jwt':
      return <JWTPreview content={content} />
    case 'secret':
      return <SecretPreview content={content} />
    case 'text':
    default:
      return <TextPreview content={content} />
  }
}

export const ContentPreview = memo(ContentPreviewComponent)

export { ColorPreview } from './ColorPreview'
export { URLPreview } from './URLPreview'
export { CodePreview } from './CodePreview'
export { EmailPreview } from './EmailPreview'
export { JSONPreview } from './JSONPreview'
export { TextPreview } from './TextPreview'
export { CSVPreview } from './CSVPreview'
export { MathPreview } from './MathPreview'
export { ImagePreview } from './ImagePreview'
export { FilePreview } from './FilePreview'
export { OfficePreview } from './OfficePreview'
export { PhonePreview } from './PhonePreview'
export { DatePreview } from './DatePreview'
export { TimestampPreview } from './TimestampPreview'
export { PathPreview } from './PathPreview'
export { JWTPreview } from './JWTPreview'
export { SecretPreview } from './SecretPreview'
export { CopyableRow, MetaChip, PreviewHeader, PreviewLocalMenu, InlineCTAButton } from './PreviewShell'
