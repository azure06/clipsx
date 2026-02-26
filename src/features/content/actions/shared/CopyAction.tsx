import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import type { SmartAction, Content } from '../../types'
import { useClipboardStore } from '../../../../stores/clipboardStore'

export const useCopyAction = (): SmartAction => {
  const [copied, setCopied] = useState(false)
  const { copyToClipboard } = useClipboardStore()

  return {
    id: 'copy',
    label: copied ? 'Copied!' : 'Copy',
    icon: copied ? <Check size={16} /> : <Copy size={16} />,
    category: 'core',
    shortcut: '⌘C',
    check: () => true, // Available for all content
    execute: async (content: Content) => {
      await copyToClipboard(content.text, content.clip.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
  }
}
