import { memo } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { Content } from '../types'
import { MetaChip } from './PreviewShell'

type SecretPreviewProps = {
  readonly content: Content
}

const mask = (text: string): string => {
  if (text.length <= 8) return '•'.repeat(text.length)
  return text.slice(0, 4) + '•'.repeat(Math.min(text.length - 4, 20)) + text.slice(-4)
}

const SecretPreviewComponent = ({ content }: SecretPreviewProps) => {
  const kind = content.metadata.format ?? 'secret'
  const masked = mask(content.text)

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Warning header */}
      <div className="flex flex-col items-center gap-3 p-5 rounded-xl bg-linear-to-br from-red-500/10 to-rose-500/10 border border-red-500/20">
        <div className="p-3 rounded-full bg-red-500/20 text-red-400 ring-1 ring-red-500/30">
          <ShieldAlert size={22} strokeWidth={2} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-sm font-semibold text-red-300">Sensitive Content Detected</span>
          <MetaChip className="bg-red-500/10 text-red-400 border-red-500/20 uppercase">
            {kind}
          </MetaChip>
        </div>
        <p className="text-xs text-gray-500 text-center max-w-xs">
          This clip contains potentially sensitive data. The content is masked for safety.
        </p>
      </div>

      {/* Masked value display */}
      <div className="p-3 rounded-lg bg-black/30 border border-white/5">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Value</span>
        <p className="text-sm font-mono text-gray-500 break-all select-none">{masked}</p>
      </div>
    </div>
  )
}

export const SecretPreview = memo(SecretPreviewComponent)
