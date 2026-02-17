import { memo } from 'react'
import { FileText } from 'lucide-react'
import type { Content } from '../types'

type TextPreviewProps = {
  readonly content: Content
}

const TextPreviewComponent = ({ content }: TextPreviewProps) => {
  const wordCount = content.metadata.word_count || content.text.split(/\s+/).filter(Boolean).length
  const lineCount = content.metadata.line_count || content.text.split('\n').length
  const charCount = content.text.length

  return (
    <div className="flex flex-col gap-4">
      {/* Text content - optimized for readability and space */}
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-500/5 to-gray-600/5 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        
        <div className="relative p-4 rounded-xl bg-white/5 border border-white/10 shadow-lg">
          <p className="text-base leading-relaxed text-white/90 whitespace-pre-wrap break-words font-light">
            {content.text}
          </p>
        </div>
      </div>

      {/* Compact metadata badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
          <FileText size={12} className="text-gray-400" />
          <span className="text-[10px] text-gray-400 font-medium">
            {wordCount} words
          </span>
        </div>
        
        <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
          <span className="text-[10px] text-gray-400 font-medium">
            {lineCount} lines
          </span>
        </div>
        
        <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
          <span className="text-[10px] text-gray-400 font-medium">
            {charCount} chars
          </span>
        </div>
      </div>
    </div>
  )
}

export const TextPreview = memo(TextPreviewComponent)
