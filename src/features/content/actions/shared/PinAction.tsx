import { Pin } from 'lucide-react'
import type { SmartAction, Content } from '../../types'
import type { ShortcutDef } from '../../../../shared/keyboard/shortcuts'

const PIN_SHORTCUT: ShortcutDef = {
  modifiers: ['primary'],
  key: 'P',
}

export const usePinAction = (onTogglePin?: (id: string) => void): SmartAction => {
  return {
    id: 'pin',
    label: 'Pin / Unpin',
    icon: <Pin size={16} />,
    category: 'core',
    placement: 'global_bar' as const,
    shortcut: PIN_SHORTCUT,
    check: () => true,
    execute: (content: Content) => {
      onTogglePin?.(content.clip.id)
    },
    isActive: content => Boolean(content.clip.isPinned),
  }
}
