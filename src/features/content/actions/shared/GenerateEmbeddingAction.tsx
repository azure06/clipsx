import { Sparkles } from 'lucide-react'
import type { SmartAction, Content } from '../../types'

export const useGenerateEmbeddingAction = (onGenerate?: (id: string) => void): SmartAction => {
  return {
    id: 'core.embeddings.generate',
    label: 'Generate AI Embedding',
    icon: <Sparkles size={16} />,
    category: 'core',
    placement: 'global_bar' as const,
    check: (content: Content) => !content.clip.hasEmbedding && !!onGenerate,
    execute: (content: Content) => {
      onGenerate?.(content.clip.id)
    },
  }
}
