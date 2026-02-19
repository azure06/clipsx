import { FileJson, Table } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useCsvToJsonAction = (): SmartAction => ({
  id: 'csv-to-json',
  label: 'Copy as JSON',
  icon: <FileJson size={16} />,
  category: 'transform',
  check: content => content.type === 'csv',
  execute: async content => {
    const lines = content.text.split(/\r?\n/).filter(line => line.trim() !== '')
    if (lines.length < 2) return

    const delimiter = content.metadata.delimiter || ','
    const firstLine = lines[0]
    if (!firstLine) return

    const headers = firstLine.split(delimiter).map(h => h.trim())

    const json = lines.slice(1).map(line => {
      const values = line.split(delimiter).map(v => v.trim())
      return headers.reduce(
        (obj, header, index) => {
          obj[header] = values[index] || null
          return obj
        },
        {} as Record<string, string | null>
      )
    })

    await navigator.clipboard.writeText(JSON.stringify(json, null, 2))
  },
})

export const useCsvToMarkdownAction = (): SmartAction => ({
  id: 'csv-to-markdown',
  label: 'Copy as Markdown',
  icon: <Table size={16} />,
  category: 'transform',
  check: content => content.type === 'csv',
  execute: async content => {
    const lines = content.text.split(/\r?\n/).filter(line => line.trim() !== '')
    if (lines.length < 2) return

    const delimiter = content.metadata.delimiter || ','
    const firstLine = lines[0]
    if (!firstLine) return

    const headers = firstLine.split(delimiter).map(h => h.trim())
    const separator = headers.map(() => '---').join('|')

    const body = lines
      .slice(1)
      .map(line => {
        return line
          .split(delimiter)
          .map(v => v.trim())
          .join('|')
      })
      .join('\n')

    const markdown = `${headers.join('|')}\n${separator}\n${body}`
    await navigator.clipboard.writeText(markdown)
  },
})
