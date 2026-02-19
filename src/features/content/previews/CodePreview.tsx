import { memo } from 'react'
import type { Content } from '../types'

type CodePreviewProps = {
  readonly content: Content
}

const CodePreviewComponent = ({ content }: CodePreviewProps) => {
  const lineCount = content.text.split('\n').length

  return (
    <div className="flex flex-col h-full">
      {/* Code content */}
      <div className="flex flex-1 relative bg-black/40">
        {/* Line numbers bar */}
        <div className="shrink-0 w-10 bg-black/30 border-r border-white/5 py-4 text-right select-none">
          {Array.from({ length: Math.min(lineCount, 500) }, (_, i) => (
            <div key={i} className="text-[10px] text-gray-700 leading-relaxed px-2 font-mono">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code content */}
        <div className="flex-1 overflow-x-auto custom-scrollbar">
          <pre className="p-4 text-sm leading-relaxed">
            <code className="font-mono text-gray-300">{content.text}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

export const CodePreview = memo(CodePreviewComponent)
