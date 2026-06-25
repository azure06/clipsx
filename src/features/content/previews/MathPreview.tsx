import { memo } from 'react'
import { Calculator, Copy, Check, Equal } from 'lucide-react'
import { useState } from 'react'
import type { Content } from '../types'
import { safeEval } from '../utils/math'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { previewTheme } from './previewTheme'

type MathPreviewProps = {
  readonly content: Content
}

const MathPreviewComponent = ({ content }: MathPreviewProps) => {
  const [copied, setCopied] = useState(false)
  const copyDerivedText = useClipboardStore(state => state.copyDerivedText)
  const result = safeEval(content.text)
  const hasResult = result !== null && !isNaN(result)

  const handleCopyResult = async () => {
    if (hasResult) {
      await copyDerivedText(result.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30">
          <Calculator size={16} strokeWidth={2.5} />
        </div>
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${previewTheme.textPrimary}`}
        >
          Math Expression
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {/* Expression Display */}
        <div className={`p-3 rounded-xl ${previewTheme.surfaceMuted}`}>
          <div className={`text-sm font-mono mb-1 ${previewTheme.textMuted}`}>Equation</div>
          <div
            className={`text-lg font-medium font-mono break-all leading-relaxed ${previewTheme.textPrimary}`}
          >
            {content.text}
          </div>
        </div>

        {/* Result Display */}
        {hasResult ? (
          <div className="relative group">
            <div className="absolute inset-0 bg-linear-to-r from-indigo-500/10 via-purple-500/10 to-indigo-500/10 rounded-xl blur-xl opacity-50" />

            <div className="relative p-4 rounded-xl bg-linear-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 flex flex-col items-center justify-center gap-2 text-center">
              <div className="flex items-center gap-2 text-indigo-300/80 mb-1">
                <Equal size={20} strokeWidth={2.5} />
                <span className="text-xs font-semibold uppercase tracking-wider">Result</span>
              </div>

              <div
                className="text-4xl font-bold text-transparent bg-clip-text bg-linear-to-r from-indigo-200 via-gray-100 to-purple-200 select-all cursor-pointer hover:scale-105 transition-transform duration-200 font-mono"
                onClick={() => void handleCopyResult()}
                title="Click to copy result"
              >
                {
                  /* Format large numbers nicely */
                  result.toLocaleString(undefined, { maximumFractionDigits: 10 })
                }
              </div>

              <div className="h-6 flex items-center justify-center">
                <button
                  onClick={() => void handleCopyResult()}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/65 hover:bg-slate-100 border border-slate-200/80 hover:border-slate-300/80 transition-colors text-xs font-medium text-gray-600 hover:text-gray-900 dark:bg-slate-100/5 dark:hover:bg-slate-100/10 dark:border-gray-100/5 dark:hover:border-gray-100/10 dark:text-gray-400 dark:hover:text-white"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-green-400" />
                      <span className="text-green-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy Result</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm text-center">
            Invalid Expression
          </div>
        )}
      </div>
    </div>
  )
}

export const MathPreview = memo(MathPreviewComponent)
