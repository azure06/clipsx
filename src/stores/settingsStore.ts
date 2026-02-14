import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { AppSettings } from '../shared/types'

interface SettingsState {
  settings: AppSettings | null
  isLoading: boolean
  error: string | null

  // Actions
  loadSettings: () => Promise<void>
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>
  getSettingsPath: () => Promise<string>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  isLoading: false,
  error: null,

  loadSettings: async () => {
    set({ isLoading: true, error: null })
    try {
      const settings = await invoke<AppSettings>('get_settings')
      set({ settings, isLoading: false })
    } catch (error) {
      console.error('Failed to load settings:', error)
      set({ error: String(error), isLoading: false })
    }
  },

  updateSettings: async (updates: Partial<AppSettings>) => {
    const currentSettings = get().settings
    if (!currentSettings) {
      throw new Error('Settings not loaded')
    }

    const newSettings: AppSettings = {
      ...currentSettings,
      ...updates,
    }

    // Optimistically update settings immediately without setting isLoading
    // This prevents re-renders that cause scroll position to reset
    set({ settings: newSettings })

    try {
      const savedSettings = await invoke<AppSettings>('update_settings', {
        settings: newSettings,
      })
      // Update with the saved settings from backend
      set({ settings: savedSettings })
    } catch (error) {
      console.error('Failed to update settings:', error)
      // Rollback to previous settings on error
      set({ settings: currentSettings, error: String(error) })
      throw error
    }
  },

  getSettingsPath: async () => {
    return await invoke<string>('get_settings_path')
  },
}))
