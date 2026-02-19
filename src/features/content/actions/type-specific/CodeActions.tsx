import { Code2, FileCode, Download } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useFormatCodeAction = (): SmartAction => ({
  id: 'format-code',
  label: 'Format Code',
  icon: <Code2 size={16} />,
  category: 'transform',
  check: content => content.type === 'code',
  execute: async content => {
    // Basic formatting - can be enhanced with prettier/etc
    try {
      if (content.metadata.language === 'json') {
        const parsed = JSON.parse(content.text) as unknown
        const formatted = JSON.stringify(parsed, null, 2)
        await navigator.clipboard.writeText(formatted)
      } else {
        await navigator.clipboard.writeText(content.text)
      }
    } catch {
      await navigator.clipboard.writeText(content.text)
    }
  },
})

export const useCopyCodeAction = (): SmartAction => ({
  id: 'copy-code',
  label: 'Copy Code',
  icon: <FileCode size={16} />,
  category: 'core',
  check: content => content.type === 'code',
  execute: async content => {
    await navigator.clipboard.writeText(content.text)
  },
})

export const useDownloadCodeAction = (): SmartAction => ({
  id: 'download-code',
  label: 'Download File',
  icon: <Download size={16} />,
  category: 'utility',
  check: content => content.type === 'code',
  execute: content => {
    const lang = content.metadata.language || 'txt'
    const extension = lang === 'text' ? 'txt' : lang
    const blob = new Blob([content.text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `code.${extension}`
    a.click()
    URL.revokeObjectURL(url)
  },
})
