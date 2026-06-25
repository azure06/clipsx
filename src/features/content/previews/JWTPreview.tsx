import { memo, useMemo } from 'react'
import { KeyRound } from 'lucide-react'
import type { Content } from '../types'
import { MetaChip } from './PreviewShell'
import { previewTheme } from './previewTheme'

type JWTPreviewProps = {
  readonly content: Content
}

const SegmentBlock = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div className="flex flex-col gap-1">
    <span className={`text-[10px] font-semibold uppercase tracking-wider ${color}`}>{label}</span>
    <div className={`p-2 rounded-lg ${previewTheme.surfaceInset}`}>
      <p
        className={`text-xs font-mono break-all leading-relaxed line-clamp-3 ${previewTheme.textSecondary}`}
      >
        {value}
      </p>
    </div>
  </div>
)

const JWTPreviewComponent = ({ content }: JWTPreviewProps) => {
  const { header, payload, signature, headerDecoded, isValid } = useMemo(() => {
    const parts = content.text.trim().split('.')
    if (parts.length !== 3) {
      return { header: '', payload: '', signature: '', headerDecoded: null, isValid: false }
    }

    const [h, p, s] = parts as [string, string, string]

    let headerDecoded: Record<string, unknown> | null = null
    try {
      headerDecoded = JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
        string,
        unknown
      >
    } catch {
      // ignore decode errors
    }

    return { header: h, payload: p, signature: s, headerDecoded, isValid: true }
  }, [content.text])

  if (!isValid) {
    return (
      <div className={`p-4 text-sm font-mono break-all ${previewTheme.textMuted}`}>
        {content.text}
      </div>
    )
  }

  const alg = headerDecoded?.['alg'] as string | undefined
  const typ = headerDecoded?.['typ'] as string | undefined

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/30">
          <KeyRound size={16} strokeWidth={2.5} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${previewTheme.textPrimary}`}
          >
            JWT
          </span>
          {alg && (
            <MetaChip className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
              {alg}
            </MetaChip>
          )}
          {typ && <MetaChip>{typ}</MetaChip>}
        </div>
      </div>

      {/* Segments */}
      <div className="flex flex-col gap-3">
        <SegmentBlock label="Header" value={header} color="text-red-400" />
        <SegmentBlock label="Payload" value={payload} color="text-purple-400" />
        <SegmentBlock label="Signature" value={signature} color="text-blue-400" />
      </div>

      <p className="text-[10px] text-gray-600 text-center">
        Payload content is not decoded in this view.
      </p>
    </div>
  )
}

export const JWTPreview = memo(JWTPreviewComponent)
