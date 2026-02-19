import { FileType2 } from 'lucide-react'
import { useState } from 'react'
import type { SmartAction, Content } from '../../types'

export const useCopyAsPlainTextAction = (): SmartAction => {
  const [copied, setCopied] = useState(false)

  return {
    id: 'copy-plain-text',
    label: copied ? 'Copied Text!' : 'Copy Text',
    icon: <FileType2 size={16} className={copied ? 'text-green-600' : ''} />,
    category: 'core',
    // No shortcut to avoid conflict, or maybe Cmd+Alt+C?
    check: () => true, // Available for all content
    execute: async (content: Content) => {
      await navigator.clipboard.writeText(content.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
  }
}
