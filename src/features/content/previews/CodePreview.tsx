import { memo } from 'react'
import { Code2, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import type { Content } from '../types'

type CodePreviewProps = {
  readonly content: Content
}

const CodePreviewComponent = ({ content }: CodePreviewProps) => {
  const [copied, setCopied] = useState(false)
  const language = content.metadata.language || 'text'
  const lineCount = content.text.split('\n').length

  const handleCopy = () => {
    void navigator.clipboard.writeText(content.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Compact header with metadata and actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-green-500/20 text-green-400 ring-1 ring-green-500/30">
            <Code2 size={16} strokeWidth={2.5} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-white/90 uppercase tracking-wider">
              {language}
            </span>
            <span className="text-[10px] text-gray-500">{lineCount} lines</span>
          </div>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 group"
        >
          {copied ? (
            <>
              <Check size={14} className="text-green-400" />
              <span className="text-xs text-green-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} className="text-gray-400 group-hover:text-white/80" />
              <span className="text-xs text-gray-400 group-hover:text-white/80 font-medium">
                Copy
              </span>
            </>
          )}
        </button>
      </div>

      {/* Code block */}
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 via-emerald-500/5 to-green-500/5 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="relative rounded-xl bg-black/40 border border-green-500/20 shadow-xl overflow-hidden">
          {/* Line numbers bar */}
          <div className="flex">
            <div className="shrink-0 w-10 bg-black/30 border-r border-white/5 py-3 text-right">
              {Array.from({ length: Math.min(lineCount, 100) }, (_, i) => (
                <div key={i} className="text-[10px] text-gray-600 leading-relaxed px-2">
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Code content */}
            <div className="flex-1 overflow-x-auto custom-scrollbar">
              <pre className="p-3 text-sm leading-relaxed">
                <code className="font-mono text-gray-300">{content.text}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const CodePreview = memo(CodePreviewComponent)
