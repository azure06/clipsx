import { create } from 'zustand'
type ViewType = 'clips' | 'extensions' | 'intelligence' | 'settings'

interface UIState {
  activeView: ViewType
  searchQuery: string
  previewClipId: string | null
  isSemanticActive: boolean

  setActiveView: (view: ViewType) => void
  setSearchQuery: (query: string) => void
  setPreviewClipId: (clipId: string | null) => void
  resetSearch: () => void
  toggleSemantic: () => void
}

export const useUIStore = create<UIState>(set => ({
  activeView: 'clips',
  searchQuery: '',
  previewClipId: null,
  isSemanticActive: true, // Default to ON when a model is available

  setActiveView: view => set({ activeView: view }),
  setSearchQuery: query => set({ searchQuery: query }),
  setPreviewClipId: previewClipId => set({ previewClipId }),
  resetSearch: () => set({ searchQuery: '', previewClipId: null }),
  toggleSemantic: () => set(state => ({ isSemanticActive: !state.isSemanticActive })),
}))
