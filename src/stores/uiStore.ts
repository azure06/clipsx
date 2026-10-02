import { create } from 'zustand'
type ViewType = 'clipsx' | 'extensions' | 'intelligence' | 'settings'
export type ExtensionSettingsRequest = {
  packageId: string
  section: 'setups' | 'automation' | 'permissions'
  setupKind?: 'builtin' | 'saved'
  setupRef?: string
  transformerId?: string
}

interface UIState {
  activeView: ViewType
  extensionSettingsRequest: ExtensionSettingsRequest | null
  openExtensionSettings: (request: ExtensionSettingsRequest) => void
  clearExtensionSettingsRequest: () => void
  searchQuery: string
  previewClipId: string | null
  isSemanticActive: boolean

  setActiveView: (view: ViewType) => void
  setSearchQuery: (query: string) => void
  setPreviewClipId: (clipId: string | null) => void
  resetSearch: () => void
  toggleSemantic: () => void
  setSemanticActive: (active: boolean) => void
}

export const useUIStore = create<UIState>(set => ({
  activeView: 'clipsx',
  extensionSettingsRequest: null,
  openExtensionSettings: extensionSettingsRequest =>
    set({ activeView: 'extensions', extensionSettingsRequest }),
  clearExtensionSettingsRequest: () => set({ extensionSettingsRequest: null }),
  searchQuery: '',
  previewClipId: null,
  isSemanticActive: true, // Default to ON when a model is available

  setActiveView: view => set({ activeView: view }),
  setSearchQuery: query => set({ searchQuery: query }),
  setPreviewClipId: previewClipId => set({ previewClipId }),
  resetSearch: () => set({ searchQuery: '', previewClipId: null }),
  toggleSemantic: () => set(state => ({ isSemanticActive: !state.isSemanticActive })),
  setSemanticActive: isSemanticActive => set({ isSemanticActive }),
}))
