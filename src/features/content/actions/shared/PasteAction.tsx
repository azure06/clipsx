import { Clipboard } from 'lucide-react'
import type { SmartAction, Content } from '../../types'
import { useClipboardStore } from '../../../../stores/clipboardStore'
import type { ShortcutDef } from '../../../../shared/keyboard/shortcuts'

const PASTE_SHORTCUT: ShortcutDef = {
  modifiers: [],
  key: 'Enter',
}

export const usePasteAction = (): SmartAction => {
  const { performPrimaryAction } = useClipboardStore()

  return {
    id: 'paste',
    label: 'Paste',
    icon: <Clipboard size={16} />,
    category: 'core',
    placement: 'global_bar' as const,
    shortcut: PASTE_SHORTCUT,
    check: () => true,
    execute: async (content: Content) => {
      await performPrimaryAction(content.text, content.clip.id)
    },
  }
}
