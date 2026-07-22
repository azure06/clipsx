import { memo, useMemo } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import type { Content } from '../types'
import { useActionRegistry } from '../actions/registry'
import { MetaChip, PreviewLocalMenu } from './PreviewShell'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

type CSVPreviewProps = {
  readonly content: Content
}

const CSVPreviewComponent = ({ content }: CSVPreviewProps) => {
  const { t } = useTranslation()
  const { headers, rows, colCount } = useMemo(() => {
    const lines = content.text.split(/\r?\n/).filter(line => line.trim() !== '')
    if (lines.length === 0) return { headers: [], rows: [], colCount: 0 }

    const delimiter = content.metadata.delimiter || ','
    const parseLine = (line: string) => line.split(delimiter).map(cell => cell.trim())

    const headers = parseLine(lines[0] || '')
    const rows = lines.slice(1).map(line => parseLine(line))

    return { headers, rows, colCount: headers.length }
  }, [content.text, content.metadata.delimiter])

  const { getPreviewMenuActions } = useActionRegistry()
  const menuActions = getPreviewMenuActions(content)

  const delimiter = content.metadata.delimiter || ','
  const delimiterLabel =
    delimiter === ','
      ? t('preview.comma')
      : delimiter === '\t'
        ? t('preview.tab')
        : delimiter === ';'
          ? t('preview.semicolon')
          : delimiter

  if (headers.length === 0) {
    return <div className="p-4 text-gray-500">{t('preview.emptyCsv')}</div>
  }

  return (
    <div className="flex flex-col gap-3 p-4 h-full min-h-0">
      {/* Compact header with metadata strip */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
          <FileSpreadsheet size={16} strokeWidth={2.5} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          <MetaChip className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            CSV
          </MetaChip>
          <MetaChip>{t('preview.rows', { count: rows.length })}</MetaChip>
          <MetaChip>{t('preview.columns', { count: colCount })}</MetaChip>
          <MetaChip>{delimiterLabel}</MetaChip>
        </div>
        {menuActions.length > 0 && <PreviewLocalMenu actions={menuActions} content={content} />}
      </div>

      {/* Scrollable Table */}
      <div
        className={`flex-1 overflow-auto rounded-xl shadow-inner custom-scrollbar bg-white/65 dark:bg-black/20 border border-slate-200/80 dark:border-white/10`}
      >
        <table className="w-full text-left text-sm border-collapse whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-slate-100/95 dark:bg-[#1e1e1e] shadow-sm">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="px-3 py-2 font-semibold text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wider border-b border-slate-200/80 dark:border-white/10 bg-slate-100/95 dark:bg-[#1e1e1e]"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80 dark:divide-white/5">
            {rows.map((row, i) => (
              <tr
                key={i}
                className="hover:bg-slate-100/70 dark:hover:bg-slate-100/5 transition-colors group"
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`px-3 py-2 group-hover:text-gray-900 dark:group-hover:text-white ${previewTheme.textSecondary}`}
                  >
                    {cell}
                  </td>
                ))}
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
