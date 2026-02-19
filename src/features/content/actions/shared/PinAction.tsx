import { Pin } from 'lucide-react'
import type { SmartAction, Content } from '../../types'

export const usePinAction = (onTogglePin?: (id: string) => void): SmartAction => {
  return {
    id: 'pin',
    label: 'Pin / Unpin',
    icon: <Pin size={16} />,
    category: 'core',
    check: () => true,
    execute: (content: Content) => {
      onTogglePin?.(content.clip.id)
    },
  }
}
