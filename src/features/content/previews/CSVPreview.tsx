import { memo, useMemo } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import type { Content } from '../types'

type CSVPreviewProps = {
  readonly content: Content
}

const CSVPreviewComponent = ({ content }: CSVPreviewProps) => {
  const { headers, rows, colCount } = useMemo(() => {
    const lines = content.text.split(/\r?\n/).filter(line => line.trim() !== '')
    if (lines.length === 0) return { headers: [], rows: [], colCount: 0 }

    const delimiter = content.metadata.delimiter || ','

    // Simple CSV parser (doesn't handle quoted strings with delimiters yet)
    const parseLine = (line: string) => line.split(delimiter).map(cell => cell.trim())

    const headers = parseLine(lines[0] || '')
    const rows = lines.slice(1).map(line => parseLine(line))

    return { headers, rows, colCount: headers.length }
  }, [content.text, content.metadata.delimiter])

  if (headers.length === 0) {
    return <div className="p-4 text-gray-500">Empty CSV</div>
  }

  return (
    <div className="flex flex-col gap-3 p-4 h-full min-h-0">
      {/* Compact Header */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
          <FileSpreadsheet size={16} strokeWidth={2.5} />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-white/90 uppercase tracking-wider">
            CSV Table
          </span>
          <span className="text-[10px] text-gray-500">
            {rows.length} rows • {colCount} columns
          </span>
        </div>
      </div>

      {/* Scrollable Table Container */}
      <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-black/20 shadow-inner custom-scrollbar">
        <table className="w-full text-left text-sm border-collapse whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-[#1e1e1e] shadow-sm">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="px-3 py-2 font-semibold text-xs text-gray-400 uppercase tracking-wider border-b border-white/10 bg-[#1e1e1e]"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-white/5 transition-colors group">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-white/80 group-hover:text-white">
                    {cell}
                  </td>
                ))}
                {/* Fill empty cells if row is shorter than header */}
                {Array.from({ length: Math.max(0, colCount - row.length) }).map((_, j) => (
                  <td key={`empty-${j}`} className="px-3 py-2" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const CSVPreview = memo(CSVPreviewComponent)
