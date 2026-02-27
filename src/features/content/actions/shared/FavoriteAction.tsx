import { Star } from 'lucide-react'
import type { SmartAction, Content } from '../../types'

export const useFavoriteAction = (onToggle?: (clipId: string) => void): SmartAction => ({
  id: 'favorite',
  label: 'Favorite',
  icon: <Star size={16} />,
  category: 'core',
  shortcut: '⌘F',
  check: () => true, // Available for all content
  execute: (content: Content) => {
    onToggle?.(content.clip.id)
  },
  isActive: (content: Content) => Boolean(content.clip.isFavorite),
})
