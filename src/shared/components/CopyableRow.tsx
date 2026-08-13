import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyLiteralText } from '../clipboardOutput'

interface CopyableRowProps {
  label: string
  value: string
  mono?: boolean
  sourceClipId?: string
}

export const CopyableRow = ({ label, value, mono = false, sourceClipId }: CopyableRowProps) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void copyLiteralText(value, sourceClipId)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }

  return (
    <div className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-100/60 dark:hover:bg-white/5 transition-colors">
      <span className="w-24 shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-xs text-gray-800 dark:text-gray-200 ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </span>
      <button
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded p-1 text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200/60 dark:hover:bg-white/10 hover:text-gray-700 dark:hover:text-gray-300 transition-all"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}
