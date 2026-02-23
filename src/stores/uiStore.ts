import { create } from 'zustand'
import type { ClipItem } from '../shared/types'

type ViewType = 'clips' | 'plugins' | 'settings'

interface UIState {
  activeView: ViewType
  searchQuery: string
  previewClip: ClipItem | null
  isSemanticActive: boolean

  setActiveView: (view: ViewType) => void
  setSearchQuery: (query: string) => void
  setPreviewClip: (clip: ClipItem | null) => void
  resetSearch: () => void
  toggleSemantic: () => void
}

export const useUIStore = create<UIState>(set => ({
  activeView: 'clips',
  searchQuery: '',
  previewClip: null,
  isSemanticActive: true, // Default to ON when a model is available

  setActiveView: view => set({ activeView: view }),
  setSearchQuery: query => set({ searchQuery: query }),
  setPreviewClip: clip => set({ previewClip: clip }),
  resetSearch: () => set({ searchQuery: '', previewClip: null }),
  toggleSemantic: () => set(state => ({ isSemanticActive: !state.isSemanticActive })),
}))
