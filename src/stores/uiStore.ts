import { create } from 'zustand'
import type { ClipItem } from '../shared/types'

type ViewType = 'clips' | 'plugins' | 'settings'

interface UIState {
  activeView: ViewType
  searchQuery: string
  previewClip: ClipItem | null

  setActiveView: (view: ViewType) => void
  setSearchQuery: (query: string) => void
  setPreviewClip: (clip: ClipItem | null) => void
  resetSearch: () => void
}

export const useUIStore = create<UIState>(set => ({
  activeView: 'clips',
  searchQuery: '',
  previewClip: null,

  setActiveView: view => set({ activeView: view }),
  setSearchQuery: query => set({ searchQuery: query }),
  setPreviewClip: clip => set({ previewClip: clip }),
  resetSearch: () => set({ searchQuery: '', previewClip: null }),
}))
