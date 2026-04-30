import { Code2, FileCode, Download } from 'lucide-react'
import type { SmartAction } from '../../types'
import { useClipboardStore } from '../../../../stores/clipboardStore'

export const useFormatCodeAction = (): SmartAction => ({
  id: 'format-code',
  label: 'Format Code',
  icon: <Code2 size={16} />,
  category: 'transform',
  placement: 'preview_menu',
  check: content => content.type === 'code',
  execute: async content => {
    let textToCopy = content.text

    // Basic formatting - can be enhanced with prettier/etc
    try {
      if (content.metadata.language === 'json') {
        const parsed = JSON.parse(content.text) as unknown
        textToCopy = JSON.stringify(parsed, null, 2)
      }
    } catch {
      textToCopy = content.text
    }

    await useClipboardStore.getState().copyDerivedText(textToCopy)
  },
})

export const useCopyCodeAction = (): SmartAction => ({
  id: 'copy-code',
  label: 'Copy Code',
  icon: <FileCode size={16} />,
  category: 'core',
  placement: 'hidden',
  check: content => content.type === 'code',
  execute: async content => {
    await useClipboardStore.getState().copyDerivedText(content.text)
  },
})

export const useDownloadCodeAction = (): SmartAction => ({
  id: 'download-code',
  label: 'Download File',
  icon: <Download size={16} />,
  category: 'utility',
  placement: 'hidden',
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
