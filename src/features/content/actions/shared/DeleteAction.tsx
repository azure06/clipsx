import { Trash2 } from 'lucide-react'
import type { SmartAction, Content } from '../../types'

export const useDeleteAction = (onDelete?: (id: string) => void): SmartAction => ({
  id: 'delete',
  label: 'Delete',
  icon: <Trash2 size={16} />,
  category: 'core',
  shortcut: '⌘⌫',
  check: () => true, // Available for all content
  execute: (content: Content) => {
    onDelete?.(content.clip.id)
  },
})
