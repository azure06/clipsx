import { memo, useMemo } from 'react'
import { CalendarDays } from 'lucide-react'
import type { Content } from '../types'
import { CopyableRow, MetaChip } from './PreviewShell'
import { previewTheme } from './previewTheme'

type DatePreviewProps = {
  readonly content: Content
}

const DatePreviewComponent = ({ content }: DatePreviewProps) => {
  const { original, iso, format } = useMemo(() => {
    const raw = content.text
    const isoVal = content.metadata.iso

    let displayDate = ''
    let isoStr = isoVal || ''

    try {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) {
        displayDate = d.toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
        if (!isoStr) isoStr = d.toISOString()
      }
    } catch {
      // fallback — just show raw
    }

    return {
      original: raw,
      iso: isoStr,
      format: content.metadata.format,
      display: displayDate,
    }
  }, [content.text, content.metadata.iso, content.metadata.format])

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Visual header */}
      <div className="flex flex-col items-center gap-2 p-5 rounded-xl bg-linear-to-br from-sky-500/10 to-blue-500/10 border border-sky-500/20">
        <div className="p-3 rounded-full bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30">
          <CalendarDays size={22} strokeWidth={2} />
        </div>
        <span className={`text-xl font-semibold text-center ${previewTheme.textPrimary}`}>
          {original}
        </span>
        {format && (
          <MetaChip className="bg-sky-500/10 text-sky-400 border-sky-500/20">{format}</MetaChip>
        )}
      </div>

      {/* Copyable fields */}
      <div className="flex flex-col gap-2">
        {iso && <CopyableRow label="ISO 8601" value={iso} sourceClipId={content.clip.id} />}
      </div>
    </div>
  )
}

export const DatePreview = memo(DatePreviewComponent)
