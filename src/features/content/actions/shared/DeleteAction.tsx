import { Trash2 } from 'lucide-react'
import type { SmartAction, Content } from '../../types'

export const useDeleteAction = (onDelete?: (id: string) => void): SmartAction => ({
  id: 'delete',
  label: 'Delete',
  icon: <Trash2 size={16} />,
  category: 'core',
  placement: 'global_bar' as const,
  shortcut: '⌘⌫',
  check: () => true,
  execute: (content: Content) => {
    onDelete?.(content.clip.id)
  },
})
