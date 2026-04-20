import { Star } from 'lucide-react'
import type { SmartAction, Content } from '../../types'

export const useFavoriteAction = (onToggle?: (clipId: string) => void): SmartAction => ({
  id: 'favorite',
  label: 'Favorite',
  icon: <Star size={16} />,
  category: 'core',
  placement: 'global_bar' as const,
  shortcut: '⌘F',
  check: () => true,
  execute: (content: Content) => {
    onToggle?.(content.clip.id)
  },
  isActive: (content: Content) => Boolean(content.clip.isFavorite),
})
