import { memo } from 'react'
import { Braces } from 'lucide-react'
import type { Content } from '../types'

type JSONPreviewProps = {
  readonly content: Content
}

const JSONPreviewComponent = ({ content }: JSONPreviewProps) => {
  let parsed: unknown = null
  let formatted = content.text
  let keyCount = 0

  try {
    parsed = JSON.parse(content.text)
    formatted = JSON.stringify(parsed, null, 2)
    if (parsed && typeof parsed === 'object') {
      keyCount = Object.keys(parsed).length
    }
  } catch {
    // Invalid JSON, show as-is
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Compact header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
            <Braces size={16} strokeWidth={2.5} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-white/90 uppercase tracking-wider">
              JSON
            </span>
            {keyCount > 0 && <span className="text-[10px] text-gray-500">{keyCount} keys</span>}
          </div>
        </div>
      </div>

      {/* Compact JSON viewer */}
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 via-teal-500/5 to-emerald-500/5 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="relative rounded-xl bg-black/40 border border-emerald-500/20 shadow-xl overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar max-h-96 overflow-y-auto">
            <pre className="p-3 text-sm leading-relaxed">
              <code className="font-mono text-emerald-300">{formatted}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export const JSONPreview = memo(JSONPreviewComponent)
