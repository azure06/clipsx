import { memo, useMemo } from 'react'
import { Clock } from 'lucide-react'
import type { Content } from '../types'
import { CopyableRow, MetaChip } from './PreviewShell'

type TimestampPreviewProps = {
  readonly content: Content
}

const TimestampPreviewComponent = ({ content }: TimestampPreviewProps) => {
  const { tsValue, unit, humanReadable, iso } = useMemo(() => {
    const raw = content.text
    const unitMeta = content.metadata.unit ?? 'seconds'
    const numericVal = Number(content.metadata.value ?? raw)

    if (isNaN(numericVal)) {
      return { tsValue: raw, unit: unitMeta, humanReadable: '', iso: '' }
    }

    const ms = unitMeta === 'milliseconds' ? numericVal : numericVal * 1000
    const d = new Date(ms)
    const valid = !isNaN(d.getTime())

    return {
      tsValue: raw,
      unit: unitMeta,
      humanReadable: valid
        ? d.toLocaleString(undefined, {
            dateStyle: 'full',
            timeStyle: 'medium',
          })
        : '',
      iso: valid ? d.toISOString() : '',
    }
  }, [content.text, content.metadata.unit, content.metadata.value])

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Visual header */}
      <div className="flex flex-col items-center gap-2 p-5 rounded-xl bg-linear-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/20">
        <div className="p-3 rounded-full bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30">
          <Clock size={22} strokeWidth={2} />
        </div>
        <span className="text-3xl font-bold font-mono text-white/90">{tsValue}</span>
        <MetaChip className="bg-purple-500/10 text-purple-400 border-purple-500/20">{unit}</MetaChip>
        {humanReadable && (
          <span className="text-sm text-gray-400 text-center">{humanReadable}</span>
        )}
      </div>

      {/* Copyable fields */}
      <div className="flex flex-col gap-2">
        <CopyableRow label="Original" value={tsValue} />
        {iso && <CopyableRow label="ISO 8601" value={iso} />}
      </div>
    </div>
  )
}

export const TimestampPreview = memo(TimestampPreviewComponent)
