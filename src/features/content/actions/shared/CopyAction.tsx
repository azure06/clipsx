import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import type { SmartAction, Content } from '../../types'
import { useClipboardStore } from '../../../../stores/clipboardStore'

export const useCopyAction = (): SmartAction => {
  const [copied, setCopied] = useState(false)
  const { performCopy } = useClipboardStore()

  return {
    id: 'copy',
    label: copied ? 'Copied!' : 'Copy',
    icon: copied ? <Check size={16} /> : <Copy size={16} />,
    category: 'core',
    placement: 'global_bar' as const,
    shortcut: '⌘C',
    check: () => true,
    execute: async (content: Content) => {
      await performCopy(content.text, content.clip.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
  }
}
